import { describe, expect, it } from 'vitest';
import type { WorktreeEntry } from '../src/shared/model';
import {
  folderNameFor,
  isInsidePath,
  moveBlocker,
  normalizePath,
  preservedSubfolder,
  removeBlocker,
  requiredForce,
  sanitizeSegment,
  shortestUniquePaths,
  suggestWorktreePath,
  uniquePath,
  validateBranchName,
  worktreeTargetOf,
} from '../src/shared/worktrees';

const vars = { userHome: 'C:/Users/me', repoName: 'GitTree', repoParent: 'C:/Projects', repoRoot: 'C:/Projects/GitTree' };
const location = { directory: '', subfolder: '', preserveBranchHierarchy: false };

describe('folder names', () => {
  it('flattens or keeps branch folders', () => {
    expect(folderNameFor('feature/login', false)).toBe('feature-login');
    expect(folderNameFor('feature/login', true)).toBe('feature/login');
  });

  it('makes every segment safe on Windows', () => {
    expect(sanitizeSegment('a<b>c:d"e|f?g*h')).toBe('a-b-c-d-e-f-g-h');
    expect(sanitizeSegment('trailing. ')).toBe('trailing');
    expect(sanitizeSegment('CON')).toBe('CON_');
    expect(sanitizeSegment('com1.txt')).toBe('com1.txt_');
    expect(sanitizeSegment('..')).toBe('worktree');
    expect(folderNameFor('//', false)).toBe('worktree');
  });
});

describe('suggestWorktreePath', () => {
  it('defaults to a sibling <repo>.worktrees folder', () => {
    expect(suggestWorktreePath('feature/login', location, vars, 'win32').path).toBe('C:/Projects/GitTree.worktrees/feature-login');
  });

  it('keeps the branch hierarchy when asked', () => {
    const result = suggestWorktreePath('feature/login', { ...location, preserveBranchHierarchy: true }, vars, 'win32');
    expect(result.path).toBe('C:/Projects/GitTree.worktrees/feature/login');
  });

  it('uses a sub-folder inside the repository, which takes precedence over the directory', () => {
    const result = suggestWorktreePath('x', { ...location, subfolder: '.worktrees', directory: 'D:/elsewhere' }, vars, 'win32');
    expect(result.path).toBe('C:/Projects/GitTree/.worktrees/x');
    expect(suggestWorktreePath('x', { ...location, subfolder: '../out' }, vars, 'win32').error).toMatch(/inside the repository/);
  });

  it('expands variables and ~, appending the branch folder unless ${branch} is used', () => {
    expect(suggestWorktreePath('x', { ...location, directory: '${userHome}/worktrees/${repoName}' }, vars, 'win32').path).toBe(
      'C:/Users/me/worktrees/GitTree/x',
    );
    expect(suggestWorktreePath('x', { ...location, directory: '~/wt' }, vars, 'win32').path).toBe('C:/Users/me/wt/x');
    expect(suggestWorktreePath('feat/y', { ...location, directory: 'D:/wt/${branch}-${repoName}' }, vars, 'win32').path).toBe(
      'D:/wt/feat-y-GitTree',
    );
  });

  it('resolves a relative directory against the repository parent', () => {
    expect(suggestWorktreePath('x', { ...location, directory: 'trees' }, vars, 'win32').path).toBe('C:/Projects/trees/x');
  });

  it('rejects unknown variables and warns about paths inside the repository', () => {
    expect(suggestWorktreePath('x', { ...location, directory: '${nope}/a' }, vars, 'win32').error).toMatch(/Unknown variable \$\{nope\}/);
    const inside = suggestWorktreePath('x', { ...location, directory: '${repoRoot}/wt' }, vars, 'win32');
    expect(inside.warnings.join(' ')).toMatch(/inside the repository/);
  });

  it('warns about long paths on Windows only', () => {
    const name = 'a'.repeat(210);
    expect(suggestWorktreePath(name, location, vars, 'win32').warnings.join(' ')).toMatch(/longpaths/);
    expect(suggestWorktreePath(name, location, vars, 'posix').warnings).toEqual([]);
  });
});

describe('uniquePath', () => {
  it('suffixes -2 … until free', () => {
    const taken = new Set(['C:/a/x', 'C:/a/x-2']);
    expect(uniquePath('C:/a/x', (p) => taken.has(p))).toBe('C:/a/x-3');
    expect(uniquePath('C:/a/y', () => false)).toBe('C:/a/y');
  });
});

describe('validateBranchName', () => {
  it('follows git check-ref-format', () => {
    expect(validateBranchName('feature/login')).toBeUndefined();
    for (const bad of ['', '-x', 'a b', 'a..b', 'a@{b', '/a', 'a/', 'a//b', 'a.', '.a', 'a/.b', 'a.lock', 'a/b.lock', 'a~b', 'a:b', '@']) {
      expect(validateBranchName(bad), bad).toBeDefined();
    }
  });
});

describe('worktreeTargetOf', () => {
  it('finds the path, new branch, and commit-ish of add', () => {
    expect(worktreeTargetOf(['worktree', 'add', '-b', 'feat/x', '--no-track', '--', 'C:/wt/x', 'main'])).toEqual({
      verb: 'add',
      path: 'C:/wt/x',
      commitish: 'main',
      newBranch: 'feat/x',
    });
  });

  it('skips option values and handles move, remove, and lock', () => {
    expect(worktreeTargetOf(['worktree', 'move', '--force', '--', 'C:/a', 'C:/b'])).toMatchObject({ path: 'C:/a', newPath: 'C:/b' });
    expect(worktreeTargetOf(['worktree', 'remove', '--force', '--force', '--', 'C:/a'])).toMatchObject({ verb: 'remove', path: 'C:/a' });
    expect(worktreeTargetOf(['worktree', 'lock', '--reason', 'QA', '--', 'C:/a'])).toMatchObject({ path: 'C:/a' });
    expect(worktreeTargetOf(['status'])).toBeUndefined();
  });

  it('treats a path after -- as a path even when it starts with a dash', () => {
    expect(worktreeTargetOf(['worktree', 'remove', '--', '-odd'])).toMatchObject({ path: '-odd' });
  });
});

describe('paths and presentation', () => {
  it('normalizes', () => {
    expect(normalizePath('c:\\a\\b\\..\\c\\')).toBe('C:/a/c');
    expect(normalizePath('/x/./y//z')).toBe('/x/y/z');
  });

  it('compares case-insensitively on Windows only', () => {
    expect(isInsidePath('C:/A/b', 'c:/a', 'win32')).toBe(true);
    expect(isInsidePath('/A/b', '/a', 'posix')).toBe(false);
    expect(isInsidePath('C:/proj/app2', 'C:/proj/app', 'win32')).toBe(false);
  });

  it('finds the shortest unique trailing paths', () => {
    const map = shortestUniquePaths(['C:/x/A.worktrees/login', 'C:/x/B.worktrees/login', 'C:/x/B.worktrees/other'], 'win32');
    expect(map.get('C:/x/A.worktrees/login')).toBe('A.worktrees/login');
    expect(map.get('C:/x/B.worktrees/other')).toBe('other');
  });

  it('works out the sub-folder to reopen', () => {
    expect(preservedSubfolder('C:/repo', 'C:/repo/packages/web', 'win32')).toBe('packages/web');
    expect(preservedSubfolder('C:/repo', 'C:/repo', 'win32')).toBe('');
    expect(preservedSubfolder('C:/repo', 'C:/other', 'win32')).toBeUndefined();
  });
});

describe('remove safety', () => {
  const entry = (patch: Partial<WorktreeEntry>): WorktreeEntry => ({
    path: 'C:/wt/x', repoId: 'r', detached: false, bare: false, isMain: false, isCurrent: false,
    locked: false, prunable: false, missing: false, openInWindow: false, inTree: false, ...patch,
  });
  const summary = { path: 'C:/wt/x', staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ahead: 0, behind: 0 };

  it('blocks main, current, open-in-window, and missing worktrees', () => {
    expect(removeBlocker(entry({ isMain: true }))).toMatch(/main worktree/);
    expect(removeBlocker(entry({ isCurrent: true }))).toMatch(/This tab/);
    expect(removeBlocker(entry({ openInWindow: true }))).toMatch(/VS Code window/);
    expect(removeBlocker(entry({ missing: true }))).toMatch(/Prune/);
    expect(removeBlocker(entry({}))).toBeUndefined();
    expect(moveBlocker(entry({ isMain: true }))).toMatch(/main worktree/);
  });

  it('needs one --force for changes and two for a locked worktree', () => {
    expect(requiredForce(entry({}), summary)).toBe(0);
    expect(requiredForce(entry({}), { ...summary, untracked: 1 })).toBe(1);
    expect(requiredForce(entry({ locked: true }), summary)).toBe(2);
  });
});
