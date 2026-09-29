import type {
  MergeStatus,
  PolicyEvaluation,
  PolicyStatus,
  PrIdentity,
  PullRequestCommentThread,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
  ThreadStatus,
  WorkItemRef,
} from '@shared/model';

/* -------------------------------------------------------------------------- */
/* Raw Azure DevOps REST shapes (trimmed to the fields these mappers read)    */
/* -------------------------------------------------------------------------- */

export interface AdoIdentity {
  id: string;
  displayName: string;
  uniqueName?: string;
  imageUrl?: string;
}

export interface AdoReviewer extends AdoIdentity {
  vote: number;
  isRequired?: boolean;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  status: 'active' | 'completed' | 'abandoned' | 'notSet';
  isDraft: boolean;
  createdBy: AdoIdentity;
  sourceRefName: string;
  targetRefName: string;
  creationDate: string;
  reviewers: AdoReviewer[];
  description?: string;
  mergeStatus?: 'succeeded' | 'conflicts' | 'queued' | 'notSet' | 'rejectedByPolicy' | 'failure';
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
  completionOptions?: { deleteSourceBranch?: boolean; squashMerge?: boolean; bypassPolicy?: boolean };
  repository?: { webUrl?: string };
}

export interface AdoCommit {
  commitId: string;
  author: { name: string; email: string; date: string };
  comment: string;
}

export interface AdoPolicyEvaluation {
  configuration: { type: { displayName: string }; isBlocking: boolean };
  status: 'approved' | 'rejected' | 'queued' | 'running' | 'notApplicable' | 'broken' | 'pending';
  context?: { name?: string };
}

export interface AdoWorkItemRef {
  id: string;
}

export interface AdoWorkItem {
  id: number;
  fields: { 'System.Title'?: string; 'System.WorkItemType'?: string; 'System.State'?: string };
}

export interface AdoComment {
  id: number;
  author: AdoIdentity;
  content: string;
  publishedDate: string;
  commentType: 'text' | 'system' | 'codeChange';
}

export interface AdoThread {
  id: number;
  status?: 'active' | 'fixed' | 'wontFix' | 'closed' | 'pending' | 'unknown';
  threadContext?: { filePath?: string; rightFileStart?: { line: number } };
  comments: AdoComment[];
}

/* -------------------------------------------------------------------------- */

const VOTE_TO_CODE: Record<PullRequestVote, number> = {
  approved: 10,
  approvedWithSuggestions: 5,
  noVote: 0,
  waitingForAuthor: -5,
  rejected: -10,
};

export function voteToCode(vote: PullRequestVote): number {
  return VOTE_TO_CODE[vote];
}

export function codeToVote(code: number): PullRequestVote {
  if (code >= 10) return 'approved';
  if (code >= 5) return 'approvedWithSuggestions';
  if (code === 0) return 'noVote';
  if (code >= -5) return 'waitingForAuthor';
  return 'rejected';
}

export function mapIdentity(identity: AdoIdentity): PrIdentity {
  return {
    id: identity.id,
    displayName: identity.displayName,
    ...(identity.uniqueName ? { uniqueName: identity.uniqueName } : {}),
    ...(identity.imageUrl ? { imageUrl: identity.imageUrl } : {}),
  };
}

export function mapStatus(status: AdoPullRequest['status']): PullRequestStatus {
  return status === 'notSet' ? 'active' : status;
}

export function mapReviewers(reviewers: AdoReviewer[]): PullRequestEntry['reviewers'] {
  return reviewers.map((reviewer) => ({
    identity: mapIdentity(reviewer),
    vote: codeToVote(reviewer.vote),
    isRequired: reviewer.isRequired ?? false,
  }));
}

function refToBranch(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}

export function mapPullRequestEntry(pr: AdoPullRequest, webUrl: string): PullRequestEntry {
  return {
    provider: 'azureDevOps',
    id: pr.pullRequestId,
    title: pr.title,
    status: mapStatus(pr.status),
    isDraft: pr.isDraft,
    author: mapIdentity(pr.createdBy),
    sourceRefName: pr.sourceRefName,
    targetRefName: pr.targetRefName,
    sourceBranch: refToBranch(pr.sourceRefName),
    targetBranch: refToBranch(pr.targetRefName),
    createdAt: pr.creationDate,
    reviewers: mapReviewers(pr.reviewers),
    webUrl,
  };
}

export function mapPolicyEvaluations(evaluations: AdoPolicyEvaluation[]): PolicyEvaluation[] {
  return evaluations.map((evaluation, index) => ({
    policyId: String(index),
    displayName: evaluation.configuration.type.displayName,
    status: evaluation.status as PolicyStatus,
    isBlocking: evaluation.configuration.isBlocking,
    ...(evaluation.context?.name ? { context: evaluation.context.name } : {}),
  }));
}

export function mapWorkItems(refs: AdoWorkItemRef[], items: AdoWorkItem[], org: string, project: string): WorkItemRef[] {
  const byId = new Map(items.map((item) => [String(item.id), item]));

  return refs.map((ref) => {
    const item = byId.get(ref.id);
    return {
      id: ref.id,
      ...(item?.fields['System.Title'] ? { title: item.fields['System.Title'] } : {}),
      ...(item?.fields['System.WorkItemType'] ? { workItemType: item.fields['System.WorkItemType'] } : {}),
      ...(item?.fields['System.State'] ? { state: item.fields['System.State'] } : {}),
      webUrl: `https://dev.azure.com/${org}/${project}/_workitems/edit/${ref.id}`,
    };
  });
}

export function mapPullRequestDetail(
  pr: AdoPullRequest,
  webUrl: string,
  policies: AdoPolicyEvaluation[],
  workItems: WorkItemRef[],
): PullRequestDetail {
  return {
    ...mapPullRequestEntry(pr, webUrl),
    description: pr.description ?? '',
    mergeStatus: (pr.mergeStatus ?? 'notSet') as MergeStatus,
    ...(pr.lastMergeSourceCommit ? { lastMergeSourceCommit: pr.lastMergeSourceCommit.commitId } : {}),
    ...(pr.lastMergeTargetCommit ? { lastMergeTargetCommit: pr.lastMergeTargetCommit.commitId } : {}),
    commits: [],
    policies: mapPolicyEvaluations(policies),
    workItems,
    completionOptions: {
      deleteSourceBranch: pr.completionOptions?.deleteSourceBranch ?? false,
      squashMerge: pr.completionOptions?.squashMerge ?? false,
      bypassPolicy: pr.completionOptions?.bypassPolicy ?? false,
    },
    capabilities: { waitingForAuthorVote: true, bypassPolicy: true, workItems: true },
  };
}

export function mapCommits(commits: AdoCommit[]): PullRequestCommit[] {
  return commits.map((commit) => ({
    commitId: commit.commitId,
    author: { name: commit.author.name, email: commit.author.email },
    date: commit.author.date,
    comment: commit.comment,
  }));
}

export function mapCommentThreads(threads: AdoThread[]): PullRequestCommentThread[] {
  return threads.map((thread) => ({
    id: thread.id,
    status: (thread.status ?? 'unknown') as ThreadStatus,
    ...(thread.threadContext?.filePath
      ? {
          context: {
            filePath: thread.threadContext.filePath,
            ...(thread.threadContext.rightFileStart
              ? { rightFileLine: thread.threadContext.rightFileStart.line }
              : {}),
          },
        }
      : {}),
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      author: mapIdentity(comment.author),
      content: comment.content,
      publishedAt: comment.publishedDate,
      commentType: comment.commentType,
    })),
  }));
}
