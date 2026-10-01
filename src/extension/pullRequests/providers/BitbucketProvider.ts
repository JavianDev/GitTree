import * as vscode from 'vscode';
import type {
  PullRequestCommentThread,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
} from '@shared/model';
import type { GitService } from '../../git/GitService';
import type { ProviderRepoRef } from '../detectProvider';
import { type JsonRequest, requestJson } from '../httpJson';
import {
  type AddCommentInput,
  type CompleteOptions,
  type CreatePrInput,
  type EnsureFetchedResult,
  PullRequestApiError,
  type PullRequestProvider,
} from '../PullRequestProvider';
import type { OAuthSession } from '../oauth';
import {
  bitbucketClient,
  bitbucketSession,
  chooseSignInMethod,
  providerReason,
  signInWithBrowser,
  explainTokenFallback,
} from '../oauthClients';
import {
  type BitbucketBuildStatus,
  type BitbucketComment,
  type BitbucketCommit,
  type BitbucketPullRequest,
  mapCommentThreads,
  mapCommits,
  mapPullRequestDetail,
  mapPullRequestEntry,
  statusToBitbucketState,
  voteToBitbucketAction,
} from './bitbucketMappers';

const API_BASE = 'https://api.bitbucket.org/2.0';
const SECRET_KEY = 'gitTree.bitbucket.apiToken.bitbucket.org';

/** Marks a `token` as an OAuth access token rather than a base64 `email:api_token` pair. */
const BEARER = 'bearer:';

/**
 * Bitbucket Cloud only. VS Code has no built-in Bitbucket account, so this
 * signs in one of two ways:
 *
 *  - **Browser sign-in (OAuth)**, when a consumer is configured: Bitbucket asks
 *    you to approve Git Tree, and the resulting token is stored and refreshed
 *    automatically. Nothing to create or paste.
 *  - **An API token**, for workspaces that block third-party apps: the
 *    Atlassian account email plus a Bitbucket-scoped API token, sent as HTTP
 *    Basic. (Atlassian retired App Passwords in 2026; API tokens authenticate
 *    the REST API with the account *email*, not the Bitbucket username.)
 *
 * The `token` string handed back to every method is `bearer:<oauth token>` for
 * the first and the base64 `email:api_token` pair for the second.
 */
export class BitbucketProvider implements PullRequestProvider {
  readonly id = 'bitbucket' as const;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  private oauth(): OAuthSession | undefined {
    const client = bitbucketClient();
    return client ? bitbucketSession(client, this.secrets) : undefined;
  }

  async session(interactive: boolean): Promise<string | undefined> {
    const oauth = this.oauth();
    const oauthToken = await oauth?.accessToken();
    if (oauthToken) return BEARER + oauthToken;

    const stored = await this.secrets.get(SECRET_KEY);
    if (stored) return stored;
    if (!interactive) return undefined;

    if (oauth) {
      const method = await chooseSignInMethod('Bitbucket', 'an API token');
      if (!method) return undefined;
      if (method === 'browser') {
        const token = await signInWithBrowser(oauth, 'Bitbucket');
        return token ? BEARER + token : undefined;
      }
    } else if (
      !(await explainTokenFallback('Bitbucket', 'an API token', 'gitTree.bitbucket.oauthConsumerKey and …Secret'))
    ) {
      return undefined;
    }

    return this.promptApiToken();
  }

  private async promptApiToken(): Promise<string | undefined> {
    const email = await vscode.window.showInputBox({
      title: 'Sign in to Bitbucket (1/2)',
      prompt: 'Atlassian account email — the one you sign in to bitbucket.org with',
      placeHolder: 'you@example.com',
      ignoreFocusOut: true,
    });
    if (!email) return undefined;

    const apiToken = await vscode.window.showInputBox({
      title: 'Sign in to Bitbucket (2/2)',
      prompt:
        'Bitbucket API token — id.atlassian.com → Security → API tokens → "Create API token with scopes" → Bitbucket, ' +
        'with read:repository, read:pullrequest and write:pullrequest. (A plain "Create API token" is rejected by Bitbucket.)',
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiToken) return undefined;

    const token = Buffer.from(`${email.trim()}:${apiToken.trim()}`).toString('base64');
    await this.secrets.store(SECRET_KEY, token);
    return token;
  }

  /**
   * Every request goes through here. A 401 means the saved credential is
   * wrong, expired, or revoked, so it is forgotten — the next connection check
   * then reports "not signed in" and the sidebar offers sign-in again, instead
   * of failing on every request with no way to re-enter it. Bitbucket's own
   * reason is passed on, since "rejected" alone does not say what to fix.
   */
  private async call<T>(request: Omit<JsonRequest, 'authHeader'>): Promise<T> {
    const oauth = request.token.startsWith(BEARER);
    try {
      return await requestJson<T>(
        oauth
          ? { ...request, token: request.token.slice(BEARER.length), authHeader: 'Authorization' }
          : { ...request, authHeader: 'Basic' },
      );
    } catch (error) {
      const reason = providerReason(error);
      const because = reason ? ` Bitbucket said: “${reason}”` : '';

      if (error instanceof PullRequestApiError && error.status === 401) {
        if (oauth) await this.oauth()?.forget();
        else await this.secrets.delete(SECRET_KEY);
        throw new Error(
          oauth
            ? `Your Bitbucket sign-in has expired or was revoked. Sign in again.${because}`
            : `Bitbucket rejected the saved API token. Check it is a Bitbucket-scoped API token and that the email is your Atlassian account email, then sign in again.${because}`,
        );
      }
      if (error instanceof PullRequestApiError && error.status === 403) {
        throw new Error(
          `Bitbucket denied access — the sign-in is missing pull request permission for this repository.${because}`,
        );
      }
      throw error;
    }
  }

  private base(ref: ProviderRepoRef): string {
    return `${API_BASE}/repositories/${ref.owner}/${ref.repo}`;
  }

  async list(
    ref: ProviderRepoRef,
    status: PullRequestStatus,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestEntry[]> {
    const state = statusToBitbucketState(status);
    const result = await this.call<{ values: BitbucketPullRequest[] }>({
      url: `${this.base(ref)}/pullrequests?state=${state}&pagelen=50`,
      token,
      ...(signal ? { signal } : {}),
    });
    return result.values.map((pr) => mapPullRequestEntry(pr, pr.participants));
  }

  async get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail> {
    const pr = await this.call<BitbucketPullRequest>({
      url: `${this.base(ref)}/pullrequests/${id}`,
      token,
      ...(signal ? { signal } : {}),
    });

    const buildStatuses = await this.call<{ values: BitbucketBuildStatus[] }>({
      url: `${this.base(ref)}/pullrequests/${id}/statuses`,
      token,
      ...(signal ? { signal } : {}),
    })
      .then((result) => result.values)
      .catch(() => []);

    return mapPullRequestDetail(pr, pr.participants ?? [], buildStatuses, `https://bitbucket.org/${ref.owner}/${ref.repo}`);
  }

  async commits(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommit[]> {
    const result = await this.call<{ values: BitbucketCommit[] }>({
      url: `${this.base(ref)}/pullrequests/${id}/commits`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapCommits(result.values);
  }

  async create(
    ref: ProviderRepoRef,
    input: CreatePrInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ id: number }> {
    const pr = await this.call<BitbucketPullRequest>({
      url: `${this.base(ref)}/pullrequests`,
      method: 'POST',
      token,
      body: {
        title: input.title,
        description: input.description,
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.targetBranch } },
        close_source_branch: false,
        draft: input.isDraft,
      },
      ...(signal ? { signal } : {}),
    });
    return { id: pr.id };
  }

  async vote(
    ref: ProviderRepoRef,
    id: number,
    vote: PullRequestVote,
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const action = voteToBitbucketAction(vote);
    const endpoint = action === 'approve' || action === 'unapprove' ? 'approve' : 'request-changes';
    const method = action === 'approve' || action === 'requestChanges' ? 'POST' : 'DELETE';

    await this.call({
      url: `${this.base(ref)}/pullrequests/${id}/${endpoint}`,
      method,
      token,
      ...(signal ? { signal } : {}),
    });
  }

  async complete(
    ref: ProviderRepoRef,
    id: number,
    options: CompleteOptions,
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call({
      url: `${this.base(ref)}/pullrequests/${id}/merge`,
      method: 'POST',
      token,
      body: {
        merge_strategy: options.squashMerge ? 'squash' : 'merge_commit',
        close_source_branch: options.deleteSourceBranch,
        ...(options.mergeCommitMessage ? { message: options.mergeCommitMessage } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  async abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void> {
    await this.call({
      url: `${this.base(ref)}/pullrequests/${id}/decline`,
      method: 'POST',
      token,
      ...(signal ? { signal } : {}),
    });
  }

  async commentThreads(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommentThread[]> {
    const result = await this.call<{ values: BitbucketComment[] }>({
      url: `${this.base(ref)}/pullrequests/${id}/comments?pagelen=100`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapCommentThreads(result.values);
  }

  async addComment(
    ref: ProviderRepoRef,
    id: number,
    input: AddCommentInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ threadId: number }> {
    const comment = await this.call<BitbucketComment>({
      url: `${this.base(ref)}/pullrequests/${id}/comments`,
      method: 'POST',
      token,
      body: {
        content: { raw: input.content },
        ...(input.threadId !== undefined && input.threadId !== 0 ? { parent: { id: input.threadId } } : {}),
        ...(input.filePath ? { inline: { path: input.filePath, ...(input.line !== undefined ? { to: input.line } : {}) } } : {}),
      },
      ...(signal ? { signal } : {}),
    });
    return { threadId: input.threadId ?? comment.id };
  }

  /**
   * Bitbucket Cloud exposes `refs/pull-requests/{id}/from` for every open
   * pull request, mirroring GitHub's `refs/pull/{id}/head` — fetched first,
   * with a raw-SHA fallback for the rare case it has been pruned.
   */
  async ensureFetched(
    ref: ProviderRepoRef,
    id: number,
    detail: PullRequestDetail,
    git: GitService,
  ): Promise<EnsureFetchedResult> {
    const remote = 'origin';
    const sourceOid = detail.lastMergeSourceCommit ?? '';
    const targetOid = detail.lastMergeTargetCommit ?? '';

    let fetchSource = await git.run([
      'fetch',
      remote,
      `refs/pull-requests/${id}/from:refs/remotes/${remote}/pull-requests/${id}`,
    ]);
    if (fetchSource.exitCode !== 0 && sourceOid) {
      fetchSource = await git.run(['fetch', remote, sourceOid]);
    }
    if (fetchSource.exitCode !== 0) {
      throw new Error(`This pull request's source commit is no longer available (${fetchSource.stderr.trim()}).`);
    }

    const fetchTarget = await git.run(['fetch', remote, detail.targetBranch]);
    if (fetchTarget.exitCode !== 0 && targetOid === '') {
      throw new Error(`Could not fetch the target branch (${fetchTarget.stderr.trim()}).`);
    }

    const sourceRef = sourceOid || `${remote}/pull-requests/${id}`;
    const targetRef = targetOid || `${remote}/${detail.targetBranch}`;
    const mergeBase = await git.run(['merge-base', targetRef, sourceRef]);

    return {
      sourceOid: sourceOid || sourceRef,
      targetOid: targetOid || targetRef,
      mergeBaseOid: mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : targetOid || targetRef,
    };
  }
}
