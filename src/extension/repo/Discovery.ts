import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepoKind } from '@shared/model';
import { displayPath, pathKey } from './identity';

/**
 * Directories that never contain a repository worth showing, and that are
 * expensive to walk. Skipping `node_modules` alone is usually the difference
 * between a scan taking 200ms and taking a minute.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  '.gradle',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
];

export interface DiscoveryOptions {
  /** Directory levels below each workspace folder to scan. */
  maxDepth?: number;
  /** Directory names to skip, in addition to `DEFAULT_EXCLUDES`. */
  excludeDirs?: readonly string[];
  /** Concurrent directory reads. */
  concurrency?: number;
}

export interface DiscoveredRepo {
  /** Worktree root, display form (forward slashes, original casing). */
  root: string;
  /** Resolved git directory. For a worktree or submodule this points away. */
  gitDir: string;
  /**
   * Classification from filesystem evidence alone. `nested` versus `root` is
   * resolved later, once the full set is known and containment can be tested.
   */
  kind: RepoKind;
  /** Workspace folder this repository was found under. */
  workspaceFolder: string;
  /** Levels below the workspace folder. */
  depth: number;
}

/**
 * Scans workspace folders for repositories.
 *
 * The scan continues *into* a repository rather than stopping at it: a parent
 * folder holding a dozen sibling checkouts is the normal case this extension is
 * built for, and repositories nested inside another repository's worktree are
 * exactly what needs surfacing.
 */
export async function discoverRepositories(
  workspaceFolders: readonly string[],
  options: DiscoveryOptions = {},
): Promise<DiscoveredRepo[]> {
  const maxDepth = options.maxDepth ?? 4;
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(options.excludeDirs ?? [])]);
  const concurrency = Math.max(1, options.concurrency ?? 8);

  const found = new Map<string, DiscoveredRepo>();
  // Real paths already walked. Junctions and symlinks otherwise produce both
  // duplicate repositories and, in a cycle, an unbounded walk.
  const visited = new Set<string>();

  for (const folder of workspaceFolders) {
    const base = displayPath(folder);
    const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const results = await Promise.all(
        batch.map((item) => visitDirectory(item.dir, item.depth, base, maxDepth, excludes, visited)),
      );

      for (const result of results) {
        if (!result) continue;
        if (result.repo) {
          const key = pathKey(result.repo.root);
          if (!found.has(key)) found.set(key, result.repo);
        }
        for (const child of result.children) {
          queue.push(child);
        }
      }
    }
  }

  return [...found.values()];
}

interface VisitResult {
  repo?: DiscoveredRepo;
  children: Array<{ dir: string; depth: number }>;
}

async function visitDirectory(
  dir: string,
  depth: number,
  workspaceFolder: string,
  maxDepth: number,
  excludes: ReadonlySet<string>,
  visited: Set<string>,
): Promise<VisitResult | undefined> {
  let real: string;
  try {
    real = pathKey(await realpath(dir));
  } catch {
    return undefined;
  }

  if (visited.has(real)) return undefined;
  visited.add(real);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directories (permissions, a vanished path) are skipped rather
    // than aborting the whole scan.
    return undefined;
  }

  const result: VisitResult = { children: [] };

  const gitEntry = entries.find((entry) => entry.name === '.git');
  if (gitEntry) {
    const repo = await classify(dir, depth, workspaceFolder);
    if (repo) result.repo = repo;
  }

  if (depth < maxDepth) {
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === '.git' || excludes.has(entry.name)) continue;
      result.children.push({ dir: displayPath(path.join(dir, entry.name)), depth: depth + 1 });
    }
  }

  return result;
}

/**
 * Determines what kind of repository sits at `dir`.
 *
 * A `.git` *directory* is an ordinary checkout. A `.git` *file* redirects
 * elsewhere, and the redirect target says which kind it is:
 *
 *  - `…/.git/worktrees/<name>` — a linked worktree, sharing the main
 *    repository's object store. Showing it as an independent clone would let a
 *    user "delete" it as if it were one.
 *  - `…/.git/modules/<name>`  — a submodule, whose parent tracks its commit as
 *    a gitlink.
 */
async function classify(
  dir: string,
  depth: number,
  workspaceFolder: string,
): Promise<DiscoveredRepo | undefined> {
  const gitPath = path.join(dir, '.git');

  let info;
  try {
    info = await stat(gitPath);
  } catch {
    return undefined;
  }

  const root = displayPath(dir);

  if (info.isDirectory()) {
    // `root` here is provisional: containment against the other discovered
    // repositories decides whether this is actually `nested`.
    return { root, gitDir: displayPath(gitPath), kind: 'root', workspaceFolder, depth };
  }

  if (!info.isFile()) return undefined;

  const target = await readGitFile(gitPath, dir);
  if (!target) return undefined;

  const normalized = pathKey(target);
  const kind: RepoKind = normalized.includes('/.git/worktrees/')
    ? 'worktree'
    : normalized.includes('/.git/modules/')
      ? 'submodule'
      : 'root';

  return { root, gitDir: displayPath(target), kind, workspaceFolder, depth };
}

/** Reads the `gitdir: <path>` redirect from a `.git` file. */
async function readGitFile(gitPath: string, containingDir: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(gitPath, 'utf8');
  } catch {
    return undefined;
  }

  const match = /^gitdir:\s*(.+)$/m.exec(content);
  const target = match?.[1]?.trim();
  if (!target) return undefined;

  // The redirect may be relative to the directory holding the `.git` file.
  return path.isAbsolute(target) ? target : path.resolve(containingDir, target);
}
