import { createHash, randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

/**
 * Browser sign-in (OAuth 2.0 authorization code flow) for providers VS Code has
 * no built-in account for — GitLab and Bitbucket. GitHub and Azure DevOps use
 * VS Code's own GitHub/Microsoft sign-in and never come through here.
 *
 * Deliberately free of `vscode` imports: the provider supplies how to open a
 * browser, where the callback arrives, and where tokens are kept, so the flow
 * itself — state checking, PKCE, token exchange, refresh — is unit-testable.
 */

export interface OAuthClient {
  /** Display name for messages, e.g. "Bitbucket". */
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  /**
   * Set for providers that only support confidential clients (Bitbucket). Sent
   * as HTTP Basic on the token request. Absent means a public client, which
   * must use PKCE instead (GitLab).
   */
  clientSecret?: string;
  scope?: string;
  pkce: boolean;
  /**
   * Whether `redirect_uri` is sent. GitLab requires it and matches it exactly
   * against the registered one; Bitbucket takes the callback from the consumer.
   */
  sendRedirectUri: boolean;
}

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent when the provider gave no lifetime. */
  expiresAt?: number;
  /** PKCE providers (GitLab) want the verifier and redirect again on refresh. */
  verifier?: string;
  redirectUri?: string;
}

export class OAuthError extends Error {
  override readonly name = 'OAuthError';
}

/** Refresh this long before the provider's stated expiry, so a request never races it. */
const EXPIRY_SKEW_MS = 60_000;

/** How long to wait for the browser to come back before giving up. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier. */
export function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export interface Authorization {
  url: string;
  state: string;
  verifier?: string;
}

export function beginAuthorization(
  client: OAuthClient,
  redirectUri: string,
  random: (size: number) => Buffer = randomBytes,
): Authorization {
  const state = base64Url(random(24));
  const verifier = client.pkce ? base64Url(random(48)) : undefined;

  const url = new URL(client.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (client.sendRedirectUri) url.searchParams.set('redirect_uri', redirectUri);
  if (client.scope) url.searchParams.set('scope', client.scope);
  if (verifier) {
    url.searchParams.set('code_challenge', pkceChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { url: url.toString(), state, ...(verifier ? { verifier } : {}) };
}

/**
 * Validates the browser's return and extracts the code. The state check is what
 * stops another page from completing a sign-in this one never started.
 */
export function readCallback(query: string, expectedState: string): string {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);

  const error = params.get('error');
  if (error) {
    throw new OAuthError(
      error === 'access_denied'
        ? 'Sign-in was cancelled in the browser.'
        : `Sign-in failed: ${params.get('error_description') ?? error}`,
    );
  }
  if (params.get('state') !== expectedState) {
    throw new OAuthError('The sign-in response did not match this request. Please try again.');
  }

  const code = params.get('code');
  if (!code) throw new OAuthError('The sign-in response carried no authorization code.');
  return code;
}

export type Grant =
  | { kind: 'code'; code: string; redirectUri: string; verifier?: string }
  | { kind: 'refresh'; token: StoredToken };

export function tokenRequest(client: OAuthClient, grant: Grant): { url: string; init: RequestInit } {
  const body = new URLSearchParams();

  if (grant.kind === 'code') {
    body.set('grant_type', 'authorization_code');
    body.set('code', grant.code);
    if (client.sendRedirectUri) body.set('redirect_uri', grant.redirectUri);
    if (grant.verifier) body.set('code_verifier', grant.verifier);
  } else {
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', grant.token.refreshToken ?? '');
    if (client.sendRedirectUri && grant.token.redirectUri) body.set('redirect_uri', grant.token.redirectUri);
    if (grant.token.verifier) body.set('code_verifier', grant.token.verifier);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (client.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
  }

  return { url: client.tokenUrl, init: { method: 'POST', headers, body: body.toString() } };
}

export function parseTokenResponse(
  json: unknown,
  now: number,
  carry: { verifier?: string; redirectUri?: string } = {},
): StoredToken {
  const record = (json ?? {}) as Record<string, unknown>;
  const accessToken = record['access_token'];
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new OAuthError('The provider returned no access token.');
  }

  const refreshToken = record['refresh_token'];
  const expiresIn = record['expires_in'];

  return {
    accessToken,
    ...(typeof refreshToken === 'string' && refreshToken ? { refreshToken } : {}),
    ...(typeof expiresIn === 'number' && expiresIn > 0 ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(carry.verifier ? { verifier: carry.verifier } : {}),
    ...(carry.redirectUri ? { redirectUri: carry.redirectUri } : {}),
  };
}

export function isFresh(token: StoredToken, now: number): boolean {
  return token.expiresAt === undefined || token.expiresAt - EXPIRY_SKEW_MS > now;
}

/* -------------------------------------------------------------------------- */
/* Where the browser comes back                                               */
/* -------------------------------------------------------------------------- */

export interface CallbackListener {
  redirectUri: string;
  /** Resolves with the callback's query string. */
  next(state: string): Promise<string>;
  dispose(): void;
}

/** Sign-ins waiting on the `vscode://` URI handler, keyed by state. */
const uriWaiters = new Map<string, (query: string) => void>();

/**
 * Called by the extension's URI handler. Returns whether a pending sign-in
 * claimed it — an unrecognised state (a stale or forged link) is ignored.
 */
export function deliverUriCallback(query: string): boolean {
  const state = new URLSearchParams(query).get('state');
  const waiter = state ? uriWaiters.get(state) : undefined;
  if (!state || !waiter) return false;
  uriWaiters.delete(state);
  waiter(query);
  return true;
}

/** Callback through VS Code's own URI handler (`vscode://publisher.extension/…`). */
export function listenOnUri(redirectUri: string): CallbackListener {
  const states = new Set<string>();
  return {
    redirectUri,
    next: (state) =>
      new Promise<string>((resolve) => {
        states.add(state);
        uriWaiters.set(state, resolve);
      }),
    dispose: () => {
      for (const state of states) uriWaiters.delete(state);
    },
  };
}

const DONE_PAGE = (provider: string, ok: boolean) => `<!doctype html><meta charset="utf-8"><title>Git Tree</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;background:#1e1e1e;color:#ddd">
<div style="text-align:center"><h2>${ok ? `Signed in to ${provider}` : `${provider} sign-in did not complete`}</h2>
<p>${ok ? 'You can close this tab and return to VS Code.' : 'Return to VS Code for details.'}</p></div></body>`;

/**
 * Callback through a one-shot local web server on 127.0.0.1. Used where the
 * provider's app registration expects an http(s) callback (Bitbucket). The
 * port is fixed because the registered callback URL must match it exactly.
 */
export async function listenOnLoopback(port: number, path: string, provider: string): Promise<CallbackListener> {
  let deliver: ((query: string) => void) | undefined;
  const first = new Promise<string>((resolve) => {
    deliver = resolve;
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== path) {
      response.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.has('code') && !url.searchParams.has('error');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE(provider, ok));
    deliver?.(url.search);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new OAuthError(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is in use, so ${provider} sign-in cannot receive its callback. Close whatever is using it and try again.`
            : `Could not start ${provider} sign-in: ${error.message}`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    redirectUri: `http://127.0.0.1:${port}${path}`,
    next: () => first,
    dispose: () => {
      server.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export interface TokenStore {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface OAuthSessionDeps {
  client: OAuthClient;
  store: TokenStore;
  listen: () => Promise<CallbackListener>;
  openBrowser: (url: string) => Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export class OAuthSession {
  constructor(private readonly deps: OAuthSessionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async read(): Promise<StoredToken | undefined> {
    const raw = await this.deps.store.get();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredToken;
      return typeof parsed.accessToken === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private async exchange(grant: Grant, carry: { verifier?: string; redirectUri?: string }): Promise<StoredToken> {
    const { url, init } = tokenRequest(this.deps.client, grant);
    const response = await (this.deps.fetch ?? fetch)(url, init);
    const text = await response.text().catch(() => '');

    if (!response.ok) {
      let reason = text;
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        reason = String(body['error_description'] ?? body['error'] ?? text);
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new OAuthError(`${this.deps.client.provider} rejected the sign-in (${response.status}): ${reason}`.trim());
    }

    const token = parseTokenResponse(text ? JSON.parse(text) : {}, this.now(), carry);
    // A provider that rotates refresh tokens may omit one on refresh; keep the old.
    const merged =
      grant.kind === 'refresh' && !token.refreshToken && grant.token.refreshToken
        ? { ...token, refreshToken: grant.token.refreshToken }
        : token;
    await this.deps.store.set(JSON.stringify(merged));
    return merged;
  }

  /** Silent: a stored token, refreshed if it has expired. Never opens a browser. */
  async accessToken(): Promise<string | undefined> {
    const stored = await this.read();
    if (!stored) return undefined;
    if (isFresh(stored, this.now())) return stored.accessToken;
    if (!stored.refreshToken) {
      await this.deps.store.clear();
      return undefined;
    }

    try {
      const refreshed = await this.exchange(
        { kind: 'refresh', token: stored },
        {
          ...(stored.verifier ? { verifier: stored.verifier } : {}),
          ...(stored.redirectUri ? { redirectUri: stored.redirectUri } : {}),
        },
      );
      return refreshed.accessToken;
    } catch {
      // A refresh the provider refuses (revoked app, expired refresh token)
      // means a fresh sign-in, not an error on every request from now on.
      await this.deps.store.clear();
      return undefined;
    }
  }

  /** Interactive: opens the browser and waits for the provider to send it back. */
  async signIn(signal?: AbortSignal): Promise<string> {
    const listener = await this.deps.listen();

    try {
      const authorization = beginAuthorization(this.deps.client, listener.redirectUri);
      const callback = listener.next(authorization.state);

      const opened = await this.deps.openBrowser(authorization.url);
      if (!opened) throw new OAuthError(`Could not open a browser for ${this.deps.client.provider} sign-in.`);

      const query = await raceWithTimeout(callback, this.deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS, signal, this.deps.client.provider);
      const code = readCallback(query, authorization.state);

      const token = await this.exchange(
        {
          kind: 'code',
          code,
          redirectUri: listener.redirectUri,
          ...(authorization.verifier ? { verifier: authorization.verifier } : {}),
        },
        {
          ...(authorization.verifier ? { verifier: authorization.verifier } : {}),
          redirectUri: listener.redirectUri,
        },
      );
      return token.accessToken;
    } finally {
      listener.dispose();
    }
  }

  async forget(): Promise<void> {
    await this.deps.store.clear();
  }
}

function raceWithTimeout(promise: Promise<string>, ms: number, signal: AbortSignal | undefined, provider: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OAuthError(`${provider} sign-in timed out. Please try again.`)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OAuthError(`${provider} sign-in was cancelled.`));
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The reason a provider gave for rejecting a request, pulled out of the
 * response body `requestJson` puts in the error message — so a failure says
 * *why* ("Token is invalid or expired") rather than only that it failed.
 */
export function providerReason(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const start = error.message.indexOf('{');
  if (start < 0) return undefined;
  try {
    const body = JSON.parse(error.message.slice(start)) as Record<string, unknown>;
    const nested = body['error'];
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>)['message'];
      if (typeof message === 'string') return message;
    }
    for (const key of ['error_description', 'message', 'error']) {
      const value = body[key];
      if (typeof value === 'string') return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
