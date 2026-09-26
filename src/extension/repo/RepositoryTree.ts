import path from 'node:path';
import type { RepoId, RepoNode } from '@shared/model';
import type { DiscoveredRepo } from './Discovery';
import { disambiguateNames, findOwningPath, isPathInside, pathKey, repoId } from './identity';

/**
 * Turns a flat discovery result into the containment hierarchy the sidebar
 * renders and every path lookup consults.
 *
 * Pure and synchronous, so the classification rules — which are the part that
 * causes data loss when wrong — are testable without a filesystem.
 */
export function buildRepositoryTree(discovered: readonly DiscoveredRepo[]): RepoNode[] {
  // Shallower paths first, so a containing repository is always processed
  // before the repositories inside it.
  const ordered = [...discovered].sort((a, b) => a.root.length - b.root.length);

  const nodes: RepoNode[] = ordered.map((repo) => ({
    id: repoId(repo.root),
    root: repo.root,
    gitDir: repo.gitDir,
    name: path.basename(repo.root) || repo.root,
    kind: repo.kind,
    children: [],
    depth: repo.depth,
    workspaceFolder: repo.workspaceFolder,
  }));

  const byId = new Map<RepoId, RepoNode>(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    const parent = findInnermostContainer(nodes, node);
    if (!parent) continue;

    node.parentId = parent.id;
    parent.children.push(node.id);

    // A plain checkout inside another repository's worktree is `nested`, not a
    // root. The distinction matters: the parent's status shows it as a single
    // untracked directory, and staging that directory commits an empty gitlink
    // rather than the work inside it.
    if (node.kind === 'root') node.kind = 'nested';
  }

  // Depth in the tree, rather than depth below the workspace folder, is what
  // the sidebar indents by.
  for (const node of nodes) {
    node.depth = treeDepth(node, byId);
  }

  disambiguateNames(nodes);
  return nodes;
}

/** The closest repository whose worktree contains this one. */
function findInnermostContainer(nodes: readonly RepoNode[], node: RepoNode): RepoNode | undefined {
  const containers = nodes.filter(
    (candidate) => candidate.id !== node.id && isPathInside(node.root, candidate.root),
  );

  let best: RepoNode | undefined;
  for (const candidate of containers) {
    if (!best || pathKey(candidate.root).length > pathKey(best.root).length) best = candidate;
  }
  return best;
}

function treeDepth(node: RepoNode, byId: ReadonlyMap<RepoId, RepoNode>): number {
  let depth = 0;
  let current = node;

  // The guard is a cycle backstop; containment cannot loop, but a corrupted
  // parent link should not hang the extension.
  while (current.parentId && depth < 64) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
    depth++;
  }

  return depth;
}

/**
 * The live repository set.
 *
 * Holds the tree and answers the two questions everything else asks: "which
 * repository owns this file?" and "what is under this node?".
 */
export class RepositoryTree {
  private nodes: RepoNode[] = [];
  private byId = new Map<RepoId, RepoNode>();

  replace(discovered: readonly DiscoveredRepo[]): RepoNode[] {
    this.nodes = buildRepositoryTree(discovered);
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    return this.all();
  }

  all(): RepoNode[] {
    return this.nodes;
  }

  /** Top-level nodes, in display order. */
  roots(): RepoNode[] {
    return this.nodes.filter((node) => !node.parentId);
  }

  get(id: RepoId): RepoNode | undefined {
    return this.byId.get(id);
  }

  childrenOf(id: RepoId): RepoNode[] {
    const node = this.byId.get(id);
    if (!node) return [];
    return node.children
      .map((childId) => this.byId.get(childId))
      .filter((child): child is RepoNode => child !== undefined);
  }

  /**
   * The repository that owns a file, by longest matching prefix.
   *
   * This is what makes blame, status, and history land in the right repository
   * when the active editor is inside a nested checkout.
   */
  owning(filePath: string): RepoNode | undefined {
    return findOwningPath(this.nodes, filePath);
  }

  get size(): number {
    return this.nodes.length;
  }
}
