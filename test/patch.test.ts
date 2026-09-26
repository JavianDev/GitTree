import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDiff } from '../src/extension/git/parsers/diff';
import { buildHunkPatch, buildLinePatch, renderHunk } from '../src/extension/git/patch';
import type { DiffFile, DiffLine } from '../src/shared/model';
import { hasGit } from './fixtures/make-workspace';

const line = (kind: DiffLine['kind'], text: string, oldNo?: number, newNo?: number): DiffLine => ({
  kind,
  text,
  oldNo,
  newNo,
});

describe('renderHunk — header arithmetic', () => {
  it('derives counts from the lines that survive, not the original header', () => {
    const header = renderHunk(
      [line('context', 'a', 1, 1), line('delete', 'b', 2), line('add', 'B', undefined, 2)],
      1,
      1,
    ).split('\n')[0];

    expect(header).toBe('@@ -1,2 +1,2 @@');
  });

  it('writes a single-line side without a count', () => {
    const header = renderHunk([line('delete', 'only', 5)], 5, 5).split('\n')[0];
    expect(header).toBe('@@ -5 +4,0 @@');
  });

  it('writes an empty side as ",0" anchored to the preceding line', () => {
    const header = renderHunk([line('add', 'new', undefined, 3)], 3, 3).split('\n')[0];
    expect(header).toBe('@@ -2,0 +3 @@');
  });

  it('re-emits the no-newline marker after its line', () => {
    const rendered = renderHunk([{ kind: 'add', text: 'x', noNewline: true }], 1, 1);
    expect(rendered).toContain('+x\n\\ No newline at end of file');
  });
});

describe('buildLinePatch — unselected line handling', () => {
  const file: DiffFile = {
    path: 'f.txt',
    oldPath: 'f.txt',
    status: 'modified',
    binary: false,
    additions: 2,
    deletions: 1,
    hunks: [
      {
        header: '@@ -1,2 +1,3 @@',
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [
          line('context', 'keep', 1, 1),
          line('delete', 'gone', 2),
          line('add', 'first', undefined, 2),
          line('add', 'second', undefined, 3),
        ],
      },
    ],
  };

  it('staging drops unselected additions and keeps unselected deletions as context', () => {
    // Selecting only the 'first' addition (index 2).
    const patch = buildLinePatch(file, [{ hunkIndex: 0, lineIndices: [2] }], false);

    expect(patch).toContain('+first');
    expect(patch).not.toContain('+second');
    // The unselected deletion is still present in the index, so it must be
    // carried as context rather than dropped.
    expect(patch).toContain(' gone');
    expect(patch).not.toContain('-gone');
  });

  it('unstaging keeps unselected additions as context and drops unselected deletions', () => {
    const patch = buildLinePatch(file, [{ hunkIndex: 0, lineIndices: [2] }], true);

    expect(patch).toContain('+first');
    // Inverted relative to staging: 'second' is already staged, so it is
    // context; 'gone' is absent from the staged content, so it disappears.
    expect(patch).toContain(' second');
    expect(patch).not.toContain(' gone');
  });

  it('produces nothing when the selection leaves only context', () => {
    expect(buildLinePatch(file, [{ hunkIndex: 0, lineIndices: [] }], false)).toBe('');
  });

  it('emits a well-formed file header', () => {
    const patch = buildLinePatch(file, [{ hunkIndex: 0, lineIndices: [2] }], false);
    expect(patch.startsWith('diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@')).toBe(true);
    expect(patch.endsWith('\n')).toBe(true);
  });
});

describe('buildHunkPatch', () => {
  const twoHunks: DiffFile = {
    path: 'f.txt',
    oldPath: 'f.txt',
    status: 'modified',
    binary: false,
    additions: 2,
    deletions: 0,
    hunks: [
      {
        header: '@@ -1,1 +1,2 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [line('context', 'a', 1, 1), line('add', 'A', undefined, 2)],
      },
      {
        header: '@@ -20,1 +21,2 @@',
        oldStart: 20,
        oldLines: 1,
        newStart: 21,
        newLines: 2,
        lines: [line('context', 'z', 20, 21), line('add', 'Z', undefined, 22)],
      },
    ],
  };

  it('includes only the requested hunks', () => {
    const patch = buildHunkPatch(twoHunks, [1]);
    expect(patch).toContain('+Z');
    expect(patch).not.toContain('+A');
  });

  it('offsets later hunks by the net change of earlier ones', () => {
    const patch = buildHunkPatch(twoHunks, [0, 1]);
    const headers = patch.split('\n').filter((l) => l.startsWith('@@'));

    expect(headers[0]).toBe('@@ -1 +1,2 @@');
    // The first hunk added a line, so the second hunk's post-image start moves
    // from 20 to 21.
    expect(headers[1]).toBe('@@ -20 +21,2 @@');
  });

  it('returns nothing when no hunks are selected', () => {
    expect(buildHunkPatch(twoHunks, [])).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end: the patches must survive real git                              */
/* -------------------------------------------------------------------------- */

const IDENTITY = ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false'];

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gittree-patch-'));
  execFileSync('git', [...IDENTITY, 'init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function git(dir: string, args: string[], stdin?: string): string {
  return execFileSync('git', [...IDENTITY, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input: stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe.skipIf(!hasGit())('patches applied by real git', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = undefined;
  });

  it('stages exactly the selected line and nothing else', () => {
    dir = makeRepo();
    const file = path.join(dir, 'f.txt');

    writeFileSync(file, 'a\nb\nc\n', 'utf8');
    git(dir, ['add', 'f.txt']);
    git(dir, ['commit', '-m', 'base']);

    // Two additions between 'a' and 'b'; only the first is selected.
    writeFileSync(file, 'a\nX\nY\nb\nc\n', 'utf8');

    const parsed = parseDiff(git(dir, ['diff', '--no-color', '-U3', '--', 'f.txt']));
    const target = parsed[0]!;
    const addIndices = target.hunks[0]!.lines
      .map((l, i) => (l.kind === 'add' ? i : -1))
      .filter((i) => i >= 0);

    const patch = buildLinePatch(target, [{ hunkIndex: 0, lineIndices: [addIndices[0]!] }], false);

    // `--check` first: a rejected patch here means the arithmetic is wrong.
    git(dir, ['apply', '--cached', '--check', '--unidiff-zero', '-'], patch);
    git(dir, ['apply', '--cached', '--unidiff-zero', '-'], patch);

    expect(git(dir, ['show', ':f.txt'])).toBe('a\nX\nb\nc\n');
    // The unselected addition stays in the worktree, unstaged.
    expect(git(dir, ['diff', '--name-only'])).toContain('f.txt');
  });

  it('stages a selected deletion while leaving another deletion alone', () => {
    dir = makeRepo();
    const file = path.join(dir, 'f.txt');

    writeFileSync(file, 'keep\ndrop1\ndrop2\ntail\n', 'utf8');
    git(dir, ['add', 'f.txt']);
    git(dir, ['commit', '-m', 'base']);

    writeFileSync(file, 'keep\ntail\n', 'utf8');

    const target = parseDiff(git(dir, ['diff', '--no-color', '-U3', '--', 'f.txt']))[0]!;
    const deleteIndices = target.hunks[0]!.lines
      .map((l, i) => (l.kind === 'delete' ? i : -1))
      .filter((i) => i >= 0);

    const patch = buildLinePatch(target, [{ hunkIndex: 0, lineIndices: [deleteIndices[0]!] }], false);
    git(dir, ['apply', '--cached', '--check', '--unidiff-zero', '-'], patch);
    git(dir, ['apply', '--cached', '--unidiff-zero', '-'], patch);

    expect(git(dir, ['show', ':f.txt'])).toBe('keep\ndrop2\ntail\n');
  });

  it('unstages exactly the selected line', () => {
    dir = makeRepo();
    const file = path.join(dir, 'f.txt');

    writeFileSync(file, 'a\nb\n', 'utf8');
    git(dir, ['add', 'f.txt']);
    git(dir, ['commit', '-m', 'base']);

    writeFileSync(file, 'a\nX\nY\nb\n', 'utf8');
    git(dir, ['add', 'f.txt']);

    // Diff HEAD against the index — the side --reverse validates against.
    const target = parseDiff(git(dir, ['diff', '--cached', '--no-color', '-U3', '--', 'f.txt']))[0]!;
    const addIndices = target.hunks[0]!.lines
      .map((l, i) => (l.kind === 'add' ? i : -1))
      .filter((i) => i >= 0);

    const patch = buildLinePatch(target, [{ hunkIndex: 0, lineIndices: [addIndices[0]!] }], true);
    git(dir, ['apply', '--cached', '--reverse', '--check', '--unidiff-zero', '-'], patch);
    git(dir, ['apply', '--cached', '--reverse', '--unidiff-zero', '-'], patch);

    // 'X' came back out of the index; 'Y' stayed staged.
    expect(git(dir, ['show', ':f.txt'])).toBe('a\nY\nb\n');
  });

  it('stages one hunk out of two', () => {
    dir = makeRepo();
    const file = path.join(dir, 'f.txt');

    const original = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    writeFileSync(file, original, 'utf8');
    git(dir, ['add', 'f.txt']);
    git(dir, ['commit', '-m', 'base']);

    const edited = original.replace('line2\n', 'line2-edited\n').replace('line28\n', 'line28-edited\n');
    writeFileSync(file, edited, 'utf8');

    const target = parseDiff(git(dir, ['diff', '--no-color', '-U3', '--', 'f.txt']))[0]!;
    expect(target.hunks.length).toBe(2);

    const patch = buildHunkPatch(target, [0]);
    git(dir, ['apply', '--cached', '--check', '-'], patch);
    git(dir, ['apply', '--cached', '-'], patch);

    const staged = git(dir, ['show', ':f.txt']);
    expect(staged).toContain('line2-edited');
    expect(staged).toContain('line28');
    expect(staged).not.toContain('line28-edited');
  });
});
