import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_FILES, gitWatchTargets } from '../src/extension/watch/gitWatchTargets';

const norm = (p: string) => p.replace(/\\/g, '/');

describe('gitWatchTargets', () => {
  it('watches the git files and refs of an ordinary repository, nothing more', () => {
    const targets = gitWatchTargets({ gitDir: 'C:/repo/.git', commonDir: 'C:/repo/.git' });
    expect(targets.map((t) => norm(t.path))).toEqual([
      ...GIT_FILES.map((file) => `C:/repo/.git/${file}`),
      'C:/repo/.git/refs',
    ]);
  });

  it('also watches the common directory refs of a linked worktree, where its branch moves land', () => {
    const targets = gitWatchTargets({ gitDir: 'C:/repo/.git/worktrees/login', commonDir: 'C:/repo/.git' });
    const paths = targets.map((t) => norm(t.path));
    expect(paths).toContain('C:/repo/.git/worktrees/login/HEAD');
    expect(paths).toContain('C:/repo/.git/refs');
    expect(paths).toContain('C:/repo/.git/packed-refs');
    expect(targets.find((t) => norm(t.path) === 'C:/repo/.git/refs')?.recursive).toBe(true);
    // Never the whole worktrees folder: it fires on every git operation in any worktree.
    expect(paths.some((p) => p === norm(path.join('C:/repo/.git', 'worktrees')))).toBe(false);
  });
});
