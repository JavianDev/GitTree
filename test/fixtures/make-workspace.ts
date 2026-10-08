import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Builds a real multi-level workspace with a real git binary.
 *
 * The shapes here are the ones that break naive implementations, so the
 * fixture deliberately contains all of them at once:
 *
 *   workspace/
 *     upstream-lib/            (outside the scanned folder; submodule source)
 *     parent/                  <- the scanned workspace folder
 *       alpha/                 root repo
 *         tools/nested/        plain nested repo (NOT a submodule)
 *       beta/                  root repo
 *         libs/lib/            submodule
 *       gamma/                 root repo
 *       gamma-wt/              linked worktree of gamma
 */
export interface Workspace {
  /** Temp directory holding everything. */
  base: string;
  /** The folder to hand to discovery. */
  parent: string;
  alpha: string;
  beta: string;
  gamma: string;
  nested: string;
  submodule: string;
  worktree: string;
  dispose(): void;
}

const IDENTITY = [
  '-c',
  'user.name=GitTree Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false',
];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/** Creates a repo with one commit so it has a real HEAD. */
function initRepo(dir: string, fileName = 'README.md'): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  writeFileSync(path.join(dir, fileName), `# ${path.basename(dir)}\n`, 'utf8');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', `Initial commit in ${path.basename(dir)}`]);
}

export function makeWorkspace(): Workspace {
  // Long form, as git reports it — see worktrees.git.test.ts.
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gittree-')));
  const parent = path.join(base, 'parent');
  mkdirSync(parent, { recursive: true });

  const upstream = path.join(base, 'upstream-lib');
  initRepo(upstream, 'lib.ts');

  const alpha = path.join(parent, 'alpha');
  const beta = path.join(parent, 'beta');
  const gamma = path.join(parent, 'gamma');
  initRepo(alpha);
  initRepo(beta);
  initRepo(gamma);

  // A plain repository inside another repository's worktree. The parent sees
  // it only as an untracked directory.
  const nested = path.join(alpha, 'tools', 'nested');
  initRepo(nested, 'nested.ts');

  // A real submodule. `protocol.file.allow` is required because git blocks
  // file-transport submodules by default since 2.38.
  const submodule = path.join(beta, 'libs', 'lib');
  git(beta, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    upstream.replace(/\\/g, '/'),
    'libs/lib',
  ]);
  git(beta, ['commit', '-m', 'Add submodule']);

  // A linked worktree, sharing gamma's object store.
  const worktree = path.join(parent, 'gamma-wt');
  git(gamma, ['worktree', 'add', worktree, '-b', 'feature']);

  return {
    base,
    parent,
    alpha,
    beta,
    gamma,
    nested,
    submodule,
    worktree,
    dispose() {
      // Git marks object files read-only; force is required on Windows.
      rmSync(base, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/** True when a usable git binary is on PATH. */
export function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a directory junction (Windows) or symlink (POSIX), returning false
 * when the platform or permissions do not allow it.
 */
export function tryLink(linkPath: string, targetPath: string): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, targetPath], { stdio: 'ignore' });
    } else {
      execFileSync('ln', ['-s', targetPath, linkPath], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}
