import { describe, expect, it } from 'vitest';
import { parseWorktreeList, shortBranch } from '../src/extension/git/parsers/worktree';

const NUL = '\u0000';

describe('parseWorktreeList (-z)', () => {
  it('reads main, linked, detached, locked with a reason, and prunable records', () => {
    const output = [
      'worktree C:/Projects/App', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
      'worktree C:/Projects/App.worktrees/feature-login', 'HEAD 2222222222222222222222222222222222222222', 'branch refs/heads/feature/login', 'locked Visual QA\nin progress', '',
      'worktree C:/Projects/App.worktrees/review', 'HEAD 3333333333333333333333333333333333333333', 'detached', '',
      'worktree C:/Projects/App.worktrees/gone', 'HEAD 4444444444444444444444444444444444444444', 'branch refs/heads/spike', 'prunable gitdir file points to non-existent location', '',
      '',
    ].join(NUL);

    const records = parseWorktreeList(output, true);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ path: 'C:/Projects/App', branchRef: 'refs/heads/main', detached: false, locked: false });
    expect(records[1]).toMatchObject({ branchRef: 'refs/heads/feature/login', locked: true, lockReason: 'Visual QA\nin progress' });
    expect(records[2]).toMatchObject({ detached: true });
    expect(records[2]!.branchRef).toBeUndefined();
    expect(records[3]).toMatchObject({ prunable: true, prunableReason: 'gitdir file points to non-existent location' });
  });

  it('reads a bare repository and a locked worktree without a reason', () => {
    const output = ['worktree /srv/app.git', 'bare', '', 'worktree /srv/app-wt', 'HEAD abc', 'branch refs/heads/x', 'locked', '', ''].join(NUL);
    const records = parseWorktreeList(output, true);
    expect(records[0]).toMatchObject({ path: '/srv/app.git', bare: true });
    expect(records[1]).toMatchObject({ locked: true });
    expect(records[1]!.lockReason).toBeUndefined();
  });

  it('keeps spaces and unicode in paths, and ignores attributes it does not know', () => {
    const output = ['worktree C:/My Projects/Café app', 'HEAD abc', 'branch refs/heads/main', 'future-attribute yes', '', ''].join(NUL);
    expect(parseWorktreeList(output, true)[0]).toMatchObject({ path: 'C:/My Projects/Café app', branchRef: 'refs/heads/main' });
  });
});

describe('parseWorktreeList (legacy newline format)', () => {
  it('matches the -z parse, strips CR, and unquotes a C-quoted reason', () => {
    const output = [
      'worktree C:/Projects/App', 'HEAD abc', 'branch refs/heads/main', '',
      'worktree C:/Projects/App.worktrees/x', 'HEAD def', 'branch refs/heads/x', 'locked "line one\\nline \\"two\\""', '',
    ].join('\r\n');
    const records = parseWorktreeList(output, false);
    expect(records).toHaveLength(2);
    expect(records[0]!.path).toBe('C:/Projects/App');
    expect(records[1]).toMatchObject({ locked: true, lockReason: 'line one\nline "two"' });
  });

  it('decodes octal escapes as UTF-8', () => {
    const records = parseWorktreeList('worktree /a\nHEAD x\nlocked "caf\\303\\251"\n\n', false);
    expect(records[0]!.lockReason).toBe('café');
  });
});

describe('shortBranch', () => {
  it('drops refs/heads/ only', () => {
    expect(shortBranch('refs/heads/feature/login')).toBe('feature/login');
    expect(shortBranch(undefined)).toBeUndefined();
  });
});
