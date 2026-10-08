import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
 * The graph re-walks history only when this fingerprint changes, so it must
 * stay put for everything that leaves history alone (editing, staging) and
 * move for everything that changes what the graph draws.
 */
describe.skipIf(!hasGit())('history fingerprint against real git', () => {
  let dir: string;
  let service: GitService;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  const write = (name: string, text: string) => writeFileSync(path.join(dir, name), text);

  beforeAll(() => {
    dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gittree-fp-')));
    git('init', '-q', '-b', 'main');
    write('a.txt', '1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'one');
    const node: RepoNode = { id: 'f', root: displayPath(dir), gitDir: '', name: 'f', kind: 'root', children: [], depth: 0, workspaceFolder: dir };
    service = new GitService(node, new GitProcess('git'), new GitScheduler(2));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores edits and staging, and notices every change to history', async () => {
    const start = await service.historyFingerprint();

    write('a.txt', '2\n');
    expect(await service.historyFingerprint()).toBe(start);
    git('add', 'a.txt');
    expect(await service.historyFingerprint()).toBe(start);

    git('commit', '-q', '-m', 'two');
    const afterCommit = await service.historyFingerprint();
    expect(afterCommit).not.toBe(start);

    git('branch', 'side');
    const afterBranch = await service.historyFingerprint();
    expect(afterBranch).not.toBe(afterCommit);

    // Same commit, different branch checked out: the HEAD pill moves.
    git('switch', '-q', 'side');
    const afterSwitch = await service.historyFingerprint();
    expect(afterSwitch).not.toBe(afterBranch);

    git('tag', 'v1');
    const afterTag = await service.historyFingerprint();
    expect(afterTag).not.toBe(afterSwitch);

    write('a.txt', '3\n');
    git('stash', 'push', '-q');
    expect(await service.historyFingerprint()).not.toBe(afterTag);
  });

  it('works in a repository with no commits yet', async () => {
    const empty = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gittree-fp0-')));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
      const node: RepoNode = { id: 'e', root: displayPath(empty), gitDir: '', name: 'e', kind: 'root', children: [], depth: 0, workspaceFolder: empty };
      const fresh = new GitService(node, new GitProcess('git'), new GitScheduler(1));
      await expect(fresh.historyFingerprint()).resolves.toContain('refs/heads/main');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
