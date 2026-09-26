import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { type CommandObserver, GitProcess } from './GitProcess';

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
  /** Full version string as git reported it, e.g. `2.55.0.windows.3`. */
  raw: string;
}

/**
 * Git capabilities that arrived in a known release.
 *
 * Gating on version rather than probing keeps startup cheap, and lets the UI
 * disable a control with an accurate reason instead of failing at click time.
 */
export const FEATURE_MIN_VERSION = {
  /** `status --porcelain=v2` — the format every status parse depends on. */
  statusPorcelainV2: [2, 11, 0],
  /** `worktree list --porcelain` */
  worktreePorcelain: [2, 7, 0],
  /** `sparse-checkout` with cone mode */
  sparseCheckout: [2, 25, 0],
  /** `commit-graph` maintenance task */
  maintenance: [2, 30, 0],
  /** SSH commit signing via `gpg.format=ssh` */
  sshSigning: [2, 34, 0],
  /** `log --remerge-diff` */
  remergeDiff: [2, 35, 0],
  /** `rebase --update-refs` */
  updateRefs: [2, 38, 0],
  /** `stash push --staged` */
  stashStaged: [2, 35, 0],
} as const satisfies Record<string, readonly [number, number, number]>;

export type GitFeature = keyof typeof FEATURE_MIN_VERSION;

/** Where git commonly lives on Windows when it is not on PATH. */
const WINDOWS_FALLBACKS = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
];

export class GitExecutableError extends Error {
  override readonly name = 'GitExecutableError';
}

/**
 * A located git binary and what it can do.
 *
 * Resolution order: the `gitTree.git.path` setting, then `git` on PATH, then
 * the standard Windows install locations. The first candidate that reports a
 * version wins.
 */
export class GitExecutable {
  private constructor(
    readonly path: string,
    readonly version: GitVersion,
  ) {}

  static async locate(configuredPath?: string): Promise<GitExecutable> {
    const candidates = [
      ...(configuredPath ? [configuredPath] : []),
      'git',
      ...(process.platform === 'win32' ? WINDOWS_FALLBACKS : []),
    ];

    const failures: string[] = [];

    for (const candidate of candidates) {
      // An absolute path that does not exist is worth skipping before we pay
      // for a spawn; a bare `git` must go through spawn to consult PATH.
      if (candidate.includes('/') || candidate.includes('\\')) {
        try {
          await access(candidate, constants.X_OK);
        } catch {
          failures.push(`${candidate}: not executable`);
          continue;
        }
      }

      try {
        const version = await GitExecutable.probeVersion(candidate);
        const executable = new GitExecutable(candidate, version);

        if (!executable.supports('statusPorcelainV2')) {
          throw new GitExecutableError(
            `git ${version.raw} at ${candidate} is too old; GitTree needs 2.11 or newer.`,
          );
        }
        return executable;
      } catch (error) {
        if (error instanceof GitExecutableError) throw error;
        failures.push(`${candidate}: ${(error as Error).message}`);
      }
    }

    throw new GitExecutableError(
      `Could not find a usable git executable. Tried:\n  ${failures.join('\n  ')}\n` +
        'Set "gitTree.git.path" to the absolute path of your git binary.',
    );
  }

  /** True when this git is new enough for the given capability. */
  supports(feature: GitFeature): boolean {
    const [major, minor, patch] = FEATURE_MIN_VERSION[feature];
    const v = this.version;
    if (v.major !== major) return v.major > major;
    if (v.minor !== minor) return v.minor > minor;
    return v.patch >= patch;
  }

  /** Every capability this binary lacks, for a one-shot diagnostics report. */
  missingFeatures(): GitFeature[] {
    return (Object.keys(FEATURE_MIN_VERSION) as GitFeature[]).filter((f) => !this.supports(f));
  }

  createProcess(observe?: CommandObserver): GitProcess {
    return new GitProcess(this.path, observe);
  }

  private static probeVersion(candidate: string): Promise<GitVersion> {
    return new Promise((resolve, reject) => {
      const child = spawn(candidate, ['--version'], { shell: false, windowsHide: true });
      let out = '';

      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', () => {
        const parsed = parseVersion(out);
        if (!parsed) {
          reject(new Error(`unexpected --version output: ${out.trim() || '(empty)'}`));
          return;
        }
        resolve(parsed);
      });
    });
  }
}

/** Parses `git version 2.55.0.windows.3` into its numeric components. */
export function parseVersion(output: string): GitVersion | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?(\S*)/.exec(output);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    raw: `${match[1]}.${match[2]}.${match[3] ?? 0}${match[4] ?? ''}`,
  };
}
