import type {
  PolicyEvaluation,
  PrIdentity,
  PullRequestCommentThread,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
  WorkItemRef,
} from '@shared/model';

/* -------------------------------------------------------------------------- */
/* Raw GitHub REST shapes (trimmed to the fields these mappers read)          */
/* -------------------------------------------------------------------------- */

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
}

export interface GitHubPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged_at: string | null;
  user: GitHubUser | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  html_url: string;
  body: string | null;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string } | null;
    message: string;
  };
}

export interface GitHubReview {
  user: GitHubUser | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | null;
}

export interface GitHubIssueComment {
  id: number;
  user: GitHubUser | null;
  body: string;
  created_at: string;
}

export interface GitHubReviewComment extends GitHubIssueComment {
  path: string;
  line: number | null;
  in_reply_to_id?: number;
}

/* -------------------------------------------------------------------------- */

/** GitHub only has open/closed; `status` distinguishes completed from abandoned client-side. */
export function statusToGitHubState(status: PullRequestStatus): 'open' | 'closed' {
  return status === 'active' ? 'open' : 'closed';
}

export function githubStateToStatus(pull: Pick<GitHubPull, 'state' | 'merged_at'>): PullRequestStatus {
  if (pull.state === 'open') return 'active';
  return pull.merged_at ? 'completed' : 'abandoned';
}

export function mapUser(user: GitHubUser | null): PrIdentity {
  if (!user) return { id: 'unknown', displayName: 'Unknown' };
  return {
    id: String(user.id),
    displayName: user.login,
    uniqueName: user.login,
    ...(user.avatar_url ? { imageUrl: user.avatar_url } : {}),
  };
}

export function mapPullRequestEntry(pull: GitHubPull): PullRequestEntry {
  return {
    provider: 'github',
    id: pull.number,
    title: pull.title,
    status: githubStateToStatus(pull),
    isDraft: pull.draft,
    author: mapUser(pull.user),
    sourceRefName: `refs/heads/${pull.head.ref}`,
    targetRefName: `refs/heads/${pull.base.ref}`,
    sourceBranch: pull.head.ref,
    targetBranch: pull.base.ref,
    createdAt: pull.created_at,
    // GitHub's review state is fetched separately (a second call); the list
    // view renders without it rather than paying for N+1 review fetches.
    reviewers: [],
    webUrl: pull.html_url,
  };
}

export function reviewStateToVote(state: GitHubReview['state']): PullRequestVote {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'rejected';
    case 'COMMENTED':
    case 'DISMISSED':
    case 'PENDING':
      return 'noVote';
  }
}

/** GitHub has no separate "wait for author" vote and no bypass-policy flag. */
export function voteToReviewEvent(vote: PullRequestVote): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  switch (vote) {
    case 'approved':
    case 'approvedWithSuggestions':
      return 'APPROVE';
    case 'rejected':
      return 'REQUEST_CHANGES';
    default:
      return 'COMMENT';
  }
}

/** One reviewer entry per distinct user, keeping their most recent review. */
export function mapReviewers(reviews: GitHubReview[]): PullRequestEntry['reviewers'] {
  const byUser = new Map<string, GitHubReview>();
  for (const review of reviews) {
    if (!review.user) continue;
    byUser.set(String(review.user.id), review);
  }

  return [...byUser.values()].map((review) => ({
    identity: mapUser(review.user),
    vote: reviewStateToVote(review.state),
    isRequired: false,
  }));
}

export function mapCheckRunsToPolicies(checkRuns: GitHubCheckRun[]): PolicyEvaluation[] {
  return checkRuns.map((run) => ({
    policyId: String(run.id),
    displayName: run.name,
    status: mapCheckRunStatus(run),
    isBlocking: false,
    ...(run.conclusion ? { context: run.conclusion } : {}),
  }));
}

function mapCheckRunStatus(run: GitHubCheckRun): PolicyEvaluation['status'] {
  if (run.status !== 'completed') return run.status === 'queued' ? 'queued' : 'running';
  switch (run.conclusion) {
    case 'success':
      return 'approved';
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return 'rejected';
    case 'cancelled':
      return 'broken';
    default:
      return 'notApplicable';
  }
}

/** Best-effort `#123` scan of the title/body — GitHub's GraphQL linked-issues
 * query is deliberately not used here; see the provider's own notes. */
export function scanLinkedIssues(pull: Pick<GitHubPull, 'title' | 'body'>, webUrlBase: string): WorkItemRef[] {
  const text = `${pull.title}\n${pull.body ?? ''}`;
  const ids = new Set<string>();
  for (const match of text.matchAll(/#(\d+)/g)) {
    const id = match[1];
    if (id) ids.add(id);
  }

  return [...ids].map((id) => ({ id, webUrl: `${webUrlBase}/issues/${id}` }));
}

export function mapPullRequestDetail(
  pull: GitHubPull,
  reviews: GitHubReview[],
  checkRuns: GitHubCheckRun[],
  repoWebUrl: string,
): PullRequestDetail {
  return {
    ...mapPullRequestEntry(pull),
    reviewers: mapReviewers(reviews),
    description: pull.body ?? '',
    mergeStatus: 'notSet',
    lastMergeSourceCommit: pull.head.sha,
    lastMergeTargetCommit: pull.base.sha,
    commits: [],
    policies: mapCheckRunsToPolicies(checkRuns),
    workItems: scanLinkedIssues(pull, repoWebUrl),
    completionOptions: { deleteSourceBranch: false, squashMerge: false, bypassPolicy: false },
    capabilities: { waitingForAuthorVote: false, bypassPolicy: false, workItems: false },
  };
}

export function mapCommits(commits: GitHubCommit[]): PullRequestCommit[] {
  return commits.map((commit) => ({
    commitId: commit.sha,
    author: {
      name: commit.commit.author?.name ?? 'Unknown',
      email: commit.commit.author?.email ?? '',
    },
    date: commit.commit.author?.date ?? '',
    comment: commit.commit.message,
  }));
}

/**
 * Issue comments (general discussion) become one synthetic "general" thread;
 * review comments group by their root comment id — a reply's `in_reply_to_id`
 * points at the thread's first comment.
 */
export function mapCommentThreads(
  issueComments: GitHubIssueComment[],
  reviewComments: GitHubReviewComment[],
): PullRequestCommentThread[] {
  const threads: PullRequestCommentThread[] = [];

  if (issueComments.length > 0) {
    threads.push({
      id: 0,
      status: 'active',
      comments: issueComments.map((comment) => ({
        id: comment.id,
        author: mapUser(comment.user),
        content: comment.body,
        publishedAt: comment.created_at,
        commentType: 'text',
      })),
    });
  }

  const roots = new Map<number, GitHubReviewComment[]>();
  for (const comment of reviewComments) {
    const rootId = comment.in_reply_to_id ?? comment.id;
    const bucket = roots.get(rootId) ?? [];
    bucket.push(comment);
    roots.set(rootId, bucket);
  }

  for (const [rootId, comments] of roots) {
    const root = comments.find((comment) => comment.id === rootId) ?? comments[0];
    threads.push({
      id: rootId,
      status: 'active',
      ...(root
        ? { context: { filePath: root.path, ...(root.line !== null ? { rightFileLine: root.line } : {}) } }
        : {}),
      comments: comments
        .slice()
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((comment) => ({
          id: comment.id,
          author: mapUser(comment.user),
          content: comment.body,
          publishedAt: comment.created_at,
          commentType: 'text',
        })),
    });
  }

  return threads;
}
