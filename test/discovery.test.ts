import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverRepositories } from '../src/extension/repo/Discovery';
import { RepositoryTree, buildRepositoryTree } from '../src/extension/repo/RepositoryTree';
import { displayPath, pathKey } from '../src/extension/repo/identity';
import type { RepoNode } from '../src/shared/model';
import { hasGit, makeWorkspace, tryLink, type Workspace } from './fixtures/make-workspace';

const gitAvailable = hasGit();

describe.skipIf(!gitAvailable)('discovery against a real multi-level workspace', () => {
  let workspace: Workspace;
  let nodes: RepoNode[];

  const find = (dir: string): RepoNode | undefined =>
    nodes.find((node) => pathKey(node.root) === pathKey(dir));

  beforeAll(async () => {
    workspace = makeWorkspace();
    const discovered = await discoverRepositories([workspace.parent]);
    nodes = buildRepositoryTree(discovered);
  }, 120_000);

  afterAll(() => workspace?.dispose());

  it('finds every repository under the parent folder', () => {
    expect(nodes).toHaveLength(6);
    expect(nodes.map((n) => n.name).sort()).toEqual(
      ['alpha', 'beta', 'gamma', 'gamma-wt', 'lib', 'nested'].sort(),
    );
  });

  it('classifies sibling checkouts as roots', () => {
    for (const dir of [workspace.alpha, workspace.beta, workspace.gamma]) {
      expect(find(dir)?.kind).toBe('root');
      expect(find(dir)?.parentId).toBeUndefined();
    }
  });

  it('classifies a plain repo inside another worktree as nested, not a submodule', () => {
    // Staging this from the parent would commit an empty gitlink, so the
    // distinction has to survive discovery.
    const nested = find(workspace.nested);
    expect(nested?.kind).toBe('nested');
    expect(nested?.parentId).toBe(find(workspace.alpha)?.id);
  });

  it('classifies a real submodule as a submodule', () => {
    const submodule = find(workspace.submodule);
    expect(submodule?.kind).toBe('submodule');
    expect(submodule?.parentId).toBe(find(workspace.beta)?.id);
  });

  it('classifies a linked worktree as a worktree, not an independent clone', () => {
    const worktree = find(workspace.worktree);
    expect(worktree?.kind).toBe('worktree');
    // Its gitdir points into the main repository's .git/worktrees.
    expect(pathKey(worktree?.gitDir ?? '')).toContain('/.git/worktrees/');
  });

  it('records the containment hierarchy in both directions', () => {
    const alpha = find(workspace.alpha);
    const nested = find(workspace.nested);
    expect(alpha?.children).toContain(nested?.id);
    expect(nested?.parentId).toBe(alpha?.id);
  });

  it('indents by tree depth rather than filesystem depth', () => {
    expect(find(workspace.alpha)?.depth).toBe(0);
    expect(find(workspace.nested)?.depth).toBe(1);
  });

  it('never descends into the .git directory itself', () => {
    for (const node of nodes) {
      expect(pathKey(node.root)).not.toContain('/.git/');
    }
  });
});

describe.skipIf(!gitAvailable)('discovery is idempotent and loop-safe', () => {
  let workspace: Workspace;

  beforeAll(() => {
    workspace = makeWorkspace();
  }, 120_000);

  afterAll(() => workspace?.dispose());

  it('produces identical ids across repeated scans', async () => {
    const first = buildRepositoryTree(await discoverRepositories([workspace.parent]));
    const second = buildRepositoryTree(await discoverRepositories([workspace.parent]));

    expect(second.map((n) => n.id).sort()).toEqual(first.map((n) => n.id).sort());
  });

  it('lists a repository once when the same folder is scanned twice', async () => {
    const discovered = await discoverRepositories([workspace.parent, workspace.parent]);
    const keys = discovered.map((r) => pathKey(r.root));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists a repository once when reached through a junction', async () => {
    const link = path.join(workspace.base, 'link-to-parent');
    if (!tryLink(link, workspace.parent)) {
      // Junction creation can be blocked by policy; the dedupe path is still
      // covered by the duplicate-folder test above.
      return;
    }

    const discovered = await discoverRepositories([workspace.parent, displayPath(link)]);
    const names = discovered.map((r) => path.basename(r.root)).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma', 'gamma-wt', 'lib', 'nested']);
  });

  it('honours maxDepth', async () => {
    // At depth 1 the sibling checkouts are found but nothing inside them is.
    const shallow = await discoverRepositories([workspace.parent], { maxDepth: 1 });
    const names = shallow.map((r) => path.basename(r.root)).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma', 'gamma-wt']);
  });

  it('honours excludeDirs', async () => {
    const filtered = await discoverRepositories([workspace.parent], { excludeDirs: ['tools'] });
    expect(filtered.map((r) => path.basename(r.root))).not.toContain('nested');
  });
});

describe('RepositoryTree lookups', () => {
  const tree = new RepositoryTree();

  beforeAll(() => {
    tree.replace([
      { root: 'C:/work/parent', gitDir: 'C:/work/parent/.git', kind: 'root', workspaceFolder: 'C:/work', depth: 1 },
      {
        root: 'C:/work/parent/nested',
        gitDir: 'C:/work/parent/nested/.git',
        kind: 'root',
        workspaceFolder: 'C:/work',
        depth: 2,
      },
      { root: 'C:/work/other', gitDir: 'C:/work/other/.git', kind: 'root', workspaceFolder: 'C:/work', depth: 1 },
    ]);
  });

  it('attributes a file to the innermost containing repository', () => {
    expect(tree.owning('C:/work/parent/nested/src/x.ts')?.name).toBe('nested');
    expect(tree.owning('C:/work/parent/src/x.ts')?.name).toBe('parent');
  });

  it('returns undefined for a path outside every repository', () => {
    expect(tree.owning('C:/elsewhere/x.ts')).toBeUndefined();
  });

  it('exposes roots and children', () => {
    expect(tree.roots().map((n) => n.name).sort()).toEqual(['other', 'parent']);

    const parent = tree.roots().find((n) => n.name === 'parent');
    expect(tree.childrenOf(parent!.id).map((n) => n.name)).toEqual(['nested']);
  });

  it('reclassifies a contained root as nested', () => {
    expect(tree.owning('C:/work/parent/nested/a.ts')?.kind).toBe('nested');
  });
});
