import type {
  PrProvider,
  PullRequestCommentThread,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
} from '@shared/model';
import type { GitService } from '../git/GitService';
import type { ProviderRepoRef } from './detectProvider';

export interface CreatePrInput {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  isDraft: boolean;
}

export interface CompleteOptions {
  squashMerge: boolean;
  deleteSourceBranch: boolean;
  bypassPolicy: boolean;
  mergeCommitMessage?: string;
}

export interface AddCommentInput {
  threadId?: number;
  content: string;
  filePath?: string;
  line?: number;
}

export interface EnsureFetchedResult {
  sourceOid: string;
  targetOid: string;
  mergeBaseOid: string;
}

/**
 * The shared abstraction every provider implements, so nothing above this
 * layer (`PullRequestService`, the RPC handlers, the webview) needs to know
 * which HTTP API actually produced the data.
 *
 * Every method except `detect` takes a bearer token explicitly rather than
 * fetching its own session — session lifetime (silent vs. interactive) is a
 * `PullRequestService`-level concern, not a per-call one.
 */
export interface PullRequestProvider {
  readonly id: PrProvider;

  /** Silent by default; `interactive: true` shows the provider's own sign-in UI. */
  session(interactive: boolean): Promise<string | undefined>;

  list(
    ref: ProviderRepoRef,
    status: PullRequestStatus,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestEntry[]>;

  get(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<PullRequestDetail>;

  commits(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommit[]>;

  create(
    ref: ProviderRepoRef,
    input: CreatePrInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ id: number }>;

  vote(
    ref: ProviderRepoRef,
    id: number,
    vote: PullRequestVote,
    token: string,
    signal?: AbortSignal,
  ): Promise<void>;

  complete(
    ref: ProviderRepoRef,
    id: number,
    options: CompleteOptions,
    token: string,
    signal?: AbortSignal,
  ): Promise<void>;

  abandon(ref: ProviderRepoRef, id: number, token: string, signal?: AbortSignal): Promise<void>;

  commentThreads(
    ref: ProviderRepoRef,
    id: number,
    token: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCommentThread[]>;

  addComment(
    ref: ProviderRepoRef,
    id: number,
    input: AddCommentInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ threadId: number }>;

  /** Provider-specific: how the PR's commits become locally fetchable. */
  ensureFetched(
    ref: ProviderRepoRef,
    id: number,
    detail: PullRequestDetail,
    git: GitService,
  ): Promise<EnsureFetchedResult>;
}

/** Thrown by a provider's HTTP client on a non-2xx response. */
export class PullRequestApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PullRequestApiError';
  }
}
