/**
 * Ways out of a git failure, read from git's own message.
 *
 * git already says what went wrong and usually what to do about it ("commit
 * your changes or stash them", "fetch first"). These turn that advice into a
 * button. Pure, so the matching is tested without a webview.
 */

export type FailureFix =
  /** Stash everything, then run the command that failed again. */
  | 'stashAndRetry'
  /** Open the Changes view to commit or discard what is in the way. */
  | 'reviewChanges'
  /** Open the Pull sheet: the remote has commits this branch lacks. */
  | 'pull'
  /** Open the Push sheet with --set-upstream: the branch has no upstream yet. */
  | 'pushSetUpstream'
  | 'openLog';

export interface GitFailure {
  /** What git printed, verbatim. */
  text: string;
  /** The argv that failed, when it can safely be run again. */
  retry?: string[];
}

const LOCAL_CHANGES = /would be overwritten by (checkout|merge|switch)|commit your changes or stash them|Your local changes to the following files/i;
const UNTRACKED = /untracked working tree files would be (overwritten|removed)/i;
const CONFLICT = /\bCONFLICT\b|fix conflicts|unmerged files|needs merge|resolve all conflicts/i;
const REJECTED = /\[rejected\]|fetch first|non-fast-forward|Updates were rejected/i;
const NO_UPSTREAM = /has no upstream branch|no tracking information/i;

/** The fixes worth offering for this failure, most likely first. */
export function fixesFor(failure: GitFailure): FailureFix[] {
  const fixes: FailureFix[] = [];
  const { text } = failure;

  if (LOCAL_CHANGES.test(text) || UNTRACKED.test(text)) {
    if (failure.retry) fixes.push('stashAndRetry');
    fixes.push('reviewChanges');
  } else if (CONFLICT.test(text)) {
    fixes.push('reviewChanges');
  }
  if (REJECTED.test(text)) fixes.push('pull');
  if (NO_UPSTREAM.test(text)) fixes.push('pushSetUpstream');

  fixes.push('openLog');
  return fixes;
}

/** A one-line headline for the card, so the verbatim text below can stay folded. */
export function headlineFor(text: string): string {
  if (LOCAL_CHANGES.test(text)) return 'Your uncommitted changes are in the way';
  if (UNTRACKED.test(text)) return 'Untracked files are in the way';
  if (CONFLICT.test(text)) return 'There are conflicts to resolve';
  if (REJECTED.test(text)) return 'The remote has commits you don’t have yet';
  if (NO_UPSTREAM.test(text)) return 'This branch has no upstream yet';
  if (/already checked out at|is already used by worktree/i.test(text)) return 'That branch is checked out in another worktree';
  return 'Git reported a problem';
}
