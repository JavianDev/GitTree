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
import { requestJson } from '../httpJson';
import type {
  AddCommentInput,
  CompleteOptions,
  CreatePrInput,
  EnsureFetchedResult,
  PullRequestProvider,
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

/**
 * GitLab.com only. VS Code has no built-in GitLab authentication provider,
 * so this is the one place in the whole PR feature that asks for a manually
 * entered credential: a personal access token, requested once and cached in
 * `vscode.SecretStorage`.
 */
export class GitLabProvider implements PullRequestProvider {
  readonly id = 'gitlab' as const;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async session(interactive: boolean): Promise<string | undefined> {
    const stored = await this.secrets.get(SECRET_KEY);
    if (stored) return stored;
    if (!interactive) return undefined;

    const token = await vscode.window.showInputBox({
      prompt: 'GitLab.com personal access token (scope: api)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'glpat-…',
    });
    if (!token) return undefined;

    await this.secrets.store(SECRET_KEY, token);
    return token;
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
    const mrs = await requestJson<GitLabMergeRequest[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests?state=${state}&per_page=50`,
      token,
      authHeader: 'PRIVATE-TOKEN',
      ...(signal ? { signal } : {}),
    });
    return mrs.map((mr) => mapPullRequestEntry(mr));
  }

  async get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail> {
    const base = `${API_BASE}/projects/${this.projectPath(ref)}`;
    const mr = await requestJson<GitLabMergeRequest>({
      url: `${base}/merge_requests/${id}`,
      token,
      authHeader: 'PRIVATE-TOKEN',
      ...(signal ? { signal } : {}),
    });

    const [approvals, pipelines] = await Promise.all([
      requestJson<GitLabApprovals>({
        url: `${base}/merge_requests/${id}/approvals`,
        token,
        authHeader: 'PRIVATE-TOKEN',
        ...(signal ? { signal } : {}),
      }).catch(() => ({ approved_by: [] }) as GitLabApprovals),
      requestJson<GitLabPipeline[]>({
        url: `${base}/merge_requests/${id}/pipelines`,
        token,
        authHeader: 'PRIVATE-TOKEN',
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
    const commits = await requestJson<GitLabCommit[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/commits`,
      token,
      authHeader: 'PRIVATE-TOKEN',
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
    const mr = await requestJson<GitLabMergeRequest>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests`,
      method: 'POST',
      token,
      authHeader: 'PRIVATE-TOKEN',
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
    await requestJson({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/${voteToApproval(vote)}`,
      method: 'POST',
      token,
      authHeader: 'PRIVATE-TOKEN',
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
    await requestJson({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/merge`,
      method: 'PUT',
      token,
      authHeader: 'PRIVATE-TOKEN',
      body: {
        squash: options.squashMerge,
        should_remove_source_branch: options.deleteSourceBranch,
        ...(options.mergeCommitMessage ? { merge_commit_message: options.mergeCommitMessage } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  async abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void> {
    await requestJson({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}`,
      method: 'PUT',
      token,
      authHeader: 'PRIVATE-TOKEN',
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
    const notes = await requestJson<GitLabNote[]>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/notes?per_page=100`,
      token,
      authHeader: 'PRIVATE-TOKEN',
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
    await requestJson<GitLabNote>({
      url: `${API_BASE}/projects/${this.projectPath(ref)}/merge_requests/${id}/notes`,
      method: 'POST',
      token,
      authHeader: 'PRIVATE-TOKEN',
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
