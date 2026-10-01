import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS, archiveFormatFor, isDestructive, patchFileName, renderCommand, tokenize, type CommandContext, type CommandId } from '../src/shared/commands';
import type { Commit, RefDecoration, WorktreeEntry } from '../src/shared/model';
import { checkoutPlan, commitMenu } from '../src/webview/features/history/commitActions';
import { hasGit } from './fixtures/make-workspace';

const commit = (refs: RefDecoration[] = [], parents = ['p1']): Commit => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  parents,
  author: { name: 'A', email: 'a@x' },
  authorDate: '2026-01-01T00:00:00Z',
  committer: { name: 'A', email: 'a@x' },
  commitDate: '2026-01-01T00:00:00Z',
  refs,
  signature: 'none',
  subject: 'Fix: the thing!',
  body: '',
});
const local = (name: string): RefDecoration => ({ kind: 'localBranch', name, isHead: false });
const remote = (name: string): RefDecoration => ({ kind: 'remoteBranch', name, isHead: false, remote: 'origin' });
const onMain = { oid: 'b'.repeat(40), head: 'main', detached: false };
const none = new Map<string, WorktreeEntry>();

describe('new command specs', () => {
  const cases: [CommandId, CommandContext, string[]][] = [
    ['commit.checkout', { commitish: 'abc' }, ['switch', '--detach', 'abc']],
    ['branch.checkout', { branch: 'origin/x', track: true }, ['switch', '--track', 'origin/x']],
    ['rebase', { commitish: 'main', autostash: true }, ['rebase', '--autostash', 'main']],
    ['cherryPick', { commitish: 'abc', recordOrigin: true, mainline: 1 }, ['cherry-pick', '-x', '-m', '1', 'abc']],
    ['revert', { commitish: 'abc', noCommit: true }, ['revert', '--no-edit', '--no-commit', 'abc']],
    ['reset', { commitish: 'abc', resetMode: 'hard' }, ['reset', '--hard', 'abc']],
    ['archive', { commitish: 'abc', outputPath: 'C:/a b/x.zip' }, ['archive', '--format=zip', '-o', 'C:/a b/x.zip', 'abc']],
    ['formatPatch', { commitish: 'abc', outputPath: 'C:/a b/x.patch' }, ['format-patch', '-1', '--output=C:/a b/x.patch', 'abc']],
    ['tag.create', { tagName: 'v1', commitish: 'abc' }, ['tag', 'v1', 'abc']],
    ['branch.create', { branch: '', startPoint: 'abc' }, ['branch', '<name>', 'abc']],
  ];
  it.each(cases)('%s builds and round-trips through the editable text', (id, ctx, argv) => {
    expect(COMMANDS[id].build(ctx)).toEqual(argv);
    expect(tokenize(renderCommand(COMMANDS[id], ctx))).toEqual(argv);
  });

  it('only reset --hard asks for confirmation', () => {
    expect(isDestructive(COMMANDS.reset, ['reset', '--mixed', 'x'])).toBe(false);
    expect(isDestructive(COMMANDS.reset, ['reset', '--hard', 'x'])).toBe(true);
  });

  it('names files', () => {
    expect(archiveFormatFor('x.TAR.GZ')).toBe('tar.gz');
    expect(archiveFormatFor('x.tar')).toBe('tar');
    expect(archiveFormatFor('x.zip')).toBe('zip');
    expect(patchFileName('Fix: the thing!')).toBe('0001-fix-the-thing.patch');
  });
});

describe('double-click on a commit', () => {
  it('switches to its one local branch', () => {
    expect(checkoutPlan(commit([local('feature')]), onMain, none)).toEqual({ kind: 'switch', branch: 'feature' });
  });
  it('offers the worktree of a held branch', () => {
    const entry = { path: 'C:/wt' } as WorktreeEntry;
    expect(checkoutPlan(commit([local('feature')]), onMain, new Map([['feature', entry]]))).toMatchObject({ kind: 'held', entry });
  });
  it('asks which when several branches point here', () => {
    expect(checkoutPlan(commit([local('a'), local('b')]), onMain, none)).toEqual({ kind: 'choose' });
  });
  it('does nothing on the current branch', () => {
    expect(checkoutPlan(commit([local('main')]), onMain, none).kind).toBe('none');
  });
  it('reviews a tracking checkout of a remote branch', () => {
    expect(checkoutPlan(commit([remote('origin/x'), remote('origin/HEAD')]), onMain, none)).toEqual({
      kind: 'command', id: 'branch.checkout', context: { branch: 'origin/x', track: true },
    });
  });
  it('reviews a detached checkout of a bare commit', () => {
    expect(checkoutPlan(commit(), onMain, none)).toMatchObject({ kind: 'command', id: 'commit.checkout' });
  });
});

describe('commit menu', () => {
  const labels = (c: Commit, head = onMain) => commitMenu(c, head, none).filter((e) => !e.separator);
  it('has every action', () => {
    const names = labels(commit([local('feature')])).map((e) => e.label);
    expect(names).toEqual([
      'Check Out feature', 'Check Out This Commit (Detached)…', 'Merge feature into main…', 'Rebase main onto feature…',
      'New Branch Here…', 'New Tag Here…', 'Cherry-pick onto main…', 'Reverse Commit…', 'Reset main to This Commit…',
      'Archive…', 'Create Patch…', 'Copy SHA', 'Copy Short SHA',
    ]);
  });
  it('disables what cannot apply to the HEAD commit and to merges', () => {
    const head = { ...onMain, oid: 'a'.repeat(40) };
    const byLabel = Object.fromEntries(labels(commit([], ['p1', 'p2']), head).map((e) => [e.label, e]));
    expect(byLabel['Merge aaaaaaa into main…']!.disabled).toBeDefined();
    expect(byLabel['Cherry-pick onto main…']!.disabled).toBeDefined();
    expect(byLabel['Create Patch…']!.disabled).toBeDefined();
    expect(byLabel['Reverse Commit…']!.action).toMatchObject({ context: { mainline: 1 } });
  });
});

describe.skipIf(!hasGit())('commit actions against real git', () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true' },
    }).toString().trim();
  const run = (id: CommandId, ctx: CommandContext) => git(...COMMANDS[id].build(ctx));
  const commitFile = (name: string, text: string) => {
    writeFileSync(path.join(dir, name), text);
    git('add', name);
    git('commit', '-q', '-m', `add ${name}`);
    return git('rev-parse', 'HEAD');
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gt-commit-'));
    git('init', '-q', '-b', 'main');
    commitFile('a.txt', 'a');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('runs every new command', () => {
    const base = git('rev-parse', 'HEAD');
    run('branch.create', { branch: 'side', startPoint: base });
    git('switch', '-q', 'side');
    const pick = commitFile('b.txt', 'b');
    git('switch', '-q', 'main');
    const mainTip = commitFile('c.txt', 'c');

    run('cherryPick', { commitish: pick, recordOrigin: true });
    expect(existsSync(path.join(dir, 'b.txt'))).toBe(true);
    expect(git('log', '-1', '--format=%B')).toContain(`cherry picked from commit ${pick}`);

    run('revert', { commitish: 'HEAD' });
    expect(existsSync(path.join(dir, 'b.txt'))).toBe(false);

    run('tag.create', { tagName: 'v1', commitish: base });
    expect(git('rev-parse', 'v1')).toBe(base);

    const out = mkdtempSync(path.join(tmpdir(), 'gt out '));
    run('archive', { commitish: mainTip, outputPath: path.join(out, 'x.zip'), archiveFormat: 'zip' });
    expect(existsSync(path.join(out, 'x.zip'))).toBe(true);
    run('formatPatch', { commitish: pick, outputPath: path.join(out, 'x.patch') });
    expect(readFileSync(path.join(out, 'x.patch'), 'utf8')).toContain('add b.txt');
    rmSync(out, { recursive: true, force: true });

    run('reset', { commitish: mainTip, resetMode: 'hard' });
    expect(git('rev-parse', 'HEAD')).toBe(mainTip);

    git('switch', '-q', 'side');
    run('rebase', { commitish: 'main' });
    expect(git('merge-base', '--is-ancestor', mainTip, 'HEAD') === '').toBe(true);

    run('commit.checkout', { commitish: base });
    expect(git('rev-parse', 'HEAD')).toBe(base);
    expect(git('branch', '--show-current')).toBe('');
  });
});
