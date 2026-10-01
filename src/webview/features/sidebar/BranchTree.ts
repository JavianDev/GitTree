import type { RefEntry } from '@shared/model';

/**
 * Folder nesting for ref lists.
 *
 * Pure and React-free, because the interesting behaviour is structural — how
 * `feature/INST-11308-crm-decoupling` becomes a `feature` folder containing one
 * leaf, and how thirty-one such branches collapse into one collapsible row — and
 * that is far easier to pin down in tests than through a rendered component.
 */

export interface RefFolder {
  kind: 'folder';
  /** Segment name: `feature`. */
  name: string;
  /** Full prefix including trailing segments: `feature/nested`. */
  path: string;
  children: RefNode[];
  /** Refs anywhere beneath this folder, not just direct children. */
  count: number;
}

export interface RefLeaf {
  kind: 'leaf';
  /** Final segment: `INST-11308-crm-decoupling`. */
  name: string;
  ref: RefEntry;
}

export type RefNode = RefFolder | RefLeaf;

/**
 * Groups refs into folders by `/`.
 *
 * Folders sort before leaves and both sort alphabetically, so a list that grows
 * by dozens of ticket branches stays in a stable, predictable order rather than
 * reshuffling whenever someone pushes.
 */
export function buildRefTree(refs: readonly RefEntry[]): RefNode[] {
  const root: RefFolder = { kind: 'folder', name: '', path: '', children: [], count: 0 };

  for (const ref of refs) {
    const segments = ref.name.split('/');
    const leafName = segments.pop();
    if (!leafName) continue;

    let parent = root;
    parent.count++;

    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let next = parent.children.find(
        (child): child is RefFolder => child.kind === 'folder' && child.name === segment,
      );

      if (!next) {
        next = { kind: 'folder', name: segment, path, children: [], count: 0 };
        parent.children.push(next);
      }

      next.count++;
      parent = next;
    }

    parent.children.push({ kind: 'leaf', name: leafName, ref });
  }

  sortNodes(root.children);
  return root.children;
}

function sortNodes(nodes: RefNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  for (const node of nodes) {
    if (node.kind === 'folder') sortNodes(node.children);
  }
}

/** Every folder path in the tree, for expand-all and filter auto-expansion. */
export function folderPaths(nodes: readonly RefNode[]): string[] {
  const paths: string[] = [];

  const walk = (list: readonly RefNode[]) => {
    for (const node of list) {
      if (node.kind !== 'folder') continue;
      paths.push(node.path);
      walk(node.children);
    }
  };

  walk(nodes);
  return paths;
}

/** Flattens back to the refs in display order. */
export function flattenRefs(nodes: readonly RefNode[]): RefEntry[] {
  const refs: RefEntry[] = [];

  const walk = (list: readonly RefNode[]) => {
    for (const node of list) {
      if (node.kind === 'leaf') refs.push(node.ref);
      else walk(node.children);
    }
  };

  walk(nodes);
  return refs;
}

/**
 * The most recently committed refs, for the pinned RECENT group.
 *
 * The checked-out branch is excluded because it already has its own CURRENT
 * group, and listing it twice wastes the space this group exists to save.
 */
export function recentRefs(refs: readonly RefEntry[], count = 5): RefEntry[] {
  return refs
    .filter((ref) => !ref.isHead && ref.kind === 'localBranch' && ref.committedAt)
    .slice()
    .sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''))
    .slice(0, count);
}

/* -------------------------------------------------------------------------- */
/* Generic folders                                                            */
/* -------------------------------------------------------------------------- */

export interface TreeFolder<T> {
  kind: 'folder';
  name: string;
  path: string;
  children: Array<TreeNode<T>>;
  count: number;
}

export interface TreeLeaf<T> {
  kind: 'leaf';
  name: string;
  item: T;
}

export type TreeNode<T> = TreeFolder<T> | TreeLeaf<T>;

/**
 * The same `/` grouping `buildRefTree` gives branches, for anything with a
 * slash-separated name — worktrees grouped by their branch's folder, so
 * `feature/login` and `feature/themes` sit under one `feature` row.
 */
export function buildTree<T>(items: readonly T[], nameOf: (item: T) => string): Array<TreeNode<T>> {
  const root: TreeFolder<T> = { kind: 'folder', name: '', path: '', children: [], count: 0 };

  for (const item of items) {
    const segments = nameOf(item).split('/').filter((segment) => segment.length > 0);
    const leafName = segments.pop();
    if (!leafName) continue;

    let parent = root;
    parent.count++;
    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let next = parent.children.find(
        (child): child is TreeFolder<T> => child.kind === 'folder' && child.name === segment,
      );
      if (!next) {
        next = { kind: 'folder', name: segment, path, children: [], count: 0 };
        parent.children.push(next);
      }
      next.count++;
      parent = next;
    }
    parent.children.push({ kind: 'leaf', name: leafName, item });
  }

  const sort = (nodes: Array<TreeNode<T>>): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    for (const node of nodes) if (node.kind === 'folder') sort(node.children);
  };
  sort(root.children);
  return root.children;
}
