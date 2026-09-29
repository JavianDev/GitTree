import { promises as fs } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';
import type {
  Commit,
  DiffFile,
  FileStats,
  GitRemote,
  GraphRow,
  RefEntry,
  RepoNode,
  RepoSettings,
  StashEntry,
  StatusResult,
} from '@shared/model';
import { GraphLayout } from '../graph/layout';
import type { CommitRequest, DiffTarget, LineSelection, LogRequest } from '@shared/protocol';
import { GitError, type GitProcess } from './GitProcess';
import type { GitScheduler, Priority } from './GitScheduler';
import { detectMergeOperation } from './mergeOperation';
import { buildHunkPatch, buildLinePatch } from './patch';
import { synthesizeAddedFile } from './untrackedDiff';
import { LOG_FORMAT, listArgs, parseCommitRecord, parseListRecord } from './parsers/log';
import { STATUS_ARGS, parseStatus } from './parsers/status';
import { parseDiff } from './parsers/diff';
import { numstatArgs, parseNumstat } from './parsers/numstat';
import { REF_ARGS, parseRefs } from './parsers/refs';
import { REMOTE_ARGS, parseRemotes } from './parsers/remote';
import { STASH_ARGS, parseStashes } from './parsers/stash';
import { NUL, RS } from './separators';

export interface GitServiceOptions {
  priority?: Priority;
  signal?: AbortSignal;
}

/**
 * The part of `RepoSettings` that git itself answers. The remainder — version,
 * root, kind, ignore path — is known to the repository manager without running
 * anything, and is filled in there.
 */
export type GitSettings = Omit<RepoSettings, 'gitVersion' | 'root' | 'kind' | 'ignoreFile'>;

/**
 * Rows in the first batch. Small enough to fill the visible window and paint
 * within a frame or two, rather than making the user wait on a full page.
 */
const FIRST_BATCH = 120;

/** Ceiling once the view is populated and throughput matters more than latency. */
const MAX_BATCH = 2000;

/**
 * Everything GitTree does to one repository.
 *
 * Each call goes through the shared scheduler rather than spawning directly, so
 * a repository cannot exceed its fair share of the process pool no matter how
 * many views are open on it.
 */
export class GitService {
  constructor(
    readonly repo: RepoNode,
    private readonly git: GitProcess,
    private readonly scheduler: GitScheduler,
  ) {}

  private get cwd(): string {
    return this.repo.root;
  }

  private runScheduled<T>(options: GitServiceOptions | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.scheduler.schedule(
      { repoId: this.repo.id, priority: options?.priority, signal: options?.signal },
      task,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                  */
  /* ---------------------------------------------------------------------- */

  async status(options?: GitServiceOptions): Promise<StatusResult> {
    return this.runScheduled(options, async (signal) => {
      const records: string[] = [];
      await this.git.stream({
        cwd: this.cwd,
        args: [...STATUS_ARGS],
        separator: NUL,
        onRecord: (record) => records.push(record),
        signal,
      });

      const parsed = parseStatus(records);
      const mergeOperation = await detectMergeOperation(this.repo.gitDir);
      return {
        repoId: this.repo.id,
        branch: parsed.branch,
        files: parsed.files,
        ...(mergeOperation ? { mergeOperation } : {}),
      };
    });
  }

  /**
   * Streams history in batches, with graph rows already computed.
   *
   * Two decisions here are what make a large repository usable:
   *
   *  - The **lean list format** is used, not the full one. The list shows a
   *    subject, author, date, and refs; streaming every commit body as well
   *    roughly doubles the bytes git produces and this process parses, all for
   *    data the list discards.
   *  - **Lane assignment runs here, incrementally, as commits arrive.** Laying
   *    out afterwards would mean shipping the whole commit array to wherever the
   *    layout lives and the whole row array back, and the graph could not appear
   *    until the final commit had been walked. Feeding a stateful layout costs
   *    nothing extra and lets rails render with the first batch.
   *
   * The first batch is deliberately small so the initial screen paints almost
   * immediately; later batches grow, because by then the cost that matters is
   * throughput rather than latency.
   */
  async log(
    request: Omit<LogRequest, 'repoIds'>,
    onBatch: (commits: Commit[], rows: GraphRow[], done: boolean) => void,
    options?: GitServiceOptions,
  ): Promise<void> {
    return this.runScheduled(options, async (signal) => {
      const layout = new GraphLayout();
      let batch: Commit[] = [];
      let rows: GraphRow[] = [];
      let threshold = FIRST_BATCH;

      const flush = (done: boolean) => {
        onBatch(batch, rows, done);
        batch = [];
        rows = [];
      };

      await this.git.stream({
        cwd: this.cwd,
        args: listArgs(request),
        separator: RS,
        signal,
        onRecord: (record) => {
          const commit = parseListRecord(record, this.repo.id);
          if (!commit) return;

          batch.push(commit);
          rows.push(layout.push(commit));

          if (batch.length >= threshold) {
            flush(false);
            threshold = Math.min(threshold * 4, MAX_BATCH);
          }
        },
      });

      flush(true);
    });
  }

  /** Branches, remote branches, tags, and the stash ref, for the object sidebar. */
  async refs(options?: GitServiceOptions): Promise<RefEntry[]> {
    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({ cwd: this.cwd, args: [...REF_ARGS], signal });
      return parseRefs(result.stdout);
    });
  }

  /** Every stash, newest first — `refs()` only ever surfaces the tip via `refs/stash`. */
  async stashes(options?: GitServiceOptions): Promise<StashEntry[]> {
    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({ cwd: this.cwd, args: [...STASH_ARGS], signal });
      return parseStashes(result.stdout);
    });
  }

  /** Configured remotes, with their fetch and push URLs already collapsed. */
  async remotes(options?: GitServiceOptions): Promise<GitRemote[]> {
    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({ cwd: this.cwd, args: [...REMOTE_ARGS], signal });
      return parseRemotes(result.stdout);
    });
  }

  /**
   * Remotes and committer identity, for the settings sheet.
   *
   * The five invocations are issued inside a *single* scheduled task rather
   * than by calling `remotes()` and a per-key helper: `runScheduled` holds its
   * pool slot for the whole task, so a nested schedule would consume two slots
   * for one logical read and — with the pool saturated by other repositories —
   * wait for a slot only it can release.
   */
  async settings(options?: GitServiceOptions): Promise<GitSettings> {
    return this.runScheduled(options, async (signal) => {
      const [remoteOutput, userName, userEmail, globalUserName, globalUserEmail] = await Promise.all([
        this.git.run({ cwd: this.cwd, args: [...REMOTE_ARGS], signal }),
        this.readConfig('--local', 'user.name', signal),
        this.readConfig('--local', 'user.email', signal),
        this.readConfig('--global', 'user.name', signal),
        this.readConfig('--global', 'user.email', signal),
      ]);

      return {
        remotes: parseRemotes(remoteOutput.stdout),
        ...(userName ? { userName } : {}),
        ...(userEmail ? { userEmail } : {}),
        ...(globalUserName ? { globalUserName } : {}),
        ...(globalUserEmail ? { globalUserEmail } : {}),
        // Driven by the absence of a local value, not by the two identities
        // matching: a repository that deliberately sets the same name as the
        // global config has still overridden it, and the toggle must say so.
        usesGlobalUser: userName === undefined && userEmail === undefined,
      };
    });
  }

  /**
   * Reads one config key, distinguishing "unset" from "failed".
   *
   * git answers an absent key by exiting 1 with no output. Under the default
   * handling that is a thrown `GitError`, which would make the ordinary case —
   * a repository with no local identity of its own — surface as a broken
   * repository rather than as an empty field.
   */
  private async readConfig(
    scope: '--local' | '--global',
    key: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.git.run({
      cwd: this.cwd,
      args: ['config', scope, '--get', key],
      okExitCodes: [1],
      signal,
    });

    return result.stdout.trim() || undefined;
  }

  /**
   * Per-file line counts for the review header and rows.
   *
   * Read with `run`, not `stream`, deliberately. A rename spans three
   * NUL-separated fields — the counts, then the old path, then the new — so a
   * per-record callback has no way to pair them and would emit a phantom entry
   * for each half. The whole output goes to the parser instead.
   */
  async stats(staged: boolean, options?: GitServiceOptions): Promise<FileStats[]> {
    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({ cwd: this.cwd, args: numstatArgs({ staged }), signal });
      return parseNumstat(result.stdout);
    });
  }

  async diff(target: DiffTarget, options?: GitServiceOptions): Promise<DiffFile[]> {
    if (target.kind === 'untracked') return this.untrackedDiff(target.path, options);

    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({ cwd: this.cwd, args: diffArgs(target), signal });
      return parseDiff(result.stdout);
    });
  }

  private async untrackedDiff(relativePath: string, options?: GitServiceOptions): Promise<DiffFile[]> {
    const root = resolvePath(this.cwd);
    const full = resolvePath(root, relativePath);
    // The path comes from the webview; never read outside the worktree.
    if (!full.startsWith(root + pathSep)) return [];

    return this.runScheduled(options, async () => {
      const stats = await fs.stat(full).catch(() => undefined);
      if (!stats?.isFile()) return [];
      return [synthesizeAddedFile(relativePath, await fs.readFile(full))];
    });
  }

  async commitDetails(hash: string, options?: GitServiceOptions): Promise<Commit | undefined> {
    return this.runScheduled(options, async (signal) => {
      const result = await this.git.run({
        cwd: this.cwd,
        args: ['show', '--no-patch', '--decorate=full', `--format=${LOG_FORMAT}`, hash],
        signal,
      });
      const record = result.stdout.split(RS)[0];
      return record ? parseCommitRecord(record, this.repo.id) : undefined;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Staging                                                                */
  /* ---------------------------------------------------------------------- */

  async stageFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      // `--` keeps a path that begins with a dash from being read as a flag.
      await this.git.run({ cwd: this.cwd, args: ['add', '--', ...paths], signal });
    });
  }

  async unstageFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      await this.git.run({
        cwd: this.cwd,
        args: ['restore', '--staged', '--', ...paths],
        signal,
      });
    });
  }

  async discardFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      await this.git.run({ cwd: this.cwd, args: ['restore', '--worktree', '--', ...paths], signal });
    });
  }

  async removeFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      for (const path of paths) {
        if (signal?.aborted) break;
        try {
          // Try git rm first (works for tracked files)
          await this.git.run({ cwd: this.cwd, args: ['rm', '-f', '--', path], signal });
        } catch {
          // If git rm fails (e.g., untracked file), delete from disk directly
          if (signal?.aborted) break;
          const fullPath = `${this.cwd}/${path}`;
          try {
            await fs.unlink(fullPath);
          } catch {
            // File doesn't exist, that's OK
          }
        }
      }
    });
  }

  /**
   * Resolves conflicted paths by taking one side wholesale: checks each out,
   * then stages it as resolved. Tries `checkout` first and falls back to `rm`
   * on failure — rather than pre-branching on the two-letter conflict code —
   * because a checkout naturally fails when that side has no blob at all (the
   * add/delete case), and `rm` is the unambiguously correct resolution there
   * regardless of which side was asked for. This also correctly handles a
   * both-deleted conflict, where neither side has a blob to check out.
   */
  async resolveConflicts(
    paths: string[],
    resolution: 'ours' | 'theirs',
    options?: GitServiceOptions,
  ): Promise<void> {
    if (paths.length === 0) return;
    const flag = resolution === 'ours' ? '--ours' : '--theirs';

    await this.runScheduled(options, async (signal) => {
      for (const path of paths) {
        if (signal?.aborted) break;

        try {
          await this.git.run({ cwd: this.cwd, args: ['checkout', flag, '--', path], signal });
        } catch {
          if (signal?.aborted) break;
          // `rm` already stages the removal, so resolution ends here for this path.
          await this.git.run({ cwd: this.cwd, args: ['rm', '-f', '--', path], signal });
          continue;
        }

        if (signal?.aborted) break;
        await this.git.run({ cwd: this.cwd, args: ['add', '--', path], signal });
      }
    });
  }

  async stopTrackingFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      await this.git.run({
        cwd: this.cwd,
        args: ['rm', '--cached', '--force', '--', ...paths],
        signal,
      });
    });
  }

  async ignoreFiles(paths: string[], options?: GitServiceOptions): Promise<void> {
    if (paths.length === 0) return;
    await this.runScheduled(options, async (signal) => {
      if (signal?.aborted) return;
      const gitignorePath = `${this.cwd}/.gitignore`;
      let content = '';

      try {
        content = await fs.readFile(gitignorePath, 'utf8');
      } catch {
        // .gitignore doesn't exist yet, start with empty content
      }

      const lines = content.split('\n').map((line) => line.trimEnd());
      const existingSet = new Set(lines.filter((line) => line.length > 0));

      for (const path of paths) {
        if (signal?.aborted) break;
        existingSet.add(path);
      }

      const newContent = Array.from(existingSet).join('\n') + (existingSet.size > 0 ? '\n' : '');
      await fs.writeFile(gitignorePath, newContent, 'utf8');
    });
  }

  /**
   * Stages or unstages whole hunks.
   *
   * The patch is validated with `--check` first so a failure surfaces as a
   * clean error rather than a half-applied index.
   */
  async applyHunks(
    path: string,
    hunkIndices: number[],
    reverse: boolean,
    options?: GitServiceOptions,
  ): Promise<void> {
    const target: DiffTarget = reverse
      ? { kind: 'index', repoId: this.repo.id, path }
      : { kind: 'worktree', repoId: this.repo.id, path };

    const files = await this.diff(target, options);
    const file = files[0];
    if (!file) return;

    const patch = buildHunkPatch(file, hunkIndices);
    if (!patch) return;

    await this.applyPatch(patch, reverse, options);
  }

  /** Stages or unstages individual lines. */
  async applyLines(
    path: string,
    selections: LineSelection[],
    reverse: boolean,
    options?: GitServiceOptions,
  ): Promise<void> {
    const target: DiffTarget = reverse
      ? { kind: 'index', repoId: this.repo.id, path }
      : { kind: 'worktree', repoId: this.repo.id, path };

    const files = await this.diff(target, options);
    const file = files[0];
    if (!file) return;

    const patch = buildLinePatch(file, selections, reverse);
    if (!patch) return;

    await this.applyPatch(patch, reverse, options);
  }

  private async applyPatch(patch: string, reverse: boolean, options?: GitServiceOptions): Promise<void> {
    const base = ['apply', '--cached', '--unidiff-zero', ...(reverse ? ['--reverse'] : []), '-'];

    await this.runScheduled(options, async (signal) => {
      await this.git.run({ cwd: this.cwd, args: [...base.slice(0, -1), '--check', '-'], stdin: patch, signal });
      await this.git.run({ cwd: this.cwd, args: base, stdin: patch, signal });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Runs an arbitrary git argv in this repository.
   *
   * Backs the toolbar actions and the editable command sheet. The argument list
   * arrives already split — never as a command line — and reaches `spawn` with
   * `shell: false`, so nothing in it can be interpreted as shell syntax.
   *
   * A non-zero exit is returned rather than thrown: `git push` rejecting a
   * non-fast-forward, or a merge stopping on a conflict, are outcomes the user
   * needs to read, not failures to swallow. The caller decides what to show.
   */
  async run(
    argv: string[],
    stdin?: string,
    options?: GitServiceOptions,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (argv.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    return this.runScheduled({ ...options, priority: options?.priority ?? 'foreground' }, async (signal) => {
      try {
        return await this.git.run({
          cwd: this.cwd,
          args: argv,
          ...(stdin !== undefined ? { stdin } : {}),
          signal,
        });
      } catch (error) {
        if (error instanceof GitError) {
          return { stdout: '', stderr: error.stderr, exitCode: error.exitCode ?? 1 };
        }
        throw error;
      }
    });
  }

  /**
   * Creates a commit.
   *
   * The message goes in via stdin (`-F -`) rather than `-m`, so a message
   * containing newlines, quotes, or leading dashes cannot be misread.
   */
  async commit(request: CommitRequest, options?: GitServiceOptions): Promise<{ hash: string }> {
    const args = ['commit', '-F', '-'];
    if (request.amend) args.push('--amend');
    if (request.signoff) args.push('--signoff');
    if (request.sign) args.push('-S');
    if (request.allowEmpty) args.push('--allow-empty');

    const message = withCoAuthors(request.message, request.coAuthors);

    return this.runScheduled({ ...options, priority: options?.priority ?? 'foreground' }, async (signal) => {
      // A pre-commit or commit-msg hook failure is the user's own script
      // talking, and GitError already carries its stderr verbatim. Nothing is
      // caught here so that output reaches the UI unaltered.
      await this.git.run({ cwd: this.cwd, args, stdin: message, signal });

      const head = await this.git.run({ cwd: this.cwd, args: ['rev-parse', 'HEAD'], signal });
      return { hash: head.stdout.trim() };
    });
  }
}

/** Builds the argv for a diff request. */
function diffArgs(target: Exclude<DiffTarget, { kind: 'untracked' }>): string[] {
  const base = ['diff', '--no-color', '--no-ext-diff', '--find-renames', '-U3'];

  switch (target.kind) {
    case 'worktree':
      return [...base, '--', target.path];
    case 'index':
      return [...base, '--cached', '--', target.path];
    case 'commit':
      // `<hash>^!` is shorthand for "this commit against its first parent",
      // and works on a root commit where `<hash>~1` does not exist.
      return [...base, `${target.hash}^!`, ...(target.path ? ['--', target.path] : [])];
    case 'range':
      return [...base, `${target.from}..${target.to}`, ...(target.path ? ['--', target.path] : [])];
  }
}

/** Appends `Co-authored-by:` trailers, skipping any already present. */
function withCoAuthors(message: string, coAuthors: string[] | undefined): string {
  if (!coAuthors || coAuthors.length === 0) return message;

  const missing = coAuthors.filter((entry) => !message.includes(entry));
  if (missing.length === 0) return message;

  const trailers = missing.map((entry) => `Co-authored-by: ${entry}`).join('\n');
  const separator = message.endsWith('\n\n') ? '' : message.endsWith('\n') ? '\n' : '\n\n';
  return `${message}${separator}${trailers}\n`;
}
