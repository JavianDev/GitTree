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
/* Raw GitLab REST shapes (trimmed to the fields these mappers read)          */
/* -------------------------------------------------------------------------- */

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatar_url?: string;
}

export interface GitLabMergeRequest {
  iid: number;
  title: string;
  state: 'opened' | 'merged' | 'closed' | 'locked';
  draft: boolean;
  author: GitLabUser;
  source_branch: string;
  target_branch: string;
  created_at: string;
  web_url: string;
  description: string | null;
  sha: string | null;
  diff_refs?: { base_sha: string; start_sha: string; head_sha: string };
}

export interface GitLabApprovals {
  approved_by: Array<{ user: GitLabUser }>;
}

export interface GitLabCommit {
  id: string;
  author_name: string;
  author_email: string;
  created_at: string;
  message: string;
}

export interface GitLabPipeline {
  id: number;
  status: 'success' | 'failed' | 'running' | 'pending' | 'canceled' | 'skipped' | 'created' | 'manual';
  ref: string;
}

export interface GitLabNote {
  id: number;
  author: GitLabUser;
  body: string;
  created_at: string;
  system: boolean;
  resolved?: boolean;
  position?: { new_path?: string; new_line?: number };
}

/* -------------------------------------------------------------------------- */

/** GitLab has opened/merged/closed; `status` maps active/completed/abandoned onto them. */
export function statusToGitLabState(status: PullRequestStatus): 'opened' | 'merged' | 'closed' {
  if (status === 'active') return 'opened';
  if (status === 'completed') return 'merged';
  return 'closed';
}

export function gitlabStateToStatus(state: GitLabMergeRequest['state']): PullRequestStatus {
  if (state === 'merged') return 'completed';
  if (state === 'opened' || state === 'locked') return 'active';
  return 'abandoned';
}

export function mapUser(user: GitLabUser): PrIdentity {
  return {
    id: String(user.id),
    displayName: user.name,
    uniqueName: user.username,
    ...(user.avatar_url ? { imageUrl: user.avatar_url } : {}),
  };
}

export function mapPullRequestEntry(mr: GitLabMergeRequest, approvedBy: GitLabUser[] = []): PullRequestEntry {
  return {
    provider: 'gitlab',
    id: mr.iid,
    title: mr.title,
    status: gitlabStateToStatus(mr.state),
    isDraft: mr.draft,
    author: mapUser(mr.author),
    sourceRefName: `refs/heads/${mr.source_branch}`,
    targetRefName: `refs/heads/${mr.target_branch}`,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    createdAt: mr.created_at,
    reviewers: approvedBy.map((user) => ({ identity: mapUser(user), vote: 'approved', isRequired: false })),
    webUrl: mr.web_url,
  };
}

/** GitLab has no reject/request-changes vote — only approve/unapprove. */
export function voteToApproval(vote: PullRequestVote): 'approve' | 'unapprove' {
  return vote === 'approved' || vote === 'approvedWithSuggestions' ? 'approve' : 'unapprove';
}

export function mapPipelineToPolicy(pipeline: GitLabPipeline | undefined): PolicyEvaluation[] {
  if (!pipeline) return [];
  return [
    {
      policyId: String(pipeline.id),
      displayName: 'Pipeline',
      status: mapPipelineStatus(pipeline.status),
      isBlocking: false,
      context: pipeline.ref,
    },
  ];
}

function mapPipelineStatus(status: GitLabPipeline['status']): PolicyEvaluation['status'] {
  switch (status) {
    case 'success':
      return 'approved';
    case 'failed':
      return 'rejected';
    case 'running':
      return 'running';
    case 'pending':
    case 'created':
    case 'manual':
      return 'pending';
    case 'canceled':
      return 'broken';
    case 'skipped':
      return 'notApplicable';
  }
}

/** `closes #123` / bare `#123` in the description — same best-effort scan as GitHub's. */
export function scanLinkedIssues(mr: Pick<GitLabMergeRequest, 'description'>, projectWebUrl: string): WorkItemRef[] {
  const text = mr.description ?? '';
  const ids = new Set<string>();
  for (const match of text.matchAll(/#(\d+)/g)) {
    const id = match[1];
    if (id) ids.add(id);
  }

  return [...ids].map((id) => ({ id, webUrl: `${projectWebUrl}/-/issues/${id}` }));
}

export function mapPullRequestDetail(
  mr: GitLabMergeRequest,
  approvedBy: GitLabUser[],
  pipeline: GitLabPipeline | undefined,
  projectWebUrl: string,
): PullRequestDetail {
  return {
    ...mapPullRequestEntry(mr, approvedBy),
    description: mr.description ?? '',
    mergeStatus: 'notSet',
    ...(mr.diff_refs?.head_sha ? { lastMergeSourceCommit: mr.diff_refs.head_sha } : {}),
    ...(mr.diff_refs?.base_sha ? { lastMergeTargetCommit: mr.diff_refs.base_sha } : {}),
    commits: [],
    policies: mapPipelineToPolicy(pipeline),
    workItems: scanLinkedIssues(mr, projectWebUrl),
    completionOptions: { deleteSourceBranch: false, squashMerge: false, bypassPolicy: false },
    capabilities: { waitingForAuthorVote: false, bypassPolicy: false, workItems: true },
  };
}

export function mapCommits(commits: GitLabCommit[]): PullRequestCommit[] {
  return commits.map((commit) => ({
    commitId: commit.id,
    author: { name: commit.author_name, email: commit.author_email },
    date: commit.created_at,
    comment: commit.message,
  }));
}

/** Non-system notes only; diff-anchored notes (`position` set) get their own thread. */
export function mapCommentThreads(notes: GitLabNote[]): PullRequestCommentThread[] {
  const visible = notes.filter((note) => !note.system);
  const general = visible.filter((note) => !note.position);
  const anchored = visible.filter((note) => note.position);

  const threads: PullRequestCommentThread[] = [];

  if (general.length > 0) {
    threads.push({
      id: 0,
      status: 'active',
      comments: general.map(mapNote),
    });
  }

  // GitLab does not expose a thread id on notes directly; diff notes sharing
  // the same file+line are grouped as one thread, keyed by that pair.
  const byLocation = new Map<string, GitLabNote[]>();
  for (const note of anchored) {
    const key = `${note.position?.new_path ?? ''}:${note.position?.new_line ?? ''}`;
    const bucket = byLocation.get(key) ?? [];
    bucket.push(note);
    byLocation.set(key, bucket);
  }

  let syntheticId = 1;
  for (const [, group] of byLocation) {
    const first = group[0];
    threads.push({
      id: syntheticId++,
      status: first?.resolved ? 'fixed' : 'active',
      ...(first?.position?.new_path
        ? {
            context: {
              filePath: first.position.new_path,
              ...(first.position.new_line !== undefined ? { rightFileLine: first.position.new_line } : {}),
            },
          }
        : {}),
      comments: group.map(mapNote),
    });
  }

  return threads;
}

function mapNote(note: GitLabNote): PullRequestCommentThread['comments'][number] {
  return {
    id: note.id,
    author: mapUser(note.author),
    content: note.body,
    publishedAt: note.created_at,
    commentType: 'text',
  };
}
