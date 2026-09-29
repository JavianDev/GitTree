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
  type GitHubCheckRun,
  type GitHubCommit,
  type GitHubIssueComment,
  type GitHubPull,
  type GitHubReview,
  type GitHubReviewComment,
  mapCommentThreads,
  mapCommits,
  mapPullRequestDetail,
  mapPullRequestEntry,
  statusToGitHubState,
  voteToReviewEvent,
} from './githubMappers';

const API_BASE = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';

/**
 * GitHub Cloud only, via VS Code's built-in GitHub Authentication extension
 * — `vscode.authentication.getSession('github', ...)` ships with VS Code
 * itself, so this adds no new dependency and no custom sign-in UI.
 */
export class GitHubProvider implements PullRequestProvider {
  readonly id = 'github' as const;

  async session(interactive: boolean): Promise<string | undefined> {
    const session = await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken;
  }

  async list(
    ref: ProviderRepoRef,
    status: PullRequestStatus,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestEntry[]> {
    const state = statusToGitHubState(status);
    const pulls = await requestJson<GitHubPull[]>({
      url: `${API_BASE}/repos/${ref.owner}/${ref.repo}/pulls?state=${state}&per_page=50`,
      token,
      headers: { Accept: ACCEPT },
      ...(signal ? { signal } : {}),
    });

    const filtered =
      status === 'active'
        ? pulls
        : pulls.filter((pull) => (status === 'completed' ? pull.merged_at !== null : pull.merged_at === null));

    return filtered.map(mapPullRequestEntry);
  }

  async get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail> {
    const base = `${API_BASE}/repos/${ref.owner}/${ref.repo}`;
    const pull = await requestJson<GitHubPull>({
      url: `${base}/pulls/${id}`,
      token,
      headers: { Accept: ACCEPT },
      ...(signal ? { signal } : {}),
    });

    const [reviews, checkRuns] = await Promise.all([
      requestJson<GitHubReview[]>({
        url: `${base}/pulls/${id}/reviews`,
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      }).catch(() => []),
      requestJson<{ check_runs: GitHubCheckRun[] }>({
        url: `${base}/commits/${pull.head.sha}/check-runs`,
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      })
        .then((result) => result.check_runs)
        .catch(() => []),
    ]);

    const repoWebUrl = `https://github.com/${ref.owner}/${ref.repo}`;
    return mapPullRequestDetail(pull, reviews, checkRuns, repoWebUrl);
  }

  async commits(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommit[]> {
    const commits = await requestJson<GitHubCommit[]>({
      url: `${API_BASE}/repos/${ref.owner}/${ref.repo}/pulls/${id}/commits`,
      token,
      headers: { Accept: ACCEPT },
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
    const pull = await requestJson<GitHubPull>({
      url: `${API_BASE}/repos/${ref.owner}/${ref.repo}/pulls`,
      method: 'POST',
      token,
      headers: { Accept: ACCEPT },
      body: {
        title: input.title,
        body: input.description,
        head: input.sourceBranch,
        base: input.targetBranch,
        draft: input.isDraft,
      },
      ...(signal ? { signal } : {}),
    });
    return { id: pull.number };
  }

  async vote(
    ref: ProviderRepoRef,
    id: number,
    vote: PullRequestVote,
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await requestJson({
      url: `${API_BASE}/repos/${ref.owner}/${ref.repo}/pulls/${id}/reviews`,
      method: 'POST',
      token,
      headers: { Accept: ACCEPT },
      body: { event: voteToReviewEvent(vote) },
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
    const base = `${API_BASE}/repos/${ref.owner}/${ref.repo}`;
    const pull = await requestJson<GitHubPull>({
      url: `${base}/pulls/${id}`,
      token,
      headers: { Accept: ACCEPT },
      ...(signal ? { signal } : {}),
    });

    await requestJson({
      url: `${base}/pulls/${id}/merge`,
      method: 'PUT',
      token,
      headers: { Accept: ACCEPT },
      body: {
        merge_method: options.squashMerge ? 'squash' : 'merge',
        ...(options.mergeCommitMessage ? { commit_message: options.mergeCommitMessage } : {}),
      },
      ...(signal ? { signal } : {}),
    });

    if (options.deleteSourceBranch) {
      await requestJson({
        url: `${base}/git/refs/heads/${pull.head.ref}`,
        method: 'DELETE',
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      }).catch(() => undefined);
    }
  }

  async abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void> {
    await requestJson({
      url: `${API_BASE}/repos/${ref.owner}/${ref.repo}/pulls/${id}`,
      method: 'PATCH',
      token,
      headers: { Accept: ACCEPT },
      body: { state: 'closed' },
      ...(signal ? { signal } : {}),
    });
  }

  async commentThreads(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommentThread[]> {
    const base = `${API_BASE}/repos/${ref.owner}/${ref.repo}`;
    const [issueComments, reviewComments] = await Promise.all([
      requestJson<GitHubIssueComment[]>({
        url: `${base}/issues/${id}/comments`,
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      }),
      requestJson<GitHubReviewComment[]>({
        url: `${base}/pulls/${id}/comments`,
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      }),
    ]);

    return mapCommentThreads(issueComments, reviewComments);
  }

  async addComment(
    ref: ProviderRepoRef,
    id: number,
    input: AddCommentInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ threadId: number }> {
    const base = `${API_BASE}/repos/${ref.owner}/${ref.repo}`;

    if (input.filePath && input.line !== undefined && input.threadId === undefined) {
      const pull = await requestJson<GitHubPull>({
        url: `${base}/pulls/${id}`,
        token,
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      });
      const comment = await requestJson<GitHubReviewComment>({
        url: `${base}/pulls/${id}/comments`,
        method: 'POST',
        token,
        headers: { Accept: ACCEPT },
        body: {
          body: input.content,
          commit_id: pull.head.sha,
          path: input.filePath,
          line: input.line,
          side: 'RIGHT',
        },
        ...(signal ? { signal } : {}),
      });
      return { threadId: comment.id };
    }

    if (input.threadId !== undefined && input.threadId !== 0) {
      await requestJson<GitHubReviewComment>({
        url: `${base}/pulls/${id}/comments/${input.threadId}/replies`,
        method: 'POST',
        token,
        headers: { Accept: ACCEPT },
        body: { body: input.content },
        ...(signal ? { signal } : {}),
      });
      return { threadId: input.threadId };
    }

    await requestJson<GitHubIssueComment>({
      url: `${base}/issues/${id}/comments`,
      method: 'POST',
      token,
      headers: { Accept: ACCEPT },
      body: { body: input.content },
      ...(signal ? { signal } : {}),
    });
    // General comments live in one synthetic thread (id 0, see
    // `mapCommentThreads`) — there is no separate thread id to report.
    return { threadId: 0 };
  }

  /**
   * GitHub creates a synthetic `refs/pull/{id}/head` for every PR, so the
   * source commit stays fetchable for as long as the PR stays open — usually
   * well after — even once the source branch itself is deleted.
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

    const fetchSource = await git.run([
      'fetch',
      remote,
      `refs/pull/${id}/head:refs/remotes/${remote}/pr/${id}`,
    ]);
    const fetchTarget = await git.run(['fetch', remote, detail.targetBranch]);

    if (fetchSource.exitCode !== 0) {
      throw new Error(`This pull request's source commit is no longer available (${fetchSource.stderr.trim()}).`);
    }
    if (fetchTarget.exitCode !== 0 && targetOid === '') {
      throw new Error(`Could not fetch the target branch (${fetchTarget.stderr.trim()}).`);
    }

    const targetRef = targetOid || `${remote}/${detail.targetBranch}`;
    const mergeBase = await git.run(['merge-base', targetRef, sourceOid]);
    return {
      sourceOid,
      targetOid,
      mergeBaseOid: mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : targetOid,
    };
  }
}
