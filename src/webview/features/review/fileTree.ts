import type { FileChangeKind, FileStatus } from '@shared/model';

/**
 * Folder nesting and ordering for the review pane's file list.
 *
 * Pure and React-free for the same reason `BranchTree` is: the interesting
 * behaviour is structural — how twenty-nine changed paths become a handful of
 * folder rows, and how a chain of single-child folders collapses into one —
 * and that is far easier to pin down in tests than through a rendered tree.
 */

/** Per-file line counts, from `git diff --numstat`. */
export interface FileLineStats {
  additions: number;
  deletions: number;
}

/**
 * A status entry with its line counts.
 *
 * The counts are optional because they come from a second git invocation that
 * may not have landed yet, and because a binary file has none at all. A tree
 * built before they arrive must still render, showing no counts rather than
 * `NaN`.
 */
export type ReviewFile = FileStatus & Partial<FileLineStats>;

export interface FileFolder {
  kind: 'folder';
  /**
   * Display name. A collapsed chain keeps its separators — `Controllers/V1` —
   * because that is the one row it renders as.
   */
  name: string;
  /** Full repo-relative prefix: `Insight.Api/Controllers/V1`. */
  path: string;
  children: FileNode[];
  /** Files anywhere beneath this folder, not just direct children. */
  count: number;
  /** Line counts rolled up from every file beneath. */
  additions: number;
  deletions: number;
}

export interface FileLeaf {
  kind: 'leaf';
  /** Final segment: `CompanyController.cs`. */
  name: string;
  path: string;
  file: ReviewFile;
  additions: number;
  deletions: number;
}

export type FileNode = FileFolder | FileLeaf;

/**
 * Groups changed files into folders by `/`.
 *
 * Folders sort before leaves and both sort by name, so a list that changes on
 * every save keeps a stable order instead of reshuffling under the cursor.
 */
export function buildFileTree(files: readonly ReviewFile[]): FileNode[] {
  const root: FileFolder = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
    count: 0,
    additions: 0,
    deletions: 0,
  };

  for (const file of files) {
    const segments = file.path.split('/');
    const leafName = segments.pop();
    if (!leafName) continue;

    const additions = file.additions ?? 0;
    const deletions = file.deletions ?? 0;

    let parent = root;
    parent.count++;
    parent.additions += additions;
    parent.deletions += deletions;

    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let next = parent.children.find(
        (child): child is FileFolder => child.kind === 'folder' && child.name === segment,
      );

      if (!next) {
        next = {
          kind: 'folder',
          name: segment,
          path,
          children: [],
          count: 0,
          additions: 0,
          deletions: 0,
        };
        parent.children.push(next);
      }

      next.count++;
      next.additions += additions;
      next.deletions += deletions;
      parent = next;
    }

    parent.children.push({
      kind: 'leaf',
      name: leafName,
      path: file.path,
      file,
      additions,
      deletions,
    });
  }

  // Sorted before collapsing, so the order is decided on plain segment names.
  // Sorting the merged names instead would compare `Insight.Core/Models`
  // against a sibling `Insight.Core2` and let a separator decide the order,
  // which is both arbitrary and no longer what `sortFiles('tree')` produces.
  sortNodes(root.children);
  return collapseChains(root.children);
}

/**
 * Merges runs of single-child folders into one row, the way GitHub and Azure
 * DevOps do.
 *
 * `Insight.Api` → `Controllers` → `V1` → one file is four rows of indentation
 * carrying one bit of information between them. Collapsed, it is one row and
 * the file is visible without expanding anything. Only folder-to-folder chains
 * merge: a folder holding a single *file* stays a folder, because that row is
 * where the file's own row hangs.
 */
function collapseChains(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => (node.kind === 'folder' ? collapseFolder(node) : node));
}

function collapseFolder(folder: FileFolder): FileFolder {
  folder.children = collapseChains(folder.children);

  let current = folder;
  while (current.children.length === 1) {
    const only = current.children[0];
    if (only?.kind !== 'folder') break;
    // Counts survive the merge untouched: every folder in a single-child chain
    // holds exactly the same files as the one below it.
    current = {
      ...current,
      name: `${current.name}/${only.name}`,
      path: only.path,
      children: only.children,
    };
  }

  return current;
}

function sortNodes(nodes: FileNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return compareNames(a.name, b.name);
  });

  for (const node of nodes) {
    if (node.kind === 'folder') sortNodes(node.children);
  }
}

/**
 * Every folder path in the tree, for expand-all and filter auto-expansion.
 *
 * These are the *rendered* rows, so a collapsed chain contributes only its
 * merged path. Keying expansion state on an intermediate path such as
 * `Insight.Api/Controllers` would target a row that does not exist.
 */
export function folderPaths(nodes: readonly FileNode[]): string[] {
  const paths: string[] = [];

  const walk = (list: readonly FileNode[]) => {
    for (const node of list) {
      if (node.kind !== 'folder') continue;
      paths.push(node.path);
      walk(node.children);
    }
  };

  walk(nodes);
  return paths;
}

/** Flattens back to the files in display order — the order selection ranges use. */
export function flattenFiles(nodes: readonly FileNode[]): ReviewFile[] {
  const files: ReviewFile[] = [];

  const walk = (list: readonly FileNode[]) => {
    for (const node of list) {
      if (node.kind === 'leaf') files.push(node.file);
      else walk(node.children);
    }
  };

  walk(nodes);
  return files;
}

/* ------------------------------------------------------------------------ */
/* Sorting                                                                  */
/* ------------------------------------------------------------------------ */

export type FileSortMode = 'tree' | 'path' | 'status';

/**
 * Rank for the `status` sort.
 *
 * Conflicts first because nothing else can be committed until they are
 * resolved; untracked and ignored last because git is not tracking them yet,
 * so they are the least likely thing the reviewer came here to read.
 */
const KIND_RANK: Record<FileChangeKind, number> = {
  conflicted: 0,
  added: 1,
  modified: 2,
  typechange: 3,
  renamed: 4,
  copied: 5,
  deleted: 6,
  untracked: 7,
  ignored: 8,
};

/**
 * Orders a flat file list. Returns a new array; the caller's is untouched,
 * because the list it holds is usually the last response from `status/get`.
 *
 * `tree` produces exactly the order `flattenFiles(buildFileTree(files))` does,
 * so switching a view between flat and nested does not reorder the rows.
 */
export function sortFiles(files: readonly ReviewFile[], mode: FileSortMode): ReviewFile[] {
  const sorted = files.slice();

  switch (mode) {
    case 'path':
      return sorted.sort((a, b) => compareNames(a.path, b.path));

    case 'status':
      return sorted.sort(
        (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareNames(a.path, b.path),
      );

    case 'tree':
      return sorted.sort((a, b) => compareTreePaths(a.path, b.path));
  }
}

/** Segment-wise comparison that puts folders before files at every level. */
function compareTreePaths(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i++) {
    const l = left[i];
    const r = right[i];
    if (l === undefined || r === undefined) break;
    if (l === r) continue;

    // A segment with more segments after it is a folder at this level.
    const lFolder = i < left.length - 1;
    const rFolder = i < right.length - 1;
    if (lFolder !== rFolder) return lFolder ? -1 : 1;

    return compareNames(l, r);
  }

  return left.length - right.length;
}

/**
 * Case-insensitive, digit-aware name order.
 *
 * The exact-string tiebreak matters here in a way it does not for branches:
 * `README.md` and `readme.md` can both exist in one tree, and a comparator
 * that calls them equal lets the sort place them in either order from one
 * refresh to the next.
 */
function compareNames(a: string, b: string): number {
  const collated = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  if (collated !== 0) return collated;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
