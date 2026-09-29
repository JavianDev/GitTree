import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoNode } from '../src/shared/model';
import { GitProcess } from '../src/extension/git/GitProcess';
import { GitScheduler } from '../src/extension/git/GitScheduler';
import { GitService } from '../src/extension/git/GitService';
import { LIST_FORMAT, LOG_FORMAT } from '../src/extension/git/parsers/log';
import { NUMSTAT_ARGS } from '../src/extension/git/parsers/numstat';
import { REF_ARGS } from '../src/extension/git/parsers/refs';
import { REMOTE_ARGS } from '../src/extension/git/parsers/remote';
import { STASH_ARGS } from '../src/extension/git/parsers/stash';
import { STATUS_ARGS } from '../src/extension/git/parsers/status';
import { hasGit } from './fixtures/make-workspace';

/**
 * Node refuses to spawn a process whose argv contains a NUL byte, so a format
 * string built from literal separators throws before git ever runs. That
 * shipped once — `git stash list` failed on every call, and the stash list was
 * silently empty — because the parser tests fed it hand-built output and never
 * spawned git. Separators belong in git's escapes (`%x00`, `%00`), which git
 * expands in its output.
 */
describe('git arguments are spawnable', () => {
  const argLists: Record<string, readonly string[]> = {
    STASH_ARGS,
    REF_ARGS,
    STATUS_ARGS,
    NUMSTAT_ARGS,
    REMOTE_ARGS,
    LOG_FORMAT: [LOG_FORMAT],
    LIST_FORMAT: [LIST_FORMAT],
  };

  for (const [name, args] of Object.entries(argLists)) {
    it(`${name} contains no NUL or other control characters`, () => {
      for (const arg of args) {
        // NUL is what Node rejects; the rest of C0 (bar tab/newline/CR) is never legitimate in an arg either.
        expect(/[\u0000-\u0008\u000e-\u001f]/.test(arg), `${name}: ${JSON.stringify(arg)}`).toBe(false);
      }
    });
  }
});

const gitAvailable = hasGit();

describe.skipIf(!gitAvailable)('GitService against a real repository', () => {
  let dir: string;
  let service: GitService;

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gittree-args-'));
    git('init', '-b', 'main');
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'first');

    writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    git('stash', 'push', '-m', 'first stash');
    writeFileSync(path.join(dir, 'a.txt'), 'three\n');
    git('stash', 'push', '-m', 'second stash');

    const node: RepoNode = {
      id: 'test',
      root: dir,
      gitDir: path.join(dir, '.git'),
      name: 'test',
      kind: 'root',
      children: [],
      depth: 0,
      workspaceFolder: dir,
    };
    service = new GitService(node, new GitProcess('git'), new GitScheduler(2));
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('lists every stash, newest first, with its message and branch', async () => {
    const stashes = await service.stashes();

    expect(stashes.map((stash) => stash.ref)).toEqual(['stash@{0}', 'stash@{1}']);
    expect(stashes[0]?.message).toContain('second stash');
    expect(stashes[1]?.message).toContain('first stash');
    expect(stashes[0]?.branch).toBe('main');
  });

  it('lists refs, including the stash ref', async () => {
    const refs = await service.refs();
    expect(refs.some((ref) => ref.name === 'main')).toBe(true);
  });
});
