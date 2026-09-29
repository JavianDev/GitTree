import * as vscode from 'vscode';
import { type OAuthClient, OAuthSession, type TokenStore, listenOnLoopback, listenOnUri } from './oauth';

export { providerReason } from './oauth';

/** `publisher.name` — the authority VS Code routes `vscode://` sign-in callbacks by. */
export const EXTENSION_ID = 'javian-picardo-group-inc.git-tree';

/**
 * Bitbucket's consumer callback URL must be registered exactly, so the local
 * callback server always uses this port and path:
 * `http://127.0.0.1:47231/oauth/bitbucket`.
 */
export const BITBUCKET_CALLBACK_PORT = 47231;
export const BITBUCKET_CALLBACK_PATH = '/oauth/bitbucket';

interface BuiltInClients {
  bitbucket?: { key?: string; secret?: string };
  gitlab?: { applicationId?: string };
}

/**
 * The app registrations shipped with the extension, injected at build time from
 * the git-ignored `oauth-clients.json` (see `esbuild.mjs`), so no key or secret
 * lives in the repository. Empty in tests and in builds without the file —
 * sign-in then falls back to tokens.
 */
declare const __GITTREE_OAUTH__: BuiltInClients | undefined;
const BUILT_IN: BuiltInClients = typeof __GITTREE_OAUTH__ === 'undefined' ? {} : __GITTREE_OAUTH__;

function setting(key: string): string {
  return (vscode.workspace.getConfiguration('gitTree').get<string>(key) ?? '').trim();
}

/** A consumer from Settings wins over the built-in one — but only as a complete pair. */
export function bitbucketClient(): OAuthClient | undefined {
  const userKey = setting('bitbucket.oauthConsumerKey');
  const userSecret = setting('bitbucket.oauthConsumerSecret');
  const [key, secret] =
    userKey && userSecret ? [userKey, userSecret] : [BUILT_IN.bitbucket?.key ?? '', BUILT_IN.bitbucket?.secret ?? ''];
  if (!key || !secret) return undefined;

  return {
    provider: 'Bitbucket',
    authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    clientId: key,
    clientSecret: secret,
    pkce: false,
    sendRedirectUri: false,
  };
}

export function gitlabClient(): OAuthClient | undefined {
  const id = setting('gitlab.oauthApplicationId') || BUILT_IN.gitlab?.applicationId || '';
  if (!id) return undefined;

  return {
    provider: 'GitLab',
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    clientId: id,
    scope: 'api',
    pkce: true,
    sendRedirectUri: true,
  };
}

function secretStore(secrets: vscode.SecretStorage, key: string): TokenStore {
  return {
    get: async () => secrets.get(key),
    set: async (value) => secrets.store(key, value),
    clear: async () => secrets.delete(key),
  };
}

const openBrowser = async (url: string): Promise<boolean> => vscode.env.openExternal(vscode.Uri.parse(url, true));

export function bitbucketSession(client: OAuthClient, secrets: vscode.SecretStorage): OAuthSession {
  return new OAuthSession({
    client,
    store: secretStore(secrets, 'gitTree.bitbucket.oauth.bitbucket.org'),
    listen: () => listenOnLoopback(BITBUCKET_CALLBACK_PORT, BITBUCKET_CALLBACK_PATH, 'Bitbucket'),
    openBrowser,
  });
}

export function gitlabSession(client: OAuthClient, secrets: vscode.SecretStorage): OAuthSession {
  return new OAuthSession({
    client,
    store: secretStore(secrets, 'gitTree.gitlab.oauth.gitlab.com'),
    // `vscode://` for VS Code, `vscode-insiders://` for Insiders — both belong
    // in the GitLab application's redirect URIs.
    listen: async () => listenOnUri(`${vscode.env.uriScheme}://${EXTENSION_ID}/oauth/gitlab`),
    openBrowser,
  });
}

/** Offers browser sign-in first, with the token route kept for locked-down workspaces. */
export async function chooseSignInMethod(provider: string, tokenLabel: string): Promise<'browser' | 'token' | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: '$(globe) Sign in with your browser',
        detail: `Recommended — approve Git Tree on ${provider}, nothing to create or paste`,
        method: 'browser' as const,
      },
      {
        label: `$(key) Use ${tokenLabel} instead`,
        detail: 'For workspaces or organizations that block third-party app access',
        method: 'token' as const,
      },
    ],
    { title: `Sign in to ${provider}`, ignoreFocusOut: true },
  );
  return picked?.method;
}

/** Runs the browser flow behind a cancellable notification. */
export async function signInWithBrowser(session: OAuthSession, provider: string): Promise<string | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Waiting for ${provider} sign-in in your browser…`,
      cancellable: true,
    },
    async (_progress, cancellation) => {
      const controller = new AbortController();
      const subscription = cancellation.onCancellationRequested(() => controller.abort());
      try {
        return await session.signIn(controller.signal);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return undefined;
      } finally {
        subscription.dispose();
      }
    },
  );
}
