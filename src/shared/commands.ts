/**
 * The command registry — one definition per action, shared by both sides.
 *
 * GitTree's premise is that using the GUI teaches you git. That only holds if
 * the command shown in the preview is *the same command that runs*. Rather than
 * trusting two code paths to stay in step, the argv is built by one function
 * that both sides import: the webview calls `build()` to render the preview, and
 * the host calls the same `build()` to produce what it spawns. Drift is not a
 * bug that can be introduced here — there is only one place to change.
 */

export type CommandId =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'commit'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'branch.create'
  | 'branch.checkout'
  | 'branch.delete'
  | 'merge'
  | 'merge.abort'
  | 'rebase.continue'
  | 'rebase.skip'
  | 'rebase.abort'
  | 'cherryPick.continue'
  | 'cherryPick.abort'
  | 'revert.continue'
  | 'revert.abort'
  | 'stash.push'
  | 'stash.apply'
  | 'stash.pop'
  | 'stash.drop'
  | 'tag.create'
  | 'worktree.add'
  | 'worktree.remove'
  | 'worktree.lock'
  | 'worktree.unlock'
  | 'worktree.move'
  | 'worktree.prune'
  | 'worktree.repair'
  | 'branch.deleteGone'
  | 'commit.checkout'
  | 'rebase'
  | 'cherryPick'
  | 'revert'
  | 'reset'
  | 'archive'
  | 'formatPatch';

/** Where the action sits in the toolbar's visual rhythm. */
export type CommandGroup = 'sync' | 'work' | 'branch' | 'tag' | 'tools';

export interface CommandFlag {
  flag: string;
  /** Plain-English gloss. Not the man page — what it means for *this* action. */
  gloss: string;
}

/**
 * Values an action needs to become a concrete command. Every field is optional
 * so a preview can render with whatever is known so far.
 */
export interface CommandContext {
  remote?: string;
  branch?: string;
  upstream?: string;
  paths?: string[];
  message?: string;
  /** Push/pull refinements. */
  setUpstream?: boolean;
  force?: boolean;
  tags?: boolean;
  prune?: boolean;
  rebase?: boolean;
  autostash?: boolean;
  all?: boolean;
  /** Commit refinements. */
  amend?: boolean;
  signoff?: boolean;
  sign?: boolean;
  /** Merge refinements. */
  noFastForward?: boolean;
  squash?: boolean;
  /** Stash refinements. */
  keepIndex?: boolean;
  stagedOnly?: boolean;
  includeUntracked?: boolean;
  stashRef?: string;
  /** Branch refinements. */
  checkoutAfterCreate?: boolean;
  forceDelete?: boolean;
  startPoint?: string;
  /** Tag refinements. */
  annotated?: boolean;
  tagName?: string;
  /** Worktree refinements. */
  worktreePath?: string;
  newPath?: string;
  newBranch?: string;
  commitish?: string;
  detach?: boolean;
  track?: boolean;
  noTrack?: boolean;
  lockReason?: string;
  /** A locked worktree needs `--force` twice to remove or move. */
  forceLocked?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  /** Several branches at once (clean up gone branches). */
  branches?: string[];
  /** Pull refinement: only fast-forward. */
  ffOnly?: boolean;
  /** Reset refinement: what happens to the work between the old and new commit. */
  resetMode?: ResetMode;
  /** Cherry-pick refinement: record where the change came from (`-x`). */
  recordOrigin?: boolean;
  /** Cherry-pick and revert refinement: change the files and index, but do not commit. */
  noCommit?: boolean;
  /** Cherry-pick and revert of a merge commit: the parent the change is measured against. */
  mainline?: number;
  /** Archive and patch: the file to write. */
  outputPath?: string;
  /** Archive refinement; follows the chosen file's extension. */
  archiveFormat?: ArchiveFormat;
}

export type ResetMode = 'soft' | 'mixed' | 'hard';
export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz';

export interface CommandSpec {
  id: CommandId;
  title: string;
  group: CommandGroup;
  /** One line, present tense: what this does to the repository. */
  summary: string;
  /** Longer teaching text: the concept behind the command. */
  concept?: string;
  /** Flags this command may use, glossed. Rendered under the preview. */
  flags: CommandFlag[];
  /** True when the action can lose work; gates a confirmation sheet. */
  destructive?: boolean;
  /**
   * For a command that can lose work only with some flags (`reset --hard`):
   * judged from the argv about to run, so a flag typed by hand counts too.
   */
  destructiveWhen?: (argv: readonly string[]) => boolean;
  /** Builds the argv, without the leading `git`. */
  build: (ctx: CommandContext) => string[];
}

/* -------------------------------------------------------------------------- */

const FLAG: Record<string, CommandFlag> = {
  prune: { flag: '--prune', gloss: 'delete local copies of branches that no longer exist on the remote' },
  all: { flag: '--all', gloss: 'apply to every remote, not just this one' },
  tags: { flag: '--tags', gloss: 'include tags as well as branches' },
  rebase: { flag: '--rebase', gloss: 'replay your commits on top of theirs instead of creating a merge commit' },
  autostash: { flag: '--autostash', gloss: 'shelve uncommitted work first and restore it afterwards' },
  setUpstream: { flag: '--set-upstream', gloss: 'remember this remote branch as the default for future push and pull' },
  forceLease: {
    flag: '--force-with-lease',
    gloss: 'overwrite the remote branch, but refuse if someone else pushed since you last fetched',
  },
  amend: { flag: '--amend', gloss: 'replace the previous commit instead of adding a new one' },
  signoff: { flag: '--signoff', gloss: 'append a Signed-off-by trailer with your name' },
  sign: { flag: '-S', gloss: 'cryptographically sign the commit' },
  messageStdin: { flag: '-F -', gloss: 'read the message from standard input, so any character is safe' },
  noFf: { flag: '--no-ff', gloss: 'always create a merge commit, even when a fast-forward is possible' },
  squash: { flag: '--squash', gloss: 'stage their changes as one commit without recording the merge' },
  staged: { flag: '--staged', gloss: 'stash only what is staged, leaving the rest of your work in place' },
  keepIndex: { flag: '--keep-index', gloss: 'stash everything but leave the staged version in the working tree' },
  includeUntracked: { flag: '--include-untracked', gloss: 'stash new files git is not tracking yet' },
  worktree: { flag: '--worktree', gloss: 'restore the file on disk from the index' },
  stagedRestore: { flag: '--staged', gloss: 'remove the change from the index, keeping it on disk' },
  deleteBranch: { flag: '-d', gloss: 'delete the branch, refusing if it holds unmerged commits' },
  forceDeleteBranch: { flag: '-D', gloss: 'delete the branch even if its commits are unmerged and would be lost' },
  annotate: { flag: '-a', gloss: 'create a tag object with a message, author, and date rather than a bare pointer' },
  separator: { flag: '--', gloss: 'end of options — everything after this is a path, even if it starts with a dash' },
  ffOnly: { flag: '--ff-only', gloss: 'only move forward to the remote’s commits; stop rather than merge or rebase' },
  newBranch: { flag: '-b', gloss: 'create this new branch and check it out in the new worktree' },
  track: { flag: '--track', gloss: 'make the new branch follow the remote branch it starts from' },
  noTrack: { flag: '--no-track', gloss: 'do not set the starting branch as the new branch’s upstream' },
  detach: { flag: '--detach', gloss: 'check out the commit itself, on no branch — for reviewing a tag or commit' },
  force: { flag: '--force', gloss: 'go ahead even though the worktree has uncommitted changes, which are lost' },
  forceTwice: { flag: '--force --force', gloss: 'also go ahead when the worktree is locked' },
  reason: { flag: '--reason', gloss: 'record why it is locked; shown wherever the worktree is listed' },
  dryRun: { flag: '--dry-run', gloss: 'only report what would be pruned; change nothing' },
  verbose: { flag: '--verbose', gloss: 'name each worktree record as it is removed' },
  detachCommit: { flag: '--detach', gloss: 'move HEAD to the commit itself, on no branch' },
  trackRemote: { flag: '--track', gloss: 'create a local branch of the same name that follows this remote branch' },
  recordOrigin: { flag: '-x', gloss: 'add "(cherry picked from commit …)" to the new commit’s message' },
  noCommit: { flag: '--no-commit', gloss: 'apply the change to your files and index, but let you commit it yourself' },
  mainline: { flag: '-m', gloss: 'for a merge commit: which parent the change is measured against (1 is the branch it was merged into)' },
  noEdit: { flag: '--no-edit', gloss: 'keep git’s own message rather than opening an editor' },
  soft: { flag: '--soft', gloss: 'keep every change in between, staged' },
  mixed: { flag: '--mixed', gloss: 'keep every change in between in your files, unstaged' },
  hard: { flag: '--hard', gloss: 'throw away every change in between, and any uncommitted work' },
  format: { flag: '--format', gloss: 'the archive type: zip, tar, or tar.gz' },
  outputFile: { flag: '-o', gloss: 'the file to write' },
  oneCommit: { flag: '-1', gloss: 'just this commit, not the ones before it' },
  output: { flag: '--output', gloss: 'write the patch to this file instead of to the screen' },
};

/** A worktree's concept card: the same idea, said once. */
const WORKTREE_CONCEPT =
  'A worktree is a second folder checked out from the same repository. Every worktree shares one ' +
  'object store and one set of branches, so there is nothing to clone and a commit made in one is ' +
  'immediately visible in the others. Each has its own branch, files, and staged changes — so you can ' +
  'review a pull request, run a long build, or fix a bug on another branch without stashing or ' +
  'switching what you are working on. A branch can be checked out in only one worktree at a time.';

/** Appends `--` and the paths, so a filename can never be read as a flag. */
function withPaths(argv: string[], paths: string[] | undefined): string[] {
  if (!paths || paths.length === 0) return argv;
  return [...argv, '--', ...paths];
}

export const COMMANDS: Record<CommandId, CommandSpec> = {
  fetch: {
    id: 'fetch',
    title: 'Fetch',
    group: 'sync',
    summary: 'Download new commits and branches from the remote without changing your files.',
    concept:
      'Fetch is the safe half of "pull". It updates your record of what the remote looks like — the ' +
      'origin/* branches — and touches nothing you are working on. Your branch, your files, and your ' +
      'staged work are all untouched, which is why fetching is never something you need to undo. ' +
      'After fetching you can see how far ahead or behind you are before deciding what to do about it.',
    flags: [FLAG.prune!, FLAG.all!, FLAG.tags!],
    build: (ctx) => {
      const argv = ['fetch'];
      if (ctx.prune) argv.push('--prune');
      if (ctx.tags) argv.push('--tags');
      if (ctx.all) argv.push('--all');
      else if (ctx.remote) argv.push(ctx.remote);
      return argv;
    },
  },

  pull: {
    id: 'pull',
    title: 'Pull',
    group: 'sync',
    summary: 'Fetch from the remote and integrate those commits into your current branch.',
    concept:
      'Pull is fetch followed by integration, and the interesting choice is how it integrates. ' +
      'A merge keeps both histories and adds a commit joining them, which is honest but noisy on a ' +
      'busy branch. A rebase replays your commits on top of theirs so history stays linear, at the ' +
      'cost of rewriting your commits — fine for work only you have, risky for commits others have pulled. ' +
      'Add --autostash and uncommitted work is shelved and restored around the operation.',
    flags: [FLAG.rebase!, FLAG.autostash!, FLAG.prune!, FLAG.ffOnly!],
    build: (ctx) => {
      const argv = ['pull'];
      if (ctx.ffOnly) argv.push('--ff-only');
      if (ctx.rebase) argv.push('--rebase');
      if (ctx.autostash) argv.push('--autostash');
      if (ctx.prune) argv.push('--prune');
      if (ctx.remote) argv.push(ctx.remote);
      if (ctx.branch) argv.push(ctx.branch);
      return argv;
    },
  },

  push: {
    id: 'push',
    title: 'Push',
    group: 'sync',
    summary: 'Send your commits to the remote branch.',
    concept:
      'Push uploads commits the remote does not have. It is refused if the remote has commits you do ' +
      'not, because accepting would discard someone else\'s work — fetch and integrate first. ' +
      'When you genuinely need to overwrite, prefer --force-with-lease over --force: it checks that ' +
      'the remote is still where you last saw it, so it refuses rather than silently destroying a ' +
      'colleague\'s push that landed in the meantime.',
    flags: [FLAG.setUpstream!, FLAG.tags!, FLAG.forceLease!],
    destructive: false,
    build: (ctx) => {
      const argv = ['push'];
      if (ctx.force) argv.push('--force-with-lease');
      if (ctx.setUpstream) argv.push('--set-upstream');
      if (ctx.tags) argv.push('--tags');
      if (ctx.remote) argv.push(ctx.remote);
      if (ctx.branch) argv.push(ctx.branch);
      return argv;
    },
  },

  commit: {
    id: 'commit',
    title: 'Commit',
    group: 'work',
    summary: 'Record the staged changes as a new commit.',
    concept:
      'A commit records what is in the index — the staged snapshot — not what is on disk. That gap is ' +
      'the point: you choose exactly which changes belong together, down to individual lines, and leave ' +
      'the rest for the next commit. --amend replaces the previous commit rather than adding one, which ' +
      'is ideal for a typo in the message and dangerous once the commit has been pushed, because everyone ' +
      'else already has the version you just replaced.',
    flags: [FLAG.messageStdin!, FLAG.amend!, FLAG.signoff!, FLAG.sign!],
    build: (ctx) => {
      const argv = ['commit', '-F', '-'];
      if (ctx.amend) argv.push('--amend');
      if (ctx.signoff) argv.push('--signoff');
      if (ctx.sign) argv.push('-S');
      return argv;
    },
  },

  stage: {
    id: 'stage',
    title: 'Stage',
    group: 'work',
    summary: 'Add these changes to the staged snapshot for the next commit.',
    concept:
      'Staging moves a change into the index, a staging area between your files and history. It exists ' +
      'so a commit can be smaller than everything you have changed — you can stage one function and ' +
      'leave the debugging print behind.',
    flags: [FLAG.separator!],
    build: (ctx) => withPaths(['add'], ctx.paths),
  },

  unstage: {
    id: 'unstage',
    title: 'Unstage',
    group: 'work',
    summary: 'Take these changes back out of the staged snapshot, leaving the files alone.',
    flags: [FLAG.stagedRestore!, FLAG.separator!],
    build: (ctx) => withPaths(['restore', '--staged'], ctx.paths),
  },

  discard: {
    id: 'discard',
    title: 'Discard',
    group: 'work',
    summary: 'Throw away these changes and restore the files as they were.',
    concept:
      'Discarding overwrites your files from the index and the change is not recoverable — it was never ' +
      'committed, so there is nothing for git to restore it from. If you are unsure, stash instead: ' +
      'it clears your working tree just the same but keeps the changes retrievable.',
    flags: [FLAG.worktree!, FLAG.separator!],
    destructive: true,
    build: (ctx) => withPaths(['restore', '--worktree'], ctx.paths),
  },

  'branch.create': {
    id: 'branch.create',
    title: 'New Branch',
    group: 'branch',
    summary: 'Create a branch pointing at the current commit.',
    concept:
      'A branch is a movable name for a commit — that is the whole of it. Creating one costs nothing ' +
      'and copies nothing; it writes a file containing a hash. That is why branching freely is normal ' +
      'in git and expensive in older version control systems.',
    flags: [],
    build: (ctx) => {
      // `||`, not `??`: an empty name field would otherwise vanish from the argv
      // and git would read the start point as the new branch's name.
      const name = ctx.branch || '<name>';
      const argv = ctx.checkoutAfterCreate ? ['switch', '--create', name] : ['branch', name];
      if (ctx.startPoint) argv.push(ctx.startPoint);
      return argv;
    },
  },

  'branch.checkout': {
    id: 'branch.checkout',
    title: 'Checkout',
    group: 'branch',
    summary: 'Switch your working tree to this branch.',
    concept:
      'switch is the modern, single-purpose replacement for checkout, which did too many unrelated jobs ' +
      'and made mistakes easy. It moves HEAD to the branch and updates your files to match. ' +
      'Uncommitted work travels with you when it does not conflict, and blocks the switch when it does.',
    flags: [FLAG.trackRemote!],
    build: (ctx) => ['switch', ...(ctx.track ? ['--track'] : []), ctx.branch ?? '<branch>'],
  },

  'branch.delete': {
    id: 'branch.delete',
    title: 'Delete Branch',
    group: 'branch',
    summary: 'Remove this branch name.',
    concept:
      'Deleting a branch removes the name, not the commits. With -d git refuses if the commits are not ' +
      'merged anywhere, because losing the name would leave them unreachable. -D overrides that check — ' +
      'the commits survive in the reflog for a while, but nothing points at them.',
    flags: [FLAG.deleteBranch!, FLAG.forceDeleteBranch!],
    destructive: true,
    build: (ctx) => ['branch', ctx.forceDelete ? '-D' : '-d', ctx.branch ?? '<branch>'],
  },

  merge: {
    id: 'merge',
    title: 'Merge',
    group: 'branch',
    summary: 'Bring another branch’s commits into this one.',
    concept:
      'Merge joins two histories. When your branch has not moved, git can simply slide the pointer ' +
      'forward — a fast-forward, leaving no trace that a branch existed. --no-ff forces a merge commit ' +
      'so the branch remains visible in history. --squash is different again: it stages the combined ' +
      'result without recording the merge, so the other branch\'s commits never appear.',
    flags: [FLAG.noFf!, FLAG.squash!],
    build: (ctx) => {
      const argv = ['merge'];
      if (ctx.noFastForward) argv.push('--no-ff');
      if (ctx.squash) argv.push('--squash');
      argv.push(ctx.branch ?? '<branch>');
      return argv;
    },
  },

  'merge.abort': {
    id: 'merge.abort',
    title: 'Abort Merge',
    group: 'branch',
    summary: 'Stop the merge and return to how the branch looked before it started.',
    flags: [],
    destructive: true,
    build: () => ['merge', '--abort'],
  },

  'rebase.continue': {
    id: 'rebase.continue',
    title: 'Continue Rebase',
    group: 'branch',
    summary: 'Recommit the current step now that its conflicts are resolved, and move to the next one.',
    flags: [],
    build: () => ['rebase', '--continue'],
  },

  'rebase.skip': {
    id: 'rebase.skip',
    title: 'Skip Commit',
    group: 'branch',
    summary: 'Drop the commit currently being replayed and move to the next one.',
    concept:
      'The commit being replayed is left out of the rebase entirely — its changes do not appear on ' +
      'the branch afterward. Prefer resolving and continuing unless this commit is genuinely redundant.',
    flags: [],
    destructive: true,
    build: () => ['rebase', '--skip'],
  },

  'rebase.abort': {
    id: 'rebase.abort',
    title: 'Abort Rebase',
    group: 'branch',
    summary: 'Stop the rebase and return the branch to how it looked before it started.',
    flags: [],
    destructive: true,
    build: () => ['rebase', '--abort'],
  },

  'cherryPick.continue': {
    id: 'cherryPick.continue',
    title: 'Continue Cherry-pick',
    group: 'branch',
    summary: 'Commit the cherry-picked change now that its conflicts are resolved.',
    flags: [],
    build: () => ['cherry-pick', '--continue'],
  },

  'cherryPick.abort': {
    id: 'cherryPick.abort',
    title: 'Abort Cherry-pick',
    group: 'branch',
    summary: 'Stop the cherry-pick and return to how the branch looked before it started.',
    flags: [],
    destructive: true,
    build: () => ['cherry-pick', '--abort'],
  },

  'revert.continue': {
    id: 'revert.continue',
    title: 'Continue Revert',
    group: 'branch',
    summary: 'Commit the revert now that its conflicts are resolved.',
    flags: [],
    build: () => ['revert', '--continue'],
  },

  'revert.abort': {
    id: 'revert.abort',
    title: 'Abort Revert',
    group: 'branch',
    summary: 'Stop the revert and return to how the branch looked before it started.',
    flags: [],
    destructive: true,
    build: () => ['revert', '--abort'],
  },

  'stash.push': {
    id: 'stash.push',
    title: 'Stash',
    group: 'work',
    summary: 'Shelve your uncommitted changes and return to a clean working tree.',
    concept:
      'A stash is a commit that is not on any branch, saved so you can get a clean tree without ' +
      'discarding work or making a commit you do not want. Untracked files are left behind unless you ' +
      'ask for them — a stash that quietly skipped your new file is a common way to lose one.',
    flags: [FLAG.staged!, FLAG.keepIndex!, FLAG.includeUntracked!],
    build: (ctx) => {
      const argv = ['stash', 'push'];
      if (ctx.stagedOnly) argv.push('--staged');
      if (ctx.keepIndex) argv.push('--keep-index');
      if (ctx.includeUntracked) argv.push('--include-untracked');
      if (ctx.message) argv.push('-m', ctx.message);
      return argv;
    },
  },

  'stash.apply': {
    id: 'stash.apply',
    title: 'Apply Stash',
    group: 'work',
    summary: 'Reapply the stashed changes and keep them in the stash list.',
    concept:
      'apply reapplies the stash without deleting it; pop applies and then deletes it. Prefer apply when ' +
      'the stash might conflict — the entry survives no matter how the apply goes, so a bad merge costs ' +
      'nothing, and you can drop it yourself once you are sure.',
    flags: [],
    build: (ctx) => ['stash', 'apply', ...(ctx.stashRef ? [ctx.stashRef] : [])],
  },

  'stash.pop': {
    id: 'stash.pop',
    title: 'Pop Stash',
    group: 'work',
    summary: 'Reapply the stashed changes and remove them from the stash list.',
    concept:
      'pop applies the stash and deletes it; apply keeps it. Prefer apply when the stash might conflict — ' +
      'if a pop hits a conflict the entry is kept, but the distinction is easy to get wrong under pressure.',
    flags: [],
    build: (ctx) => ['stash', 'pop', ...(ctx.stashRef ? [ctx.stashRef] : [])],
  },

  'stash.drop': {
    id: 'stash.drop',
    title: 'Drop Stash',
    group: 'work',
    summary: 'Delete this stash without applying it.',
    flags: [],
    destructive: true,
    build: (ctx) => ['stash', 'drop', ...(ctx.stashRef ? [ctx.stashRef] : [])],
  },

  'worktree.add': {
    id: 'worktree.add',
    title: 'New Worktree',
    group: 'branch',
    summary: 'Check out a branch, tag, or commit into a new folder beside this one.',
    concept: WORKTREE_CONCEPT,
    flags: [FLAG.newBranch!, FLAG.track!, FLAG.noTrack!, FLAG.detach!, FLAG.separator!],
    build: (ctx) => {
      const argv = ['worktree', 'add'];
      if (ctx.newBranch) argv.push('-b', ctx.newBranch);
      if (ctx.track) argv.push('--track');
      if (ctx.noTrack) argv.push('--no-track');
      if (ctx.detach) argv.push('--detach');
      argv.push('--', ctx.worktreePath ?? '<path>');
      if (ctx.commitish) argv.push(ctx.commitish);
      return argv;
    },
  },

  'worktree.remove': {
    id: 'worktree.remove',
    title: 'Remove Worktree',
    group: 'branch',
    summary: 'Delete this worktree’s folder and git’s record of it. The branch is kept.',
    concept:
      WORKTREE_CONCEPT +
      ' Removing one deletes its folder, including any untracked files in it; committed work is safe ' +
      'because the commits live in the shared repository. git refuses while the worktree has ' +
      'uncommitted changes unless you pass --force, and refuses a locked worktree unless you pass it twice.',
    flags: [FLAG.force!, FLAG.forceTwice!, FLAG.separator!],
    destructive: true,
    build: (ctx) => {
      const argv = ['worktree', 'remove'];
      if (ctx.force || ctx.forceLocked) argv.push('--force');
      if (ctx.forceLocked) argv.push('--force');
      argv.push('--', ctx.worktreePath ?? '<path>');
      return argv;
    },
  },

  'worktree.lock': {
    id: 'worktree.lock',
    title: 'Lock Worktree',
    group: 'branch',
    summary: 'Protect this worktree from being pruned, moved, or removed by accident.',
    concept:
      'Locking a worktree tells git to leave it alone: prune skips it even when its folder is ' +
      'unreachable (a removable drive, a network share), and remove and move need an extra --force. ' +
      'The reason you give is shown wherever the worktree is listed.',
    flags: [FLAG.reason!, FLAG.separator!],
    build: (ctx) => {
      const argv = ['worktree', 'lock'];
      if (ctx.lockReason) argv.push('--reason', ctx.lockReason);
      argv.push('--', ctx.worktreePath ?? '<path>');
      return argv;
    },
  },

  'worktree.unlock': {
    id: 'worktree.unlock',
    title: 'Unlock Worktree',
    group: 'branch',
    summary: 'Allow this worktree to be pruned, moved, or removed again.',
    flags: [FLAG.separator!],
    build: (ctx) => ['worktree', 'unlock', '--', ctx.worktreePath ?? '<path>'],
  },

  'worktree.move': {
    id: 'worktree.move',
    title: 'Move Worktree',
    group: 'branch',
    summary: 'Move this worktree to another folder, keeping git’s record of it intact.',
    concept:
      'Moving a worktree folder by hand breaks the links between it and the repository. git worktree ' +
      'move moves the folder and updates both links in one step. The main worktree cannot be moved, ' +
      'and a locked one needs --force twice.',
    flags: [FLAG.force!, FLAG.forceTwice!, FLAG.separator!],
    build: (ctx) => {
      const argv = ['worktree', 'move'];
      if (ctx.force || ctx.forceLocked) argv.push('--force');
      if (ctx.forceLocked) argv.push('--force');
      argv.push('--', ctx.worktreePath ?? '<path>', ctx.newPath ?? '<new-path>');
      return argv;
    },
  },

  'worktree.prune': {
    id: 'worktree.prune',
    title: 'Prune Worktrees',
    group: 'branch',
    summary: 'Forget worktrees whose folders were deleted. Locked worktrees are never pruned.',
    concept:
      'When a worktree folder is deleted outside git, its record stays behind in .git/worktrees and its ' +
      'branch stays "checked out" there, so no other worktree can use it. Prune clears records whose ' +
      'folders are gone. It never touches a folder that exists, and it skips locked worktrees.',
    flags: [FLAG.dryRun!, FLAG.verbose!],
    build: (ctx) => {
      const argv = ['worktree', 'prune'];
      if (ctx.dryRun) argv.push('--dry-run');
      if (ctx.verbose) argv.push('--verbose');
      return argv;
    },
  },

  'worktree.repair': {
    id: 'worktree.repair',
    title: 'Repair Worktree Links',
    group: 'branch',
    summary: 'Reconnect worktrees whose folders, or the repository itself, were moved by hand.',
    concept:
      'Each worktree and the repository point at each other by path. Moving either one by hand breaks ' +
      'those links. Repair rewrites them; pass the new folders of moved worktrees so git can find them.',
    flags: [FLAG.separator!],
    build: (ctx) => withPaths(['worktree', 'repair'], ctx.paths),
  },

  'branch.deleteGone': {
    id: 'branch.deleteGone',
    title: 'Clean Up Gone Branches',
    group: 'branch',
    summary: 'Delete local branches whose remote branch no longer exists.',
    concept:
      'When a pull request merges and its branch is deleted on the remote, your local branch stays ' +
      'behind, tracking something that is gone. Fetching with --prune marks those branches "gone". ' +
      'This deletes them. -d refuses a branch with unmerged commits; -D deletes it anyway.',
    flags: [FLAG.deleteBranch!, FLAG.forceDeleteBranch!],
    destructive: true,
    build: (ctx) => [
      'branch',
      ctx.forceDelete ? '-D' : '-d',
      ...(ctx.branches && ctx.branches.length > 0 ? ctx.branches : ['<branch>']),
    ],
  },

  'tag.create': {
    id: 'tag.create',
    title: 'Tag',
    group: 'tag',
    summary: 'Mark this commit with a permanent name.',
    concept:
      'A tag names a commit permanently, unlike a branch which moves as you work. A lightweight tag is ' +
      'just a pointer; an annotated tag (-a) is a real object carrying a message, author, and date, and ' +
      'is what releases should use. Tags are not pushed automatically — they need --tags or an explicit push.',
    flags: [FLAG.annotate!],
    build: (ctx) => {
      const argv = ['tag'];
      if (ctx.annotated) argv.push('-a', '-m', ctx.message ?? '');
      argv.push(ctx.tagName || '<name>');
      if (ctx.commitish) argv.push(ctx.commitish);
      return argv;
    },
  },

  'commit.checkout': {
    id: 'commit.checkout',
    title: 'Check Out Commit',
    group: 'branch',
    summary: 'Show this commit in your files, on no branch. Every branch stays where it is.',
    concept:
      'Checking out a commit rather than a branch is called a detached HEAD: your files show that ' +
      'commit, but no branch name follows you. It is the safe way to look around, build, or test an ' +
      'older version. Commits you make here belong to no branch and are easy to lose once you switch ' +
      'away, so create a branch first if you mean to keep work. Check out any branch to leave.',
    flags: [FLAG.detachCommit!],
    build: (ctx) => ['switch', '--detach', ctx.commitish ?? '<commit>'],
  },

  rebase: {
    id: 'rebase',
    title: 'Rebase',
    group: 'branch',
    summary: 'Replay the current branch’s own commits on top of this commit.',
    concept:
      'Rebase takes the commits your branch has that the target does not, and re-applies them one at a ' +
      'time on top of the target, so history reads as if you had started from there. The replayed ' +
      'commits are new commits with new ids — rebase only work nobody else has pulled, or everyone who ' +
      'has it must recover. If a step conflicts, resolve it and continue, or abort to return to how ' +
      'things were.',
    flags: [FLAG.autostash!],
    build: (ctx) => {
      const argv = ['rebase'];
      if (ctx.autostash) argv.push('--autostash');
      argv.push(ctx.commitish ?? '<upstream>');
      return argv;
    },
  },

  cherryPick: {
    id: 'cherryPick',
    title: 'Cherry-pick',
    group: 'branch',
    summary: 'Copy the change this commit made onto the current branch, as a new commit.',
    concept:
      'Cherry-pick re-applies the change one commit introduced, on top of where you are, as a new ' +
      'commit with a new id — the way to bring a single fix to a release branch without merging ' +
      'everything else. -x notes in the message which commit it came from. A merge commit joins two ' +
      'parents, so git needs to know which side to measure its change against: -m 1 means the branch ' +
      'it was merged into.',
    flags: [FLAG.recordOrigin!, FLAG.noCommit!, FLAG.mainline!],
    build: (ctx) => {
      const argv = ['cherry-pick'];
      if (ctx.recordOrigin) argv.push('-x');
      if (ctx.noCommit) argv.push('--no-commit');
      if (ctx.mainline) argv.push('-m', String(ctx.mainline));
      argv.push(ctx.commitish ?? '<commit>');
      return argv;
    },
  },

  revert: {
    id: 'revert',
    title: 'Reverse Commit',
    group: 'branch',
    summary: 'Add a new commit that undoes the change this commit made.',
    concept:
      'Revert deletes nothing. It records a new commit whose change is the exact opposite of the one ' +
      'you chose, which makes it the safe way to undo a commit that has already been pushed: nobody’s ' +
      'history is rewritten. For a merge commit, -m 1 undoes everything the merge brought in.',
    flags: [FLAG.noEdit!, FLAG.noCommit!, FLAG.mainline!],
    build: (ctx) => {
      const argv = ['revert', '--no-edit'];
      if (ctx.noCommit) argv.push('--no-commit');
      if (ctx.mainline) argv.push('-m', String(ctx.mainline));
      argv.push(ctx.commitish ?? '<commit>');
      return argv;
    },
  },

  reset: {
    id: 'reset',
    title: 'Reset Current Branch',
    group: 'branch',
    summary: 'Move the current branch to this commit.',
    concept:
      'Reset moves your branch to another commit. What happens to the work in between depends on the ' +
      'mode: --soft keeps all of it staged, --mixed (git’s default) keeps it in your files but unstaged, ' +
      'and --hard throws it away along with any uncommitted changes. Commits no branch points to ' +
      'afterwards can be found in the reflog for a while; uncommitted work lost to --hard cannot. ' +
      'Never reset a branch other people have pulled.',
    flags: [FLAG.soft!, FLAG.mixed!, FLAG.hard!],
    destructiveWhen: (argv) => argv.includes('--hard'),
    build: (ctx) => ['reset', `--${ctx.resetMode ?? 'mixed'}`, ctx.commitish ?? '<commit>'],
  },

  archive: {
    id: 'archive',
    title: 'Archive',
    group: 'tools',
    summary: 'Save the files of this commit as one .zip or .tar.gz file, without the history.',
    concept:
      'git archive writes the tracked files exactly as they were in one commit — no .git folder, no ' +
      'history, and nothing untracked or ignored. It is the clean way to hand someone the source of a ' +
      'release. The format follows the name of the file you choose.',
    flags: [FLAG.format!, FLAG.outputFile!],
    build: (ctx) => [
      'archive',
      `--format=${ctx.archiveFormat ?? 'zip'}`,
      '-o',
      ctx.outputPath ?? '<file>',
      ctx.commitish ?? '<commit>',
    ],
  },

  formatPatch: {
    id: 'formatPatch',
    title: 'Create Patch',
    group: 'tools',
    summary: 'Save this commit as a .patch file that git am can apply in any repository.',
    concept:
      'format-patch writes a commit as an email-style patch: its author, date, message, and change in ' +
      'one text file. Anyone can apply it with git am and keep your authorship — useful when you cannot ' +
      'push to their repository, or to attach a change to a ticket. A merge commit has no single change, ' +
      'so git skips it.',
    flags: [FLAG.oneCommit!, FLAG.output!],
    build: (ctx) => ['format-patch', '-1', `--output=${ctx.outputPath ?? '<file>'}`, ctx.commitish ?? '<commit>'],
  },
};

/** The archive format a file name asks for, by its extension. */
export function archiveFormatFor(file: string): ArchiveFormat {
  const name = file.toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar.gz';
  if (name.endsWith('.tar')) return 'tar';
  return 'zip';
}

/**
 * A patch file name the way git itself names one: `0001-` and the subject,
 * lower-cased, with every run of other characters turned into one dash.
 */
export function patchFileName(subject: string): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52)
    .replace(/-+$/, '');
  return `0001-${slug || 'patch'}.patch`;
}

/** Whether a spec's command, as about to run, can lose work. */
export function isDestructive(spec: CommandSpec, argv: readonly string[]): boolean {
  return Boolean(spec.destructive || spec.destructiveWhen?.(argv));
}

/** Every spec, in toolbar order. */
export const COMMAND_LIST: CommandSpec[] = Object.values(COMMANDS);

/**
 * Renders a command for display, exactly as it will be executed.
 *
 * Arguments containing spaces are quoted so the string can be pasted into a
 * shell and behave identically — the whole point of showing it.
 */
export function renderCommand(spec: CommandSpec, ctx: CommandContext = {}): string {
  return `git ${spec.build(ctx).map(quoteForDisplay).join(' ')}`;
}

/** Same rendering, from an argv the journal already recorded. */
export function renderArgv(argv: readonly string[]): string {
  return `git ${argv.map(quoteForDisplay).join(' ')}`;
}

function quoteForDisplay(arg: string): string {
  return /[\s"'\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg;
}

/**
 * Splits an edited command string back into an argv array.
 *
 * Users can edit the command before applying it, which means a string has to
 * become an argument list again. That conversion is done **here**, not by a
 * shell: the result is handed to `spawn` with `shell: false`, so a stray `;`,
 * `&&`, or backtick in a branch name or message is an ordinary character rather
 * than an instruction. Quoting is understood only so that arguments containing
 * spaces survive the round trip.
 *
 * A leading `git` is dropped, since it is fixed by the UI and shown separately.
 */
export function tokenize(input: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;

  const flush = () => {
    if (started) argv.push(current);
    current = '';
    started = false;
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      // Backslash escapes apply inside double quotes only, matching POSIX.
      if (char === '\\' && quote === '"' && i + 1 < input.length) {
        current += input[++i];
        continue;
      }
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is still an argument.
      started = true;
      continue;
    }

    if (char === '\\' && i + 1 < input.length) {
      current += input[++i];
      started = true;
      continue;
    }

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      flush();
      continue;
    }

    current += char;
    started = true;
  }

  flush();

  if (argv[0] === 'git') argv.shift();
  return argv;
}

/** The flags this context actually produces, for glossing only what is used. */
export function activeFlags(spec: CommandSpec, ctx: CommandContext = {}): CommandFlag[] {
  const argv = spec.build(ctx);
  const joined = argv.join(' ');
  return spec.flags.filter((entry) => joined.includes(entry.flag.split(' ')[0] ?? entry.flag));
}
