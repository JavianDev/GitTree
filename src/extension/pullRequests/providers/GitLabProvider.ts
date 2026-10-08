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
import type { OAuthSession } from '../oauth';
import {
  chooseSignInMethod,
  explainTokenFallback,
  gitlabClient,
  gitlabSession,
  providerReason,
  signInWithBrowser,
} from '../oauthClients';
import {
  type AddCommentInput,
  type CompleteOptions,
  type CreatePrInput,
  type EnsureFetchedResult,
  PullRequestApiError,
  type PullRequestProvider,
} from '../PullRequestProvider';
import {
  type GitLabApprovals,
  type GitLabCommit,
  type GitLabMergeRequest,
  type GitLabNote,
  type GitLabPipeline,
  mapCommentThreads,
  mapCommits,
  mapPullRequestDetail,
  mapPullRequestEntry,
  statusToGitLabState,
  voteToApproval,
} from './gitlabMappers';

const API_BASE = 'https://gitlab.com/api/v4';
const SECRET_KEY = 'gitTree.gitlab.pat.gitlab.com';

/** Marks a `token` as an OAuth access token rather than a personal access token. */
const BEARER = 'bearer:';

/**
 * GitLab.com only. VS Code has no built-in GitLab account, so this signs in
 * one of two ways:
 *
 *  - **Browser sign-in (OAuth + PKCE)**, when an application is configured:
 *    GitLab asks you to authorize Git Tree and sends the browser back through
 *    VS Code's URI handler. A public client — no secret — and the token is
 *    refreshed automatically.
 *  - **A personal access token** (scope `api`), for groups that block
 *    third-party applications.
 *
 * The two travel differently: OAuth tokens as `Authorization: Bearer`, personal
 * tokens as `PRIVATE-TOKEN`, so the `token` string carries a `bearer:` prefix
 * for the first.
 */
export class GitLabProvider implements PullRequestProvider {
  readonly id = 'gitlab' as const;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  private oauth(): OAuthSession | undefined {
    const client = gitlabClient();
    return client ? gitlabSession(client, this.secrets) : undefined;
  }

  async signOut(): Promise<void> {
    await this.oauth()?.forget();
    await this.secrets.delete(SECRET_KEY);
  }

  async switchAccount(): Promise<string | undefined> {
    await this.signOut();
    return this.session(true);
  }

  async session(interactive: boolean): Promise<string | undefined> {
    const oauth = this.oauth();
    const oauthToken = await oauth?.accessToken();
    if (oauthToken) return BEARER + oauthToken;

    const stored = await this.secrets.get(SECRET_KEY);
    if (stored) return stored;
    if (!interactive) return undefined;

    if (oauth) {
      const method = await chooseSignInMethod('GitLab', 'a personal access token');
      if (!method) return undefined;
      if (method === 'browser') {
        const token = await signInWithBrowser(oauth, 'GitLab');
        return token ? BEARER + token : undefined;
      }
    } else if (!(await explainTokenFallback('GitLab', 'a personal access token', 'gitTree.gitlab.oauthApplicationId'))) {
      return undefined;
    }

    const token = await vscode.window.showInputBox({
      prompt: 'GitLab.com personal access token (scope: api)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'glpat-…',
    });
    if (!token) return undefined;

    await this.secrets.store(SECRET_KEY, token.trim());
    return token.trim();
  }

  /** Every request goes through here; a 401 forgets the credential so sign-in is offered again. */
  private async call<T>(request: Omit<JsonRequest, 'authHeader'>): Promise<T> {
    const oauth = request.token.startsWith(BEARER);
    try {
      return await requestJson<T>(
        oauth
          ? { ...request, token: request.token.slice(BEARER.length), authHeader: 'Authorization' }
          : { ...request, authHeader: 'PRIVATE-TOKEN' },
      );
    } catch (error) {
      if (error instanceof PullRequestApiError && error.status === 401) {
        if (oauth) await this.oauth()?.forget();
        else await this.secrets.delete(SECRET_KEY);
        const reason = providerReason(error);
        throw new Error(
          `GitLab rejected the saved sign-in. Sign in again.${reason ? ` GitLab said: “${reason}”` : ''}`,
        );
      }
      throw error;
    }
  }

  private projectPath(ref: ProviderRepoRef): string {
    return encodeURIComponent(`${ref.owner}/${ref.repo}`);
  }

  async list(
    ref: ProviderRepoRef,
    status: PullRequestStatus,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestEntry[]> {
    const state = statusToGitLabState(status);
    const mrs = await this.call<GitLabMergeRequest[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests?state=${state}&per_page=50`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mrs.map((mr) => mapPullRequestEntry(mr));
  }

  async get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail> {
    const base = `${API_BASE}/projects/${this.projectPath(ref)}`;
    const mr = await this.call<GitLabMergeRequest>({
      url: `${base}/merge_requests/${id}`,
      token,
      ...(signal ? { signal } : {}),
    });

    const [approvals, pipelines] = await Promise.all([
      this.call<GitLabApprovals>({
        url: `${base}/merge_requests/${id}/approvals`,
        token,
        ...(signal ? { signal } : {}),
      }).catch(() => ({ approved_by: [] }) as GitLabApprovals),
      this.call<GitLabPipeline[]>({
        url: `${base}/merge_requests/${id}/pipelines`,
        token,
        ...(signal ? { signal } : {}),
      }).catch(() => []),
    ]);

    const projectWebUrl = mr.web_url.replace(/\/-\/merge_requests\/\d+$/, '');
    return mapPullRequestDetail(
      mr,
      approvals.approved_by.map((entry) => entry.user),
      pipelines[0],
      projectWebUrl,
    );
  }

  async commits(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommit[]> {
    const commits = await this.call<GitLabCommit[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/commits`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapCommits(commits);
  }

  async create(
    ref: ProviderRepoRef,
    input: CreatePrInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ id: number }> {
    const mr = await this.call<GitLabMergeRequest>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests`,
      method: 'POST',
      token,
      body: {
        title: input.title,
        description: input.description,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
        draft: input.isDraft,
      },
      ...(signal ? { signal } : {}),
    });
    return { id: mr.iid };
  }

  async vote(
    ref: ProviderRepoRef,
    id: number,
    vote: PullRequestVote,
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/${voteToApproval(vote)}`,
      method: 'POST',
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
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/merge`,
      method: 'PUT',
      token,
      body: {
        squash: options.squashMerge,
        should_remove_source_branch: options.deleteSourceBranch,
        ...(options.mergeCommitMessage ? { merge_commit_message: options.mergeCommitMessage } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  async abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void> {
    await this.call({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}`,
      method: 'PUT',
      token,
      body: { state_event: 'close' },
      ...(signal ? { signal } : {}),
    });
  }

  async commentThreads(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommentThread[]> {
    const notes = await this.call<GitLabNote[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/notes?per_page=100`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapCommentThreads(notes);
  }

  async addComment(
    ref: ProviderRepoRef,
    id: number,
    input: AddCommentInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ threadId: number }> {
    await this.call<GitLabNote>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/notes`,
      method: 'POST',
      token,
      body: { body: input.content },
      ...(signal ? { signal } : {}),
    });
    // GitLab has no server-side thread id for general notes; `mapCommentThreads`
    // groups them into the synthetic id-0 thread regardless of which note started it.
    return { threadId: input.threadId ?? 0 };
  }

  /**
   * GitLab keeps a merge request's diff refs (`base_sha`/`head_sha`) fetchable
   * from its own refs namespace even after the source branch is deleted:
   * `refs/merge-requests/{id}/head`. Fetching that is more reliable than the
   * branch name, which the detail response's `diff_refs` already gives us as
   * a SHA fallback either way.
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
      `refs/merge-requests/${id}/head:refs/remotes/${remote}/merge-requests/${id}`,
    ]);
    if (fetchSource.exitCode !== 0 && sourceOid) {
      fetchSource = await git.run(['fetch', remote, sourceOid]);
    }
    if (fetchSource.exitCode !== 0) {
      throw new Error(`This merge request's source commit is no longer available (${fetchSource.stderr.trim()}).`);
    }

    const fetchTarget = await git.run(['fetch', remote, detail.targetBranch]);
    if (fetchTarget.exitCode !== 0 && targetOid === '') {
      throw new Error(`Could not fetch the target branch (${fetchTarget.stderr.trim()}).`);
    }

    const sourceRef = sourceOid || `${remote}/merge-requests/${id}`;
    const targetRef = targetOid || `${remote}/${detail.targetBranch}`;
    const mergeBase = await git.run(['merge-base', targetRef, sourceRef]);

    return {
      sourceOid: sourceOid || sourceRef,
      targetOid: targetOid || targetRef,
      mergeBaseOid: mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : targetOid || targetRef,
    };
  }
}
