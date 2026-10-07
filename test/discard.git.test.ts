import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoNode } from '../src/shared/model';
import { GitProcess } from '../src/extension/git/GitProcess';
import { GitScheduler } from '../src/extension/git/GitScheduler';
import { GitService } from '../src/extension/git/GitService';
import { displayPath } from '../src/extension/repo/identity';
import { hasGit } from './fixtures/make-workspace';

/**
 * Discard against real git, through the same service call the Discard button,
 * Discard All, and the right-click menu make: tracked files go back to their
 * staged version, untracked files and folders are deleted, and staged changes
 * and ignored files are left exactly as they were.
 */
describe.skipIf(!hasGit())('discard against real git', () => {
  let dir: string;
  let service: GitService;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  const write = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  };
  // git on Windows may write checked-out files with CRLF; compare the text, not the line endings.
  const read = (name: string) => readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gittree-discard-'));
    git('init', '-q', '-b', 'main');
    write('a.txt', 'a1\n');
    write('b.txt', 'b1\n');
    write('.gitignore', 'build/\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const node: RepoNode = { id: 'd', root: displayPath(dir), gitDir: '', name: 'd', kind: 'root', children: [], depth: 0, workspaceFolder: dir };
    service = new GitService(node, new GitProcess('git'), new GitScheduler(2));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('restores tracked files, deletes untracked ones, and keeps staged and ignored work', async () => {
    write('a.txt', 'a2 staged\n');
    git('add', 'a.txt');
    write('a.txt', 'a3 unstaged on top\n');
    write('b.txt', 'b2 unstaged\n');
    write('new.txt', 'new\n');
    write('newdir/inner.txt', 'inner\n');
    write('build/out.js', 'ignored\n');

    await service.discardFiles(['a.txt', 'b.txt'], undefined, ['new.txt', 'newdir/']);

    expect(read('a.txt')).toBe('a2 staged\n'); // back to the staged version, not the commit
    expect(git('diff', '--cached', '--name-only')).toBe('a.txt'); // still staged
    expect(read('b.txt')).toBe('b1\n');
    expect(existsSync(path.join(dir, 'new.txt'))).toBe(false);
    expect(existsSync(path.join(dir, 'newdir'))).toBe(false);
    expect(existsSync(path.join(dir, 'build/out.js'))).toBe(true); // ignored files are never cleaned
  });

  it('does nothing when given nothing', async () => {
    await expect(service.discardFiles([], undefined, [])).resolves.toBeUndefined();
  });
});
