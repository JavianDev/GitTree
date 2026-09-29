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
/* Raw Bitbucket Cloud REST v2.0 shapes (trimmed to the fields these mappers  */
/* read)                                                                      */
/* -------------------------------------------------------------------------- */

export interface BitbucketUser {
  uuid: string;
  display_name: string;
  nickname?: string;
  links?: { avatar?: { href?: string } };
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  draft?: boolean;
  author: BitbucketUser;
  source: { branch: { name: string }; commit?: { hash: string } };
  destination: { branch: { name: string }; commit?: { hash: string } };
  created_on: string;
  description: string | null;
  links: { html: { href: string } };
  merge_commit?: { hash: string };
  /** Embedded directly on the PR object — reviewers and their votes, no separate call needed. */
  participants?: BitbucketParticipant[];
}

export interface BitbucketParticipant {
  user: BitbucketUser;
  role: 'REVIEWER' | 'PARTICIPANT';
  approved: boolean;
  state: 'approved' | 'changes_requested' | null;
}

export interface BitbucketCommit {
  hash: string;
  author: { raw: string; user?: { display_name: string } };
  date: string;
  message: string;
}

export interface BitbucketBuildStatus {
  key: string;
  name: string;
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
}

export interface BitbucketComment {
  id: number;
  user: BitbucketUser;
  content: { raw: string };
  created_on: string;
  parent?: { id: number };
  inline?: { path: string; to?: number };
  deleted?: boolean;
}

/* -------------------------------------------------------------------------- */

/** Bitbucket has open/merged/declined; `status` maps active/completed/abandoned onto them. */
export function statusToBitbucketState(status: PullRequestStatus): 'OPEN' | 'MERGED' | 'DECLINED' {
  if (status === 'active') return 'OPEN';
  if (status === 'completed') return 'MERGED';
  return 'DECLINED';
}

export function bitbucketStateToStatus(state: BitbucketPullRequest['state']): PullRequestStatus {
  if (state === 'MERGED') return 'completed';
  if (state === 'OPEN') return 'active';
  return 'abandoned';
}

export function mapUser(user: BitbucketUser): PrIdentity {
  return {
    id: user.uuid,
    displayName: user.display_name,
    ...(user.nickname ? { uniqueName: user.nickname } : {}),
    ...(user.links?.avatar?.href ? { imageUrl: user.links.avatar.href } : {}),
  };
}

function participantToVote(participant: BitbucketParticipant): PullRequestVote {
  if (participant.state === 'approved') return 'approved';
  if (participant.state === 'changes_requested') return 'rejected';
  return 'noVote';
}

export function mapPullRequestEntry(pr: BitbucketPullRequest, participants: BitbucketParticipant[] = []): PullRequestEntry {
  return {
    provider: 'bitbucket',
    id: pr.id,
    title: pr.title,
    status: bitbucketStateToStatus(pr.state),
    isDraft: pr.draft ?? false,
    author: mapUser(pr.author),
    sourceRefName: `refs/heads/${pr.source.branch.name}`,
    targetRefName: `refs/heads/${pr.destination.branch.name}`,
    sourceBranch: pr.source.branch.name,
    targetBranch: pr.destination.branch.name,
    createdAt: pr.created_on,
    reviewers: participants
      .filter((participant) => participant.role === 'REVIEWER')
      .map((participant) => ({
        identity: mapUser(participant.user),
        vote: participantToVote(participant),
        isRequired: false,
      })),
    webUrl: pr.links.html.href,
  };
}

/** Bitbucket has no single-score vote — approve/unapprove and request-changes/remove are separate endpoints. */
export function voteToBitbucketAction(vote: PullRequestVote): 'approve' | 'unapprove' | 'requestChanges' | 'removeRequestChanges' {
  if (vote === 'approved' || vote === 'approvedWithSuggestions') return 'approve';
  if (vote === 'rejected') return 'requestChanges';
  return 'unapprove';
}

export function mapBuildStatusesToPolicy(statuses: BitbucketBuildStatus[]): PolicyEvaluation[] {
  return statuses.map((status) => ({
    policyId: status.key,
    displayName: status.name,
    status: mapBuildStatus(status.state),
    isBlocking: false,
  }));
}

function mapBuildStatus(state: BitbucketBuildStatus['state']): PolicyEvaluation['status'] {
  switch (state) {
    case 'SUCCESSFUL':
      return 'approved';
    case 'FAILED':
      return 'rejected';
    case 'INPROGRESS':
      return 'running';
    case 'STOPPED':
      return 'broken';
  }
}

/** Best-effort `#123` / `PROJ-123`-style scan — same deliberately-simple approach as GitHub/GitLab's. */
export function scanLinkedIssues(pr: Pick<BitbucketPullRequest, 'title' | 'description'>, repoWebUrl: string): WorkItemRef[] {
  const text = `${pr.title}\n${pr.description ?? ''}`;
  const ids = new Set<string>();
  for (const match of text.matchAll(/#(\d+)/g)) {
    const id = match[1];
    if (id) ids.add(id);
  }

  return [...ids].map((id) => ({ id, webUrl: `${repoWebUrl}/issues/${id}` }));
}

export function mapPullRequestDetail(
  pr: BitbucketPullRequest,
  participants: BitbucketParticipant[],
  buildStatuses: BitbucketBuildStatus[],
  repoWebUrl: string,
): PullRequestDetail {
  return {
    ...mapPullRequestEntry(pr, participants),
    description: pr.description ?? '',
    mergeStatus: 'notSet',
    ...(pr.source.commit?.hash ? { lastMergeSourceCommit: pr.source.commit.hash } : {}),
    ...(pr.destination.commit?.hash ? { lastMergeTargetCommit: pr.destination.commit.hash } : {}),
    commits: [],
    policies: mapBuildStatusesToPolicy(buildStatuses),
    workItems: scanLinkedIssues(pr, repoWebUrl),
    completionOptions: { deleteSourceBranch: false, squashMerge: false, bypassPolicy: false },
    capabilities: { waitingForAuthorVote: false, bypassPolicy: false, workItems: true },
  };
}

export function mapCommits(commits: BitbucketCommit[]): PullRequestCommit[] {
  return commits.map((commit) => {
    const match = /^(.*?)\s*<(.*)>$/.exec(commit.author.raw);
    return {
      commitId: commit.hash,
      author: {
        name: commit.author.user?.display_name ?? match?.[1] ?? commit.author.raw,
        email: match?.[2] ?? '',
      },
      date: commit.date,
      comment: commit.message,
    };
  });
}

/** General comments (no `inline`) form the synthetic id-0 thread; inline comments group by path+line. */
export function mapCommentThreads(comments: BitbucketComment[]): PullRequestCommentThread[] {
  const visible = comments.filter((comment) => !comment.deleted);
  const general = visible.filter((comment) => !comment.inline);
  const inline = visible.filter((comment) => comment.inline);

  const threads: PullRequestCommentThread[] = [];

  if (general.length > 0) {
    threads.push({ id: 0, status: 'active', comments: general.map(mapComment) });
  }

  const byLocation = new Map<string, BitbucketComment[]>();
  for (const comment of inline) {
    const key = `${comment.inline?.path ?? ''}:${comment.inline?.to ?? ''}`;
    const bucket = byLocation.get(key) ?? [];
    bucket.push(comment);
    byLocation.set(key, bucket);
  }

  let syntheticId = 1;
  for (const [, group] of byLocation) {
    const first = group[0];
    threads.push({
      id: syntheticId++,
      status: 'active',
      ...(first?.inline?.path
        ? { context: { filePath: first.inline.path, ...(first.inline.to !== undefined ? { rightFileLine: first.inline.to } : {}) } }
        : {}),
      comments: group.map(mapComment),
    });
  }

  return threads;
}

function mapComment(comment: BitbucketComment): PullRequestCommentThread['comments'][number] {
  return {
    id: comment.id,
    author: mapUser(comment.user),
    content: comment.content.raw,
    publishedAt: comment.created_on,
    commentType: 'text',
  };
}
