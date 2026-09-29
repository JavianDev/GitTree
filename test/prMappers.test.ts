import { describe, expect, it } from 'vitest';
import type { PullRequestVote } from '../src/shared/model';
import {
  bitbucketStateToStatus,
  mapPullRequestEntry as mapBitbucketEntry,
  statusToBitbucketState,
  voteToBitbucketAction,
} from '../src/extension/pullRequests/providers/bitbucketMappers';
import {
  codeToVote,
  mapPullRequestEntry as mapAdoEntry,
  voteToCode,
} from '../src/extension/pullRequests/providers/azureDevOpsMappers';
import {
  githubStateToStatus,
  mapPullRequestEntry as mapGithubEntry,
  reviewStateToVote,
  scanLinkedIssues,
  voteToReviewEvent,
} from '../src/extension/pullRequests/providers/githubMappers';
import {
  gitlabStateToStatus,
  mapPullRequestEntry as mapGitlabEntry,
  voteToApproval,
} from '../src/extension/pullRequests/providers/gitlabMappers';

const ALL_VOTES: PullRequestVote[] = ['approved', 'approvedWithSuggestions', 'noVote', 'waitingForAuthor', 'rejected'];

describe('Azure DevOps — vote code round-trip', () => {
  it('round-trips every vote through its numeric code', () => {
    for (const vote of ALL_VOTES) {
      expect(codeToVote(voteToCode(vote))).toBe(vote);
    }
  });

  it('matches the codes documented by the Azure DevOps REST API', () => {
    expect(voteToCode('approved')).toBe(10);
    expect(voteToCode('approvedWithSuggestions')).toBe(5);
    expect(voteToCode('noVote')).toBe(0);
    expect(voteToCode('waitingForAuthor')).toBe(-5);
    expect(voteToCode('rejected')).toBe(-10);
  });

  it('maps an entry with a required reviewer and its vote', () => {
    const entry = mapAdoEntry(
      {
        pullRequestId: 412,
        title: 'Fix null ref in scheduler',
        status: 'active',
        isDraft: false,
        createdBy: { id: 'u1', displayName: 'Ada' },
        sourceRefName: 'refs/heads/feature/sched-fix',
        targetRefName: 'refs/heads/main',
        creationDate: '2024-01-01T00:00:00Z',
        reviewers: [{ id: 'u2', displayName: 'Grace', vote: 10, isRequired: true }],
      },
      'https://dev.azure.com/contoso/WebApp/_git/frontend/pullrequest/412',
    );

    expect(entry.provider).toBe('azureDevOps');
    expect(entry.sourceBranch).toBe('feature/sched-fix');
    expect(entry.targetBranch).toBe('main');
    expect(entry.reviewers).toEqual([
      { identity: { id: 'u2', displayName: 'Grace' }, vote: 'approved', isRequired: true },
    ]);
  });
});

describe('GitHub — review state and merge status', () => {
  it('maps every review state to a vote', () => {
    expect(reviewStateToVote('APPROVED')).toBe('approved');
    expect(reviewStateToVote('CHANGES_REQUESTED')).toBe('rejected');
    expect(reviewStateToVote('COMMENTED')).toBe('noVote');
    expect(reviewStateToVote('DISMISSED')).toBe('noVote');
    expect(reviewStateToVote('PENDING')).toBe('noVote');
  });

  it('has no separate reject/wait review event — both collapse to REQUEST_CHANGES/COMMENT', () => {
    expect(voteToReviewEvent('approved')).toBe('APPROVE');
    expect(voteToReviewEvent('approvedWithSuggestions')).toBe('APPROVE');
    expect(voteToReviewEvent('rejected')).toBe('REQUEST_CHANGES');
    expect(voteToReviewEvent('waitingForAuthor')).toBe('COMMENT');
    expect(voteToReviewEvent('noVote')).toBe('COMMENT');
  });

  it('distinguishes completed from abandoned via merged_at, since GitHub only has open/closed', () => {
    expect(githubStateToStatus({ state: 'open', merged_at: null })).toBe('active');
    expect(githubStateToStatus({ state: 'closed', merged_at: '2024-01-01T00:00:00Z' })).toBe('completed');
    expect(githubStateToStatus({ state: 'closed', merged_at: null })).toBe('abandoned');
  });

  it('scans title and body for #123-style linked issues', () => {
    const refs = scanLinkedIssues(
      { title: 'Fix crash (closes #42)', body: 'See also #7 for background.' },
      'https://github.com/owner/repo',
    );
    expect(refs.map((ref) => ref.id).sort()).toEqual(['42', '7']);
  });

  it('maps a pull to an entry with the #-free ref names', () => {
    const entry = mapGithubEntry({
      number: 9,
      title: 'Add PR pane',
      state: 'open',
      draft: true,
      merged_at: null,
      user: { id: 1, login: 'jsmith' },
      head: { ref: 'feature/pr-pane', sha: 'abc' },
      base: { ref: 'main', sha: 'def' },
      created_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/9',
      body: null,
    });
    expect(entry).toMatchObject({ provider: 'github', id: 9, isDraft: true, sourceBranch: 'feature/pr-pane' });
  });
});

describe('GitLab — state mapping and approval action', () => {
  it('maps opened/merged/closed to active/completed/abandoned', () => {
    expect(gitlabStateToStatus('opened')).toBe('active');
    expect(gitlabStateToStatus('locked')).toBe('active');
    expect(gitlabStateToStatus('merged')).toBe('completed');
    expect(gitlabStateToStatus('closed')).toBe('abandoned');
  });

  it('has no reject vote — only approve/unapprove', () => {
    expect(voteToApproval('approved')).toBe('approve');
    expect(voteToApproval('approvedWithSuggestions')).toBe('approve');
    expect(voteToApproval('rejected')).toBe('unapprove');
    expect(voteToApproval('waitingForAuthor')).toBe('unapprove');
    expect(voteToApproval('noVote')).toBe('unapprove');
  });

  it('maps a merge request to an entry, with approvers as approved reviewers', () => {
    const entry = mapGitlabEntry(
      {
        iid: 55,
        title: 'Bump dependency versions',
        state: 'opened',
        draft: false,
        author: { id: 3, username: 'atran', name: 'Anh Tran' },
        source_branch: 'chore/bump-deps',
        target_branch: 'main',
        created_at: '2024-01-01T00:00:00Z',
        web_url: 'https://gitlab.com/group/project/-/merge_requests/55',
        description: null,
        sha: 'abc',
      },
      [{ id: 4, username: 'reviewer', name: 'Rae Viewer' }],
    );
    expect(entry.provider).toBe('gitlab');
    expect(entry.reviewers).toEqual([
      { identity: { id: '4', displayName: 'Rae Viewer', uniqueName: 'reviewer' }, vote: 'approved', isRequired: false },
    ]);
  });
});

describe('Bitbucket — state mapping, votes, and reviewers', () => {
  it('maps OPEN/MERGED/DECLINED/SUPERSEDED to active/completed/abandoned', () => {
    expect(bitbucketStateToStatus('OPEN')).toBe('active');
    expect(bitbucketStateToStatus('MERGED')).toBe('completed');
    expect(bitbucketStateToStatus('DECLINED')).toBe('abandoned');
    expect(bitbucketStateToStatus('SUPERSEDED')).toBe('abandoned');
  });

  it('maps the status filter back to the API state', () => {
    expect(statusToBitbucketState('active')).toBe('OPEN');
    expect(statusToBitbucketState('completed')).toBe('MERGED');
    expect(statusToBitbucketState('abandoned')).toBe('DECLINED');
  });

  it('maps votes to the approve / request-changes endpoints', () => {
    expect(voteToBitbucketAction('approved')).toBe('approve');
    expect(voteToBitbucketAction('approvedWithSuggestions')).toBe('approve');
    expect(voteToBitbucketAction('rejected')).toBe('requestChanges');
    expect(voteToBitbucketAction('noVote')).toBe('unapprove');
  });

  it('maps a pull request with only REVIEWER participants as reviewers', () => {
    const user = (uuid: string, name: string) => ({ uuid, display_name: name });
    const entry = mapBitbucketEntry(
      {
        id: 17,
        title: 'Add export button',
        state: 'OPEN',
        author: user('{a}', 'Ada'),
        source: { branch: { name: 'feature/export' } },
        destination: { branch: { name: 'main' } },
        created_on: '2024-01-01T00:00:00Z',
        description: null,
        links: { html: { href: 'https://bitbucket.org/acme/web-app/pull-requests/17' } },
      },
      [
        { user: user('{g}', 'Grace'), role: 'REVIEWER', approved: true, state: 'approved' },
        { user: user('{l}', 'Linus'), role: 'REVIEWER', approved: false, state: 'changes_requested' },
        { user: user('{p}', 'Pat'), role: 'PARTICIPANT', approved: false, state: null },
      ],
    );

    expect(entry).toMatchObject({ provider: 'bitbucket', id: 17, sourceBranch: 'feature/export', targetBranch: 'main' });
    expect(entry.reviewers.map((reviewer) => [reviewer.identity.displayName, reviewer.vote])).toEqual([
      ['Grace', 'approved'],
      ['Linus', 'rejected'],
    ]);
  });
});
