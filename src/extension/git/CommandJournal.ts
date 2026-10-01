import type { JournalEntry, RepoId } from '@shared/model';

export type { JournalEntry };

/**
 * Git subcommands that only read. Everything else is treated as mutating, so a
 * command GitTree does not recognise is shown as consequential rather than
 * quietly dimmed — the safe direction to be wrong in.
 */
const READ_ONLY = new Set([
  'blame',
  'cat-file',
  'diff',
  'for-each-ref',
  'log',
  'ls-files',
  'ls-remote',
  'merge-base',
  'rev-list',
  'rev-parse',
  'show',
  'show-ref',
  'status',
  'symbolic-ref',
  'version',
]);

/**
 * Subcommands that read or write depending on their arguments.
 *
 * The subcommand alone is not enough for these. Classifying `config` as read-only
 * dimmed the settings sheet's writes as though nothing had happened, while
 * classifying `remote` as mutating lit up every `remote -v` listing. Both are the
 * same mistake in opposite directions: the verb is in the flags, not the name.
 */
const CONDITIONAL: Record<string, (args: readonly string[]) => boolean> = {
  // A read names one key and stops. Anything that sets, unsets, edits, or adds
  // is a write — and `--get`/`--list` are the only forms that certainly are not.
  config: (args) =>
    args.some((arg) => /^--(unset|add|replace-all|edit|rename-section|remove-section)/.test(arg)) ||
    // `config user.name "value"` writes; `config --get user.name` does not.
    (!args.some((arg) => arg.startsWith('--get') || arg === '--list' || arg === '-l') &&
      args.filter((arg) => !arg.startsWith('-')).length > 2),

  // `remote` and `remote -v` list; every other form changes configuration.
  remote: (args) => args.some((arg, index) => index > 0 && !arg.startsWith('-')),

  // `stash` with no verb pushes; `stash list`/`show` only read.
  stash: (args) => !['list', 'show'].includes(args[1] ?? ''),

  // `worktree list` reads; add, remove, move, lock, unlock, prune and repair write.
  worktree: (args) => args[1] !== 'list',
};

/**
 * Whether an invocation changed anything.
 *
 * Drives only the log's tinting, so the safe direction to be wrong in is
 * "mutating": an unrecognised subcommand is shown as consequential rather than
 * quietly dimmed.
 */
export function isMutating(subcommand: string | undefined, args: readonly string[]): boolean {
  if (subcommand === undefined) return true;

  const conditional = CONDITIONAL[subcommand];
  if (conditional) return conditional(args);

  return !READ_ONLY.has(subcommand);
}

/** What `GitProcess` reports when an invocation finishes. */
export interface CommandRecord {
  args: string[];
  fullArgv: string[];
  cwd: string;
  startedAt: number;
  durationMs: number;
  exitCode: number;
  stderr: string;
  cancelled: boolean;
}

export type JournalListener = (entry: JournalEntry) => void;

/**
 * The record of every git command GitTree has run.
 *
 * This is the substance behind the command log: users learn git by seeing the
 * real invocation, its exit status, and how long it took. Because every spawn
 * already funnels through `GitProcess`, recording is one hook rather than a
 * change at each of several dozen call sites — which also means a command
 * cannot be run *without* appearing here.
 */
export class CommandJournal {
  private readonly entries: JournalEntry[] = [];
  private readonly listeners = new Set<JournalListener>();
  private nextId = 1;

  constructor(private readonly limit = 500) {}

  record(record: CommandRecord, repoId?: RepoId): JournalEntry {
    const subcommand = record.args.find((arg) => !arg.startsWith('-'));

    const entry: JournalEntry = {
      id: this.nextId++,
      ...(repoId ? { repoId } : {}),
      args: record.args,
      fullArgv: record.fullArgv,
      cwd: record.cwd,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      exitCode: record.exitCode,
      ...(record.stderr.trim() ? { stderr: record.stderr } : {}),
      mutating: isMutating(subcommand, record.args),
      cancelled: record.cancelled,
    };

    this.entries.push(entry);
    // A ring rather than unbounded growth: a long session with a busy watcher
    // would otherwise retain every status refresh for the life of the window.
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);

    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  /** Most recent first. */
  recent(count = 100): JournalEntry[] {
    return this.entries.slice(-count).reverse();
  }

  onDidRecord(listener: JournalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}
