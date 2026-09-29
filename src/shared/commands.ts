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
  | 'tag.create';

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
}

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
};

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
    flags: [FLAG.rebase!, FLAG.autostash!, FLAG.prune!],
    build: (ctx) => {
      const argv = ['pull'];
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
      const name = ctx.branch ?? '<name>';
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
    flags: [],
    build: (ctx) => ['switch', ctx.branch ?? '<branch>'],
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
      argv.push(ctx.tagName ?? '<name>');
      return argv;
    },
  },
};

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
