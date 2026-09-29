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

/**
 * Bitbucket Cloud only. VS Code has no built-in Bitbucket authentication
 * provider, so — like GitLab — this asks for a credential once and caches it
 * in SecretStorage: the Atlassian account email plus an API token, sent as
 * HTTP Basic. (Atlassian retired App Passwords in 2026; API tokens replace
 * them and authenticate the REST API with the account *email*, not the
 * Bitbucket username.) `token` here is the base64 `email:api_token` pair,
 * encoded once at sign-in rather than on every request.
 */
export class BitbucketProvider implements PullRequestProvider {
  readonly id = 'bitbucket' as const;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async session(interactive: boolean): Promise<string | undefined> {
    const stored = await this.secrets.get(SECRET_KEY);
    if (stored) return stored;
    if (!interactive) return undefined;

    const email = await vscode.window.showInputBox({
      title: 'Sign in to Bitbucket (1/2)',
      prompt: 'Atlassian account email',
      placeHolder: 'you@example.com',
      ignoreFocusOut: true,
    });
    if (!email) return undefined;

    const apiToken = await vscode.window.showInputBox({
      title: 'Sign in to Bitbucket (2/2)',
      prompt:
        'Bitbucket API token — create one at id.atlassian.com → Security → API tokens → "Create API token with scopes", ' +
        'choose Bitbucket, and grant read:repository, read:pullrequest and write:pullrequest',
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
   * wrong or has been revoked, so it is forgotten — the next connection check
   * then reports "not signed in" and the sidebar offers sign-in again, instead
   * of failing on every request with no way to re-enter it.
   */
  private async call<T>(request: Omit<JsonRequest, 'authHeader'>): Promise<T> {
    try {
      return await requestJson<T>({ ...request, authHeader: 'Basic' });
    } catch (error) {
      if (error instanceof PullRequestApiError && error.status === 401) {
        await this.secrets.delete(SECRET_KEY);
        throw new Error('Bitbucket rejected the saved credentials. Sign in again with your Atlassian account email and an API token.');
      }
      if (error instanceof PullRequestApiError && error.status === 403) {
        throw new Error('Bitbucket denied access. The API token may be missing the read:pullrequest / write:pullrequest scopes.');
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
