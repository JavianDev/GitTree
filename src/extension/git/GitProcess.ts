import { spawn } from 'node:child_process';
import type { CommandRecord } from './CommandJournal';
import { StreamSplitter } from './StreamSplitter';

/**
 * Notified when any invocation finishes, successfully or not.
 *
 * One hook here covers every command GitTree runs, which is what lets the
 * command log promise completeness: there is no path to git that bypasses it.
 */
export type CommandObserver = (record: CommandRecord) => void;

/**
 * Git-level options that precede every subcommand.
 *
 * These are not preferences — each one prevents a specific class of parse
 * corruption or hang, and omitting any of them produces bugs that only show up
 * on someone else's machine.
 */
export const GLOBAL_ARGS: readonly string[] = [
  // Without this, any path containing a non-ASCII byte arrives octal-escaped
  // and wrapped in quotes, and every path comparison downstream fails.
  '-c',
  'core.quotepath=false',
  // A user's `color.ui = always` would inject ANSI escapes into porcelain
  // output and break every parser.
  '-c',
  'color.ui=false',
  // Read commands must never take `index.lock`; otherwise a background refresh
  // races the user's own git and one of the two fails.
  '--no-optional-locks',
];

/**
 * Environment applied to every invocation.
 *
 * Locale is deliberately left alone: porcelain formats are not localized, and
 * forcing `LC_ALL=C` risks mangling UTF-8 in the messages we surface verbatim.
 */
export const BASE_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: '0',
  // A credential prompt with no TTY would otherwise hang the panel forever.
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  // Suppress the interactive askpass dialog for the same reason.
  GIT_ASKPASS: 'echo',
  // Same hang risk, different prompt: `rebase --continue`, `cherry-pick
  // --continue`, and `revert --continue` can, depending on git version and
  // `core.editor`, try to open an editor for the resulting commit message.
  // `true` is a real, near-universal Unix/Windows command that does nothing
  // and exits 0 immediately, so git sees "the editor succeeded" with an
  // unedited message rather than hanging on a TTY this process never has.
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
};

export class GitError extends Error {
  override readonly name = 'GitError';

  constructor(
    message: string,
    readonly argv: readonly string[],
    readonly cwd: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }

  /** True when git exited because the directory is not a repository. */
  get isNotARepository(): boolean {
    return /not a git repository/i.test(this.stderr);
  }
}

export class CancelledError extends Error {
  override readonly name = 'CancelledError';
  constructor() {
    super('Operation cancelled');
  }
}

export interface GitRunOptions {
  cwd: string;
  args: string[];
  /** Written to the child's stdin, which is then closed. */
  stdin?: string | Buffer;
  signal?: AbortSignal;
  env?: Record<string, string>;
  /**
   * Exit codes to treat as success in addition to 0. `git diff --quiet` and
   * `git apply --check` use exit status as their answer, not as an error.
   */
  okExitCodes?: number[];
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitStreamOptions extends GitRunOptions {
  /** Record separator: `\0` for `-z` output, `\x1e` for the log format. */
  separator: string;
  /** Invoked per completed record, in stream order. */
  onRecord: (record: string) => void;
  /** Records per callback batch; batching keeps the event loop responsive. */
  batchSize?: number;
}

/**
 * Spawns git and collects or streams its output.
 *
 * Every invocation uses an argv array with `shell: false`. No caller-supplied
 * string is ever concatenated into a command line, so branch names, paths, and
 * commit messages containing shell metacharacters are inert.
 */
export class GitProcess {
  constructor(
    private readonly gitPath: string,
    private readonly observe?: CommandObserver,
  ) {}

  /** Runs git to completion and returns its decoded output. */
  async run(options: GitRunOptions): Promise<GitRunResult> {
    const stdoutChunks: Buffer[] = [];
    const result = await this.spawn(options, (chunk) => {
      stdoutChunks.push(chunk);
    });
    return { ...result, stdout: Buffer.concat(stdoutChunks).toString('utf8') };
  }

  /**
   * Runs git and delivers separator-delimited records as they arrive.
   *
   * History and status output are read this way so the first screen can paint
   * while a large repository is still being walked.
   */
  async stream(options: GitStreamOptions): Promise<Omit<GitRunResult, 'stdout'>> {
    const splitter = new StreamSplitter(options.separator);
    const { onRecord } = options;

    const result = await this.spawn(options, (chunk) => {
      for (const record of splitter.push(chunk)) onRecord(record);
    });

    for (const record of splitter.flush()) onRecord(record);
    return result;
  }

  private spawn(
    options: GitRunOptions,
    onStdout: (chunk: Buffer) => void,
  ): Promise<{ stderr: string; exitCode: number }> {
    const argv = [...GLOBAL_ARGS, ...options.args];
    const okCodes = new Set([0, ...(options.okExitCodes ?? [])]);
    const startedAt = Date.now();

    /** Reports the invocation exactly once, whatever its outcome. */
    const report = (exitCode: number, stderr: string, wasCancelled: boolean) => {
      this.observe?.({
        args: options.args,
        fullArgv: argv,
        cwd: options.cwd,
        startedAt,
        durationMs: Date.now() - startedAt,
        exitCode,
        stderr,
        cancelled: wasCancelled,
      });
    };

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new CancelledError());
        return;
      }

      const child = spawn(this.gitPath, argv, {
        cwd: options.cwd,
        env: { ...process.env, ...BASE_ENV, ...options.env },
        // Never a shell: argv stays an array so metacharacters cannot escape.
        shell: false,
        windowsHide: true,
      });

      const stderrChunks: Buffer[] = [];
      let settled = false;
      let cancelled = false;

      const onAbort = () => {
        cancelled = true;
        child.kill();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        options.signal?.removeEventListener('abort', onAbort);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        // A spawn failure never reaches 'close', so it is reported here or not
        // at all; -1 marks "the binary never ran".
        report(-1, error.message, false);
        reject(error);
      };

      child.stdout.on('data', onStdout);
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // EPIPE here means the child exited before consuming stdin, which the
      // 'close' handler already reports with the real exit code.
      child.stdin.on('error', () => undefined);
      child.on('error', fail);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();

        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const exitCode = code ?? -1;

        // Reported before branching, so a cancelled or failed command appears
        // in the log exactly like a successful one.
        report(exitCode, stderr, cancelled);

        if (cancelled) {
          reject(new CancelledError());
          return;
        }

        if (!okCodes.has(exitCode)) {
          const summary = stderr.trim().split('\n')[0] ?? `git exited with ${exitCode}`;
          reject(new GitError(summary, argv, options.cwd, code, stderr));
          return;
        }

        resolve({ stderr, exitCode });
      });

      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      } else {
        child.stdin.end();
      }
    });
  }
}
