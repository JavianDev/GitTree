import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/shared/commands';
import type { RepoNode } from '../src/shared/model';
import { GitProcess } from '../src/extension/git/GitProcess';
import { GitScheduler } from '../src/extension/git/GitScheduler';
import { GitService } from '../src/extension/git/GitService';
import { WORKTREE_LIST_ARGS_LEGACY, parseWorktreeList } from '../src/extension/git/parsers/worktree';
import { classifyDirectory } from '../src/extension/repo/Discovery';
import { displayPath, pathKey } from '../src/extension/repo/identity';
import { hasGit } from './fixtures/make-workspace';

/**
 * The worktree lifecycle against real git, driven through the same command
 * specs the UI previews and runs: add (new branch, existing branch, remote
 * branch with tracking, tag detached), list in both formats, summary,
 * outgoing, lock, remove (dirty and locked force levels), move, prune, and
 * cleaning up a branch whose upstream is gone.
 */
describe.skipIf(!hasGit())('worktrees against real git', () => {
  let root: string;
  let app: string;
  let origin: string;
  let trees: string;
  let scheduler: GitScheduler;
  let service: GitService;

  const gitIn = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  const git = (...args: string[]) => gitIn(app, ...args);

  const serviceFor = (dir: string, id: string): GitService => {
    const node: RepoNode = { id, root: displayPath(dir), gitDir: '', name: id, kind: 'worktree', children: [], depth: 0, workspaceFolder: dir };
    return new GitService(node, new GitProcess('git'), scheduler);
  };
  const listed = async () => (await service.worktrees()).map((record) => ({ ...record, key: pathKey(record.path) }));
  const find = async (dir: string) => (await listed()).find((record) => record.key === pathKey(dir));

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gittree-wt-'));
    app = path.join(root, 'app');
    origin = path.join(root, 'origin.git');
    trees = path.join(root, 'app.worktrees');
    mkdirSync(app);
    gitIn(root, 'init', '--bare', '-b', 'main', origin);

    git('init', '-b', 'main');
    git('config', 'user.name', 'T');
    git('config', 'user.email', 't@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', origin);
    writeFileSync(path.join(app, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'first');
    git('tag', 'v1');
    git('push', '-u', 'origin', 'main');

    scheduler = new GitScheduler(2);
    service = serviceFor(app, 'app');
  }, 60_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('adds a new-branch worktree at a path containing a space', async () => {
    const target = path.join(trees, 'feature login');
    const argv = COMMANDS['worktree.add'].build({ newBranch: 'feature/login', noTrack: true, worktreePath: displayPath(target), commitish: 'main' });
    expect(argv).toEqual(['worktree', 'add', '-b', 'feature/login', '--no-track', '--', displayPath(target), 'main']);

    const result = await service.run(argv);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await find(target)).toMatchObject({ branchRef: 'refs/heads/feature/login', detached: false });
  });

  it('adds an existing branch, a remote branch with --track, and a tag detached', async () => {
    git('branch', 'existing');
    git('push', 'origin', 'main:refs/heads/remote-only');
    git('fetch', 'origin');

    const existing = path.join(trees, 'existing');
    const remote = path.join(trees, 'remote-only');
    const tag = path.join(trees, 'v1');
    expect((await service.run(COMMANDS['worktree.add'].build({ worktreePath: displayPath(existing), commitish: 'existing' }))).exitCode).toBe(0);
    expect(
      (await service.run(COMMANDS['worktree.add'].build({ newBranch: 'remote-only', track: true, worktreePath: displayPath(remote), commitish: 'origin/remote-only' }))).exitCode,
    ).toBe(0);
    expect((await service.run(COMMANDS['worktree.add'].build({ detach: true, worktreePath: displayPath(tag), commitish: 'v1' }))).exitCode).toBe(0);

    expect(await find(existing)).toMatchObject({ branchRef: 'refs/heads/existing' });
    expect(gitIn(remote, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/remote-only');
    expect(await find(tag)).toMatchObject({ detached: true });
  });

  it('lists the same records with and without -z, main first', async () => {
    const z = await service.worktrees();
    const legacy = parseWorktreeList(git(...WORKTREE_LIST_ARGS_LEGACY) + '\n\n', false);
    expect(legacy.map((r) => r.path)).toEqual(z.map((r) => r.path));
    expect(pathKey(z[0]!.path)).toBe(pathKey(app));
  });

  it('summarises a worktree and lists its unpublished commits through its own service', async () => {
    const dir = path.join(trees, 'feature login');
    writeFileSync(path.join(dir, 'b.txt'), 'two\n');
    gitIn(dir, 'add', 'b.txt');
    gitIn(dir, 'commit', '-m', 'login one');
    writeFileSync(path.join(dir, 'c.txt'), 'three\n');
    gitIn(dir, 'add', 'c.txt');
    gitIn(dir, 'commit', '-m', 'login two');
    writeFileSync(path.join(dir, 'staged.txt'), 's\n');
    gitIn(dir, 'add', 'staged.txt');
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    mkdirSync(path.join(dir, 'notes'));
    writeFileSync(path.join(dir, 'notes', 'todo.md'), '- x\n');

    const wt = serviceFor(dir, 'login');
    expect(await wt.summary()).toMatchObject({ staged: 1, unstaged: 1, untracked: 1, ahead: 0 });
    const outgoing = await wt.outgoing();
    expect(outgoing.hasUpstream).toBe(false);
    expect(outgoing.commits.map((commit) => commit.subject)).toEqual(['login two', 'login one']);
  });

  it('locks with a reason, and removing a locked worktree needs --force twice', async () => {
    const dir = path.join(trees, 'existing');
    expect((await service.run(COMMANDS['worktree.lock'].build({ lockReason: 'Visual QA', worktreePath: displayPath(dir) }))).exitCode).toBe(0);
    expect(await find(dir)).toMatchObject({ locked: true, lockReason: 'Visual QA' });

    const once = await service.run(COMMANDS['worktree.remove'].build({ force: true, worktreePath: displayPath(dir) }));
    expect(once.exitCode).not.toBe(0);
    const twice = COMMANDS['worktree.remove'].build({ forceLocked: true, worktreePath: displayPath(dir) });
    expect(twice).toEqual(['worktree', 'remove', '--force', '--force', '--', displayPath(dir)]);
    expect((await service.run(twice)).exitCode).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses to remove a dirty worktree until --force', async () => {
    const dir = path.join(trees, 'remote-only');
    writeFileSync(path.join(dir, 'scratch.txt'), 'x\n');
    const plain = await service.run(COMMANDS['worktree.remove'].build({ worktreePath: displayPath(dir) }));
    expect(plain.exitCode).not.toBe(0);
    expect(plain.stderr).toMatch(/modified or untracked|contains/i);
    expect((await service.run(COMMANDS['worktree.remove'].build({ force: true, worktreePath: displayPath(dir) }))).exitCode).toBe(0);
  });

  it('moves a worktree and git follows it', async () => {
    const from = path.join(trees, 'v1');
    const to = path.join(trees, 'release-v1');
    expect((await service.run(COMMANDS['worktree.move'].build({ worktreePath: displayPath(from), newPath: displayPath(to) }))).exitCode).toBe(0);
    expect(await find(to)).toBeDefined();
    expect(await find(from)).toBeUndefined();
  });

  it('prunes a worktree whose folder was deleted by hand', async () => {
    const dir = path.join(trees, 'spike');
    expect((await service.run(COMMANDS['worktree.add'].build({ newBranch: 'spike', worktreePath: displayPath(dir), commitish: 'main' }))).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(await find(dir)).toMatchObject({ prunable: true });

    const prune = await service.run(COMMANDS['worktree.prune'].build({ verbose: true }));
    expect(prune.exitCode).toBe(0);
    expect(await find(dir)).toBeUndefined();
  });

  it('cleans up a branch whose upstream is gone', async () => {
    git('branch', 'gone-b', 'main');
    git('push', '-u', 'origin', 'gone-b');
    git('push', 'origin', '--delete', 'gone-b');
    git('fetch', '--prune');
    expect((await service.refs()).find((ref) => ref.name === 'gone-b')?.gone).toBe(true);

    const argv = COMMANDS['branch.deleteGone'].build({ branches: ['gone-b'] });
    expect(argv).toEqual(['branch', '-d', 'gone-b']);
    expect((await service.run(argv)).exitCode).toBe(0);
    expect((await service.refs()).some((ref) => ref.name === 'gone-b')).toBe(false);
  });

  it('classifies worktrees by commondir, including a worktree of a bare repository', async () => {
    const linked = await classifyDirectory(displayPath(path.join(trees, 'feature login')), root, 0);
    expect(linked).toMatchObject({ kind: 'worktree' });
    expect(pathKey(linked!.commonDir!)).toBe(pathKey(path.join(app, '.git')));

    const main = await classifyDirectory(displayPath(app), root, 0);
    expect(main).toMatchObject({ kind: 'root' });
    expect(pathKey(main!.commonDir!)).toBe(pathKey(main!.gitDir));

    const bare = path.join(root, 'bare.git');
    gitIn(root, 'clone', '--bare', origin, bare);
    const bareTree = path.join(root, 'bare-wt');
    gitIn(bare, 'worktree', 'add', bareTree, 'main');
    expect(await classifyDirectory(displayPath(bareTree), root, 0)).toMatchObject({ kind: 'worktree' });
  });
});
