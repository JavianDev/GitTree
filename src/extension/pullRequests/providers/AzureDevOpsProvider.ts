import * as vscode from 'vscode';
import type {
  PullRequestCommentThread,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
  WorkItemRef,
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
  type AdoComment,
  type AdoCommit,
  type AdoPolicyEvaluation,
  type AdoPullRequest,
  type AdoThread,
  type AdoWorkItem,
  type AdoWorkItemRef,
  mapCommentThreads,
  mapCommits,
  mapPullRequestDetail,
  mapPullRequestEntry,
  mapWorkItems,
  voteToCode,
} from './azureDevOpsMappers';

const API_VERSION = '7.1';
/** The Azure DevOps resource id VS Code's Microsoft auth provider needs to scope a token to ADO. */
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

export class AzureDevOpsProvider implements PullRequestProvider {
  readonly id = 'azureDevOps' as const;

  /** `GET .../profiles/me` result, cached per session — reviewer voting needs the caller's own id. */
  private myId: string | undefined;
  private projectIds = new Map<string, string>();

  /**
   * VS Code owns this login and an extension cannot delete it, so a disconnect
   * is remembered here: silent lookups return nothing until the user signs in.
   */
  constructor(private readonly state: vscode.Memento) {}

  private get disconnectedKey(): string {
    return `gitTree.pullRequests.disconnected.${this.id}`;
  }

  async signOut(): Promise<void> {
    await this.state.update(this.disconnectedKey, true);
  }

  async switchAccount(): Promise<string | undefined> {
    await this.state.update(this.disconnectedKey, false);
    const session = await vscode.authentication.getSession('microsoft', [ADO_SCOPE], {
      forceNewSession: { detail: 'Choose the account Git Tree should use for pull requests.' },
      clearSessionPreference: true,
    });
    return session?.accessToken;
  }

  async session(interactive: boolean): Promise<string | undefined> {
    if (!interactive && this.state.get<boolean>(this.disconnectedKey)) return undefined;
    if (interactive) await this.state.update(this.disconnectedKey, false);
    const session = await vscode.authentication.getSession('microsoft', [ADO_SCOPE], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken;
  }

  private repoBase(ref: ProviderRepoRef): string {
    return `https://dev.azure.com/${ref.owner}/${ref.project}/_apis/git/repositories/${ref.repo}`;
  }

  private webUrl(ref: ProviderRepoRef, id: number): string {
    return `https://dev.azure.com/${ref.owner}/${ref.project}/_git/${ref.repo}/pullrequest/${id}`;
  }

  async list(
    ref: ProviderRepoRef,
    status: PullRequestStatus,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestEntry[]> {
    const result = await requestJson<{ value: AdoPullRequest[] }>({
      url: `${this.repoBase(ref)}/pullrequests?searchCriteria.status=${status}&api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    return result.value.map((pr) => mapPullRequestEntry(pr, this.webUrl(ref, pr.pullRequestId)));
  }

  async get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail> {
    const pr = await requestJson<AdoPullRequest>({
      url: `${this.repoBase(ref)}/pullrequests/${id}?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });

    const [policies, workItems] = await Promise.all([
      this.fetchPolicies(ref, id, token, signal).catch(() => []),
      this.fetchWorkItems(ref, id, token, signal).catch(() => []),
    ]);

    return mapPullRequestDetail(pr, this.webUrl(ref, id), policies, workItems);
  }

  private async projectId(ref: ProviderRepoRef, token: string, signal?: AbortSignal): Promise<string> {
    const cached = this.projectIds.get(ref.project ?? '');
    if (cached) return cached;

    const project = await requestJson<{ id: string }>({
      url: `https://dev.azure.com/${ref.owner}/_apis/projects/${ref.project}?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    this.projectIds.set(ref.project ?? '', project.id);
    return project.id;
  }

  private async fetchPolicies(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<AdoPolicyEvaluation[]> {
    const projectId = await this.projectId(ref, token, signal);
    const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${id}`;
    const result = await requestJson<{ value: AdoPolicyEvaluation[] }>({
      url: `https://dev.azure.com/${ref.owner}/${ref.project}/_apis/policy/evaluations?artifactId=${encodeURIComponent(artifactId)}&api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    return result.value;
  }

  private async fetchWorkItems(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<WorkItemRef[]> {
    const refs = await requestJson<{ value: AdoWorkItemRef[] }>({
      url: `${this.repoBase(ref)}/pullrequests/${id}/workitems?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    if (refs.value.length === 0) return [];

    const ids = refs.value.map((item) => item.id).join(',');
    const items = await requestJson<{ value: AdoWorkItem[] }>({
      url: `https://dev.azure.com/${ref.owner}/${ref.project}/_apis/wit/workitems?ids=${ids}&api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapWorkItems(refs.value, items.value, ref.owner, ref.project ?? '');
  }

  async commits(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommit[]> {
    const result = await requestJson<{ value: AdoCommit[] }>({
      url: `${this.repoBase(ref)}/pullrequests/${id}/commits?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    return mapCommits(result.value);
  }

  async create(
    ref: ProviderRepoRef,
    input: CreatePrInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ id: number }> {
    const pr = await requestJson<AdoPullRequest>({
      url: `${this.repoBase(ref)}/pullrequests?api-version=${API_VERSION}`,
      method: 'POST',
      token,
      body: {
        sourceRefName: `refs/heads/${input.sourceBranch}`,
        targetRefName: `refs/heads/${input.targetBranch}`,
        title: input.title,
        description: input.description,
        isDraft: input.isDraft,
      },
      ...(signal ? { signal } : {}),
    });
    return { id: pr.pullRequestId };
  }

  private async myReviewerId(token: string, signal?: AbortSignal): Promise<string> {
    if (this.myId) return this.myId;

    const profile = await requestJson<{ id: string }>({
      url: `https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    this.myId = profile.id;
    return profile.id;
  }

  async vote(
    ref: ProviderRepoRef,
    id: number,
    vote: PullRequestVote,
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const reviewerId = await this.myReviewerId(token, signal);
    await requestJson({
      url: `${this.repoBase(ref)}/pullrequests/${id}/reviewers/${reviewerId}?api-version=${API_VERSION}`,
      method: 'PUT',
      token,
      body: { vote: voteToCode(vote) },
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
    const pr = await requestJson<AdoPullRequest>({
      url: `${this.repoBase(ref)}/pullrequests/${id}?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });

    await requestJson({
      url: `${this.repoBase(ref)}/pullrequests/${id}?api-version=${API_VERSION}`,
      method: 'PATCH',
      token,
      body: {
        status: 'completed',
        lastMergeSourceCommit: pr.lastMergeSourceCommit,
        completionOptions: {
          deleteSourceBranch: options.deleteSourceBranch,
          squashMerge: options.squashMerge,
          bypassPolicy: options.bypassPolicy,
          ...(options.mergeCommitMessage ? { mergeCommitMessage: options.mergeCommitMessage } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    });
  }

  async abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void> {
    await requestJson({
      url: `${this.repoBase(ref)}/pullrequests/${id}?api-version=${API_VERSION}`,
      method: 'PATCH',
      token,
      body: { status: 'abandoned' },
      ...(signal ? { signal } : {}),
    });
  }

  async commentThreads(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommentThread[]> {
    const result = await requestJson<{ value: AdoThread[] }>({
      url: `${this.repoBase(ref)}/pullrequests/${id}/threads?api-version=${API_VERSION}`,
      token,
      ...(signal ? { signal } : {}),
    });
    // System-generated threads (vote/status change notices) carry no
    // meaningful `threadContext` and no author-written comment.
    return mapCommentThreads(result.value.filter((thread) => thread.comments.some((c) => c.commentType !== 'system')));
  }

  async addComment(
    ref: ProviderRepoRef,
    id: number,
    input: AddCommentInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ threadId: number }> {
    if (input.threadId !== undefined) {
      await requestJson<AdoComment>({
        url: `${this.repoBase(ref)}/pullrequests/${id}/threads/${input.threadId}/comments?api-version=${API_VERSION}`,
        method: 'POST',
        token,
        body: { content: input.content, commentType: 'text' },
        ...(signal ? { signal } : {}),
      });
      return { threadId: input.threadId };
    }

    const thread = await requestJson<AdoThread>({
      url: `${this.repoBase(ref)}/pullrequests/${id}/threads?api-version=${API_VERSION}`,
      method: 'POST',
      token,
      body: {
        comments: [{ content: input.content, commentType: 'text' }],
        status: 'active',
        ...(input.filePath
          ? {
              threadContext: {
                filePath: input.filePath,
                ...(input.line !== undefined
                  ? { rightFileStart: { line: input.line, offset: 1 }, rightFileEnd: { line: input.line, offset: 1 } }
                  : {}),
              },
            }
          : {}),
      },
      ...(signal ? { signal } : {}),
    });
    return { threadId: thread.id };
  }

  /**
   * Azure DevOps does not create GitHub-style synthetic PR refs, so the
   * source/target branches are fetched by name. If the source branch was
   * deleted (common after a delete-source-branch completion), branch-name
   * fetch fails — retried by fetching the raw SHA directly, which Azure
   * DevOps Cloud generally permits even for non-advertised objects.
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

    let fetchSource = await git.run(['fetch', remote, detail.sourceRefName]);
    if (fetchSource.exitCode !== 0 && sourceOid) {
      fetchSource = await git.run(['fetch', remote, sourceOid]);
    }
    if (fetchSource.exitCode !== 0) {
      throw new Error(`This pull request's source commit is no longer available (${fetchSource.stderr.trim()}).`);
    }

    const fetchTarget = await git.run(['fetch', remote, detail.targetRefName]);
    if (fetchTarget.exitCode !== 0 && targetOid === '') {
      throw new Error(`Could not fetch the target branch (${fetchTarget.stderr.trim()}).`);
    }

    const sourceRef = sourceOid || `${remote}/${detail.sourceBranch}`;
    const targetRef = targetOid || `${remote}/${detail.targetBranch}`;
    const mergeBase = await git.run(['merge-base', targetRef, sourceRef]);

    return {
      sourceOid: sourceOid || sourceRef,
      targetOid: targetOid || targetRef,
      mergeBaseOid: mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : targetOid || targetRef,
    };
  }
}
