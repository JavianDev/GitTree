import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/shared/commands';
import type { RepoNode } from '../src/shared/model';
import { GitProcess } from '../src/extension/git/GitProcess';
import { GitScheduler } from '../src/extension/git/GitScheduler';
import { GitService } from '../src/extension/git/GitService';
import { hasGit } from './fixtures/make-workspace';

/**
 * The Files pane's commit box end to end against real git: a commit that a
 * hook refuses, the same commit with hooks skipped, the Push tab's outgoing
 * list before and after a push, the exact push Commit & Push runs, and a push
 * the remote refuses after the commit has landed.
 */
describe.skipIf(!hasGit())('Commit and Commit & Push against a real remote', () => {
  let root: string;
  let work: string;
  let remote: string;
  let service: GitService;

  const gitIn = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  const git = (...args: string[]) => gitIn(work, ...args);

  /** What the commit box sends to `commands/run` after a successful Commit & Push commit. */
  const pushArgv = async () => {
    const status = await service.status();
    return COMMANDS.push.build({ remote: 'origin', branch: status.branch.head, setUpstream: !status.branch.upstream });
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gittree-push-'));
    remote = path.join(root, 'remote.git');
    work = path.join(root, 'work');
    mkdirSync(work);
    gitIn(root, 'init', '--bare', '-b', 'main', remote);

    git('init', '-b', 'main');
    // GitService runs plain `git`, so identity and signing come from the repo's own config.
    git('config', 'user.name', 'T');
    git('config', 'user.email', 't@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', remote);
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'first');

    const node: RepoNode = {
      id: 'push',
      root: work,
      gitDir: path.join(work, '.git'),
      name: 'work',
      kind: 'root',
      children: [],
      depth: 0,
      workspaceFolder: work,
    };
    service = new GitService(node, new GitProcess('git'), new GitScheduler(2));
  }, 60_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('shows a refusing pre-commit hook verbatim, and skips it with Run git hooks unticked', async () => {
    const hook = path.join(work, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "lint: 2 problems" >&2\nexit 1\n');
    chmodSync(hook, 0o755);

    writeFileSync(path.join(work, 'b.txt'), 'two\n');
    git('add', 'b.txt');

    const message = 'feat: add b\n\n- second file';
    await expect(service.commit({ repoId: 'push', message, amend: false, signoff: false })).rejects.toThrow(/lint: 2 problems/);
    expect(git('log', '-1', '--format=%s')).toBe('first');

    const { hash } = await service.commit({ repoId: 'push', message, amend: false, signoff: false, noVerify: true });
    expect(git('rev-parse', 'HEAD')).toBe(hash);
    // Summary, blank line, description — exactly as the box joins them.
    expect(git('log', '-1', '--format=%B')).toBe(message);

    rmSync(hook);
  });

  it('lists every unpublished commit on a branch with no upstream', async () => {
    const outgoing = await service.outgoing();
    expect(outgoing.hasUpstream).toBe(false);
    expect(outgoing.commits.map((commit) => commit.subject)).toEqual(['feat: add b', 'first']);
  });

  it('pushes with the argv Commit & Push runs, setting the upstream on the first push', async () => {
    const argv = await pushArgv();
    expect(argv).toEqual(['push', '--set-upstream', 'origin', 'main']);

    const result = await service.run(argv);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gitIn(root, '--git-dir', remote, 'rev-parse', 'main')).toBe(git('rev-parse', 'HEAD'));

    const outgoing = await service.outgoing();
    expect(outgoing.hasUpstream).toBe(true);
    expect(outgoing.commits).toEqual([]);
  });

  it('counts only commits past the upstream, and pushes them without re-setting it', async () => {
    writeFileSync(path.join(work, 'c.txt'), 'three\n');
    git('add', 'c.txt');
    await service.commit({ repoId: 'push', message: 'fix: add c', amend: false, signoff: false });

    const outgoing = await service.outgoing();
    expect(outgoing.commits.map((commit) => commit.subject)).toEqual(['fix: add c']);

    const argv = await pushArgv();
    expect(argv).toEqual(['push', 'origin', 'main']);
    const result = await service.run(argv);
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await service.outgoing()).commits).toEqual([]);
  });

  it('reports a refused push after the commit has landed, as the commit box shows it', async () => {
    // Someone else pushes first.
    const other = path.join(root, 'other');
    gitIn(root, 'clone', remote, other);
    writeFileSync(path.join(other, 'd.txt'), 'theirs\n');
    gitIn(other, 'add', '.');
    gitIn(other, 'commit', '-m', 'their change');
    gitIn(other, 'push', 'origin', 'main');

    writeFileSync(path.join(work, 'e.txt'), 'mine\n');
    git('add', 'e.txt');
    const { hash } = await service.commit({ repoId: 'push', message: 'feat: add e', amend: false, signoff: false });

    const result = await service.run(await pushArgv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/rejected|fetch first|non-fast-forward/i);
    // The commit stays, so the box says "Committed, but the push failed".
    expect(git('rev-parse', 'HEAD')).toBe(hash);
  });
});
