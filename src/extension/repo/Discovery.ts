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
  /** The common git directory linked worktrees share; equals `gitDir` for an ordinary checkout. */
  commonDir?: string;
  /**
   * Classification from filesystem evidence alone. `nested` versus `root` is
   * resolved later, once the full set is known and containment can be tested.
   */
  kind: RepoKind;
  /** Workspace folder this repository was found under. */
  workspaceFolder: string;
  /** Levels below the workspace folder. */
  depth: number;
  /** Opened by path from outside every scanned folder (a worktree in a sibling folder). */
  external?: boolean;
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
    const repo = await classifyDirectory(dir, workspaceFolder, depth);
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
 * elsewhere, and what it redirects to says which kind it is:
 *
 *  - a gitdir holding a `commondir` file — a linked worktree, sharing the main
 *    repository's object store. Showing it as an independent clone would let a
 *    user "delete" it as if it were one. Reading `commondir` rather than
 *    matching `/.git/worktrees/` in the path is what also recognises a worktree
 *    of a *bare* repository (`app.git/worktrees/<name>`).
 *  - `…/modules/<name>` — a submodule, whose parent tracks its commit as a
 *    gitlink.
 *
 * Exported for opening a single worktree folder without a full scan.
 */
export async function classifyDirectory(
  dir: string,
  workspaceFolder: string,
  depth: number,
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
    const gitDir = displayPath(gitPath);
    return { root, gitDir, commonDir: gitDir, kind: 'root', workspaceFolder, depth };
  }

  if (!info.isFile()) return undefined;

  const target = await readGitFile(gitPath, dir);
  if (!target) return undefined;

  const commonDir = await readCommonDir(target);
  const normalized = pathKey(target);
  const kind: RepoKind = commonDir
    ? 'worktree'
    : normalized.includes('/modules/')
      ? 'submodule'
      : 'root';

  const gitDir = displayPath(target);
  return { root, gitDir, commonDir: commonDir ? displayPath(commonDir) : gitDir, kind, workspaceFolder, depth };
}

/**
 * A linked worktree's gitdir names the shared repository in `commondir`,
 * usually relative (`../..`). Absent for anything that is not a worktree.
 */
async function readCommonDir(gitDir: string): Promise<string | undefined> {
  try {
    const content = (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim();
    if (!content) return undefined;
    return path.isAbsolute(content) ? content : path.resolve(gitDir, content);
  } catch {
    return undefined;
  }
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
