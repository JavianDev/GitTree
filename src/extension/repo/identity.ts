import { createHash } from 'node:crypto';
import type { RepoId } from '@shared/model';

/**
 * Path identity for repositories.
 *
 * Repositories are keyed by path, and on Windows the same repository reaches
 * the extension by several spellings at once:
 *
 *  - `git rev-parse --show-toplevel` returns forward slashes and a lowercase
 *    drive letter; `vscode.workspace` hands back backslashes and an uppercase
 *    one.
 *  - NTFS is case-insensitive, so `C:\Projects\App` and `c:\projects\app` are
 *    the same directory.
 *  - Junctions and symlinks give a second path to the same real directory.
 *
 * Treating any of those as distinct produces a duplicated repo in the tree,
 * two watchers firing on every change, and doubled rows in the unified graph.
 * `repoKey` collapses all of them; `displayPath` keeps the spelling a human
 * should see.
 */

export type Platform = 'win32' | 'posix';

const currentPlatform = (): Platform => (process.platform === 'win32' ? 'win32' : 'posix');

/**
 * Canonical display form: forward slashes, no trailing separator, drive letter
 * uppercased. Original casing of the rest of the path is preserved.
 */
export function displayPath(input: string, platform: Platform = currentPlatform()): string {
  let value = input.replace(/\\/g, '/');

  // Collapse repeated separators, but keep a leading `//` (UNC share).
  const uncPrefix = value.startsWith('//') ? '//' : '';
  value = uncPrefix + value.slice(uncPrefix.length).replace(/\/{2,}/g, '/');

  if (platform === 'win32') {
    value = value.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
  }

  // Trailing slash carries no meaning, except for a filesystem root.
  if (value.length > 1 && value.endsWith('/') && !/^[A-Za-z]:\/$/.test(value)) {
    value = value.slice(0, -1);
  }

  return value;
}

/**
 * Comparison key for a path. Identical directories always produce an identical
 * key, which is what makes deduplication and longest-prefix routing correct.
 *
 * Case is folded on Windows only — POSIX filesystems are case-sensitive, and
 * folding there would merge two genuinely different repositories.
 */
export function pathKey(input: string, platform: Platform = currentPlatform()): string {
  const normalized = displayPath(input, platform);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Stable identity for a repository, derived from its resolved real path.
 *
 * Hashed rather than used raw so the id is a safe DOM id, a safe object key,
 * and a fixed length regardless of how deep the repository sits.
 */
export function repoId(realPath: string, platform: Platform = currentPlatform()): RepoId {
  return createHash('sha256').update(pathKey(realPath, platform)).digest('hex').slice(0, 16);
}

/**
 * True when `child` is the same path as `parent` or sits beneath it.
 *
 * The separator check is what stops `C:/proj/app2` from being treated as a
 * child of `C:/proj/app`.
 */
export function isPathInside(child: string, parent: string, platform: Platform = currentPlatform()): boolean {
  const c = pathKey(child, platform);
  const p = pathKey(parent, platform);
  return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/**
 * Picks the repository that owns a path.
 *
 * Longest prefix wins, so a file inside a nested repository is attributed to
 * the nested repository rather than to the outer one that contains it. This is
 * what makes blame, status, and history correct in a multi-level workspace.
 */
export function findOwningPath<T extends { root: string }>(
  candidates: readonly T[],
  filePath: string,
  platform: Platform = currentPlatform(),
): T | undefined {
  let best: T | undefined;
  let bestLength = -1;

  for (const candidate of candidates) {
    if (!isPathInside(filePath, candidate.root, platform)) continue;
    const length = pathKey(candidate.root, platform).length;
    if (length > bestLength) {
      best = candidate;
      bestLength = length;
    }
  }

  return best;
}

/**
 * The path of `child` relative to `parent`, in git's own form: forward slashes,
 * no leading separator. Returns undefined when `child` is not inside `parent`.
 *
 * Comparison is done on keys (case-folded on Windows) while the returned value
 * is sliced from the original, so the result keeps the casing git will report.
 */
export function relativeTo(
  parent: string,
  child: string,
  platform: Platform = currentPlatform(),
): string | undefined {
  if (!isPathInside(child, parent, platform)) return undefined;

  const parentKey = pathKey(parent, platform);
  const childDisplay = displayPath(child, platform);
  if (pathKey(child, platform) === parentKey) return '';

  return childDisplay.slice(parentKey.length + 1);
}

/**
 * Disambiguates repositories that share a folder name by prefixing the parent
 * folder, the way a source list distinguishes two files with the same name.
 */
export function disambiguateNames<T extends { root: string; name: string }>(repos: T[]): void {
  const byName = new Map<string, T[]>();

  for (const repo of repos) {
    const bucket = byName.get(repo.name);
    if (bucket) bucket.push(repo);
    else byName.set(repo.name, [repo]);
  }

  for (const [, bucket] of byName) {
    if (bucket.length < 2) continue;
    for (const repo of bucket) {
      const segments = displayPath(repo.root).split('/');
      const parent = segments[segments.length - 2];
      if (parent) repo.name = `${parent}/${repo.name}`;
    }
  }
}
