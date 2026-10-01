import type { CommandContext, CommandId } from '@shared/commands';
import type { BranchInfo, Commit, RefDecoration, WorktreeEntry } from '@shared/model';

/**
 * What a commit row offers: the double-click and the right-click menu.
 *
 * Pure, so the rules — which branch a double-click checks out, which actions are
 * disabled and why — are tested without a webview. The shell turns each action
 * into a command sheet, a direct `git switch`, or a host request.
 */

/** Something the shell can carry out for a commit. */
export type CommitAction =
  /** `git switch <branch>`, run directly — the sidebar's double-click does the same. */
  | { kind: 'switch'; branch: string }
  /** The branch is checked out in another worktree; offer that worktree instead. */
  | { kind: 'held'; branch: string; entry: WorktreeEntry }
  /** A command sheet, so the command is read (and editable) before it runs. */
  | { kind: 'command'; id: CommandId; context: Partial<CommandContext> }
  /** Ask where to save, then the Archive sheet. */
  | { kind: 'archive' }
  /** Ask where to save, then the Create Patch sheet. */
  | { kind: 'patch' }
  | { kind: 'copy'; text: string; label: string };

export interface CommitMenuEntry {
  label: string;
  action?: CommitAction;
  separator?: boolean;
  /** Why the entry cannot be used now; shown in place of running it. */
  disabled?: string;
  hint?: string;
  destructive?: boolean;
  /** What a double-click on the row would do. */
  default?: boolean;
}

/** What a double-click on a commit row does. */
export type CheckoutPlan =
  | CommitAction
  /** Several branches point here: show the menu so one can be chosen. */
  | { kind: 'choose' }
  /** Nothing to do, and why. */
  | { kind: 'none'; reason: string };

export type Head = Pick<BranchInfo, 'oid' | 'head' | 'detached'>;

/** Local branches decorating the commit, in the order git listed them. */
export function localBranches(commit: Commit): string[] {
  return commit.refs.filter((ref) => ref.kind === 'localBranch').map((ref) => ref.name);
}

/** Remote branches decorating the commit, without `origin/HEAD`, which only names a default. */
export function remoteBranches(commit: Commit): RefDecoration[] {
  return commit.refs.filter((ref) => ref.kind === 'remoteBranch' && !ref.name.endsWith('/HEAD'));
}

/** The local name a remote branch checks out as: `origin/feature/x` → `feature/x`. */
export function localNameOf(ref: RefDecoration): string {
  const prefix = ref.remote ? `${ref.remote}/` : '';
  return prefix && ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name.replace(/^[^/]+\//, '');
}

export function isHeadCommit(commit: Commit, head: Head): boolean {
  return head.oid === commit.hash || commit.refs.some((ref) => ref.kind === 'head');
}

function isCurrent(branch: string, head: Head): boolean {
  return !head.detached && head.head === branch;
}

/** The name an action on this commit uses: its branch if it has one, else its id. */
function targetName(commit: Commit, head: Head): string {
  const local = localBranches(commit).find((name) => !isCurrent(name, head));
  if (local) return local;
  const remote = remoteBranches(commit)[0];
  if (remote) return remote.name;
  return commit.hash;
}

function display(name: string, commit: Commit): string {
  return name === commit.hash ? commit.shortHash : name;
}

/**
 * Double-click: check out the commit's branch.
 *
 * One local branch is switched to at once, exactly like double-clicking it in
 * the sidebar. Anything that would create a branch (a remote branch) or leave
 * you on no branch (a bare commit) opens its sheet instead, so that is read
 * before it happens.
 */
export function checkoutPlan(commit: Commit, head: Head, heldBy: ReadonlyMap<string, WorktreeEntry>): CheckoutPlan {
  const locals = localBranches(commit);
  const candidates = locals.filter((name) => !isCurrent(name, head));

  if (candidates.length > 1) return { kind: 'choose' };

  const only = candidates[0];
  if (only !== undefined) {
    const holder = heldBy.get(only);
    return holder ? { kind: 'held', branch: only, entry: holder } : { kind: 'switch', branch: only };
  }

  if (locals.length > 0) return { kind: 'none', reason: `${head.head ?? locals[0]} is already checked out.` };

  const remotes = remoteBranches(commit);
  if (remotes.length > 1) return { kind: 'choose' };
  const remote = remotes[0];
  if (remote) return { kind: 'command', id: 'branch.checkout', context: { branch: remote.name, track: true } };

  if (head.detached && head.oid === commit.hash) return { kind: 'none', reason: 'This commit is already checked out.' };
  return { kind: 'command', id: 'commit.checkout', context: { commitish: commit.hash } };
}

const SEPARATOR: CommitMenuEntry = { label: '', separator: true };

/** The right-click menu for a commit row. */
export function commitMenu(commit: Commit, head: Head, heldBy: ReadonlyMap<string, WorktreeEntry>): CommitMenuEntry[] {
  const entries: CommitMenuEntry[] = [];
  const onHead = isHeadCommit(commit, head);
  const isMerge = commit.parents.length > 1;
  const current = head.detached || !head.head ? 'HEAD' : head.head;
  const plan = checkoutPlan(commit, head, heldBy);

  /* Check out -------------------------------------------------------------- */

  const locals = localBranches(commit);
  for (const name of locals) {
    const holder = heldBy.get(name);
    if (isCurrent(name, head)) {
      entries.push({ label: `Check Out ${name}`, disabled: 'Already checked out.' });
    } else if (holder) {
      entries.push({
        label: `Check Out ${name}`,
        disabled: `Checked out in ${holder.path}. A branch can be checked out in one worktree at a time.`,
      });
      entries.push({ label: `Open the Worktree of ${name}…`, action: { kind: 'held', branch: name, entry: holder } });
    } else {
      entries.push({
        label: `Check Out ${name}`,
        action: { kind: 'switch', branch: name },
        default: plan.kind === 'switch' && plan.branch === name,
      });
    }
  }

  for (const remote of remoteBranches(commit)) {
    const local = localNameOf(remote);
    if (locals.includes(local)) continue;
    entries.push({
      label: `Check Out ${remote.name} as ${local}…`,
      hint: `Create a local ${local} that follows ${remote.name}, and switch to it`,
      action: { kind: 'command', id: 'branch.checkout', context: { branch: remote.name, track: true } },
      default: plan.kind === 'command' && plan.id === 'branch.checkout' && plan.context.branch === remote.name,
    });
  }

  entries.push({
    label: 'Check Out This Commit (Detached)…',
    hint: 'Look at this commit on no branch; every branch stays where it is',
    action: { kind: 'command', id: 'commit.checkout', context: { commitish: commit.hash } },
    default: plan.kind === 'command' && plan.id === 'commit.checkout',
    ...(head.detached && head.oid === commit.hash ? { disabled: 'This commit is already checked out.' } : {}),
  });

  /* Integrate -------------------------------------------------------------- */

  const target = targetName(commit, head);
  const onHeadReason = { disabled: `This is the commit ${current} is on.` };
  entries.push(SEPARATOR);
  entries.push({
    label: `Merge ${display(target, commit)} into ${current}…`,
    action: { kind: 'command', id: 'merge', context: { branch: target } },
    ...(onHead ? onHeadReason : {}),
  });
  entries.push({
    label: `Rebase ${current} onto ${display(target, commit)}…`,
    action: { kind: 'command', id: 'rebase', context: { commitish: target } },
    ...(onHead ? onHeadReason : {}),
  });

  /* Name it ---------------------------------------------------------------- */

  entries.push(SEPARATOR);
  entries.push({
    label: 'New Branch Here…',
    action: { kind: 'command', id: 'branch.create', context: { startPoint: commit.hash, checkoutAfterCreate: true } },
  });
  entries.push({
    label: 'New Tag Here…',
    action: { kind: 'command', id: 'tag.create', context: { commitish: commit.hash, annotated: true } },
  });

  /* Change history --------------------------------------------------------- */

  const mainline = isMerge ? { mainline: 1 } : {};
  entries.push(SEPARATOR);
  entries.push({
    label: `Cherry-pick onto ${current}…`,
    hint: 'Copy this commit’s change onto the current branch as a new commit',
    action: { kind: 'command', id: 'cherryPick', context: { commitish: commit.hash, ...mainline } },
    ...(onHead ? { disabled: `This commit is already on ${current}.` } : {}),
  });
  entries.push({
    label: 'Reverse Commit…',
    hint: 'Add a new commit that undoes this one (git revert)',
    action: { kind: 'command', id: 'revert', context: { commitish: commit.hash, ...mainline } },
  });
  entries.push({
    label: `Reset ${current} to This Commit…`,
    hint: 'Move the current branch here: soft, mixed, or hard',
    destructive: true,
    action: { kind: 'command', id: 'reset', context: { commitish: commit.hash, resetMode: 'mixed' } },
    ...(head.oid === undefined ? { disabled: 'This repository has no commits yet.' } : {}),
  });

  /* Export ----------------------------------------------------------------- */

  entries.push(SEPARATOR);
  entries.push({ label: 'Archive…', hint: 'Save this commit’s files as a .zip or .tar.gz', action: { kind: 'archive' } });
  entries.push({
    label: 'Create Patch…',
    hint: 'Save this commit as a .patch file for git am',
    action: { kind: 'patch' },
    ...(isMerge ? { disabled: 'A merge commit has no single change to write; git format-patch skips merges.' } : {}),
  });

  entries.push(SEPARATOR);
  entries.push({ label: 'Copy SHA', action: { kind: 'copy', text: commit.hash, label: `Copied ${commit.shortHash}` } });
  entries.push({ label: 'Copy Short SHA', action: { kind: 'copy', text: commit.shortHash, label: `Copied ${commit.shortHash}` } });

  return entries;
}
