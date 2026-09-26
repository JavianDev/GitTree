import { describe, expect, it } from 'vitest';
import { NUMSTAT_ARGS, numstatArgs, parseNumstat } from '../src/extension/git/parsers/numstat';
import { NUL } from '../src/extension/git/separators';

/** One ordinary `-z` record: counts, then path, NUL-terminated. */
const record = (added: string, deleted: string, path: string) =>
  `${added}\t${deleted}\t${path}${NUL}`;

/**
 * A rename record: the path field inside the record is empty, and the source
 * and destination follow as two further NUL-terminated fields.
 */
const renamed = (added: string, deleted: string, from: string, to: string) =>
  `${added}\t${deleted}\t${NUL}${from}${NUL}${to}${NUL}`;

describe('numstatArgs', () => {
  it('counts the working tree by default', () => {
    expect(numstatArgs()).toEqual([...NUMSTAT_ARGS]);
    expect(numstatArgs()).not.toContain('--cached');
  });

  it('counts the index against HEAD when staged', () => {
    expect(numstatArgs({ staged: true })).toContain('--cached');
  });

  it('separates paths from options with --', () => {
    // `main` is both a plausible file name and a branch name; without the
    // separator git resolves it as the branch.
    expect(numstatArgs({ paths: ['src/app.ts', 'main'] }).slice(-3)).toEqual([
      '--',
      'src/app.ts',
      'main',
    ]);
  });

  it('omits -- when no paths are given', () => {
    expect(numstatArgs({ staged: true })).not.toContain('--');
  });
});

describe('parseNumstat — ordinary records', () => {
  it('reads added and deleted counts per file', () => {
    const stats = parseNumstat(record('12', '3', 'src/app.ts') + record('0', '7', 'src/util.ts'));

    expect(stats).toEqual([
      { path: 'src/app.ts', added: 12, deleted: 3, binary: false },
      { path: 'src/util.ts', added: 0, deleted: 7, binary: false },
    ]);
  });

  it('keeps paths containing spaces intact', () => {
    const stats = parseNumstat(record('1', '1', 'src/my folder/some file.ts'));
    expect(stats[0]?.path).toBe('src/my folder/some file.ts');
  });

  it('keeps non-ASCII paths intact', () => {
    const stats = parseNumstat(record('4', '0', 'src/日本語/café.ts'));
    expect(stats[0]?.path).toBe('src/日本語/café.ts');
  });

  it('reports a mode-only change as zero and zero rather than as binary', () => {
    expect(parseNumstat(record('0', '0', 'script.sh'))[0]).toEqual({
      path: 'script.sh',
      added: 0,
      deleted: 0,
      binary: false,
    });
  });

  it('leaves oldPath unset when nothing was renamed', () => {
    expect(parseNumstat(record('1', '0', 'src/app.ts'))[0]?.oldPath).toBeUndefined();
  });
});

describe('parseNumstat — binary files', () => {
  // Git reports `-` for both counts. `Number('-')` is NaN, and one NaN in the
  // list poisons every total summed from it, which is the review pane header.
  it('reports - counts as binary with zero counts', () => {
    expect(parseNumstat(record('-', '-', 'assets/logo.png'))[0]).toEqual({
      path: 'assets/logo.png',
      added: 0,
      deleted: 0,
      binary: true,
    });
  });

  it('never produces NaN, so a total over a mixed list stays finite', () => {
    const stats = parseNumstat(
      record('10', '2', 'src/app.ts') +
        record('-', '-', 'assets/logo.png') +
        record('5', '1', 'src/util.ts'),
    );

    const added = stats.reduce((sum, file) => sum + file.added, 0);
    const deleted = stats.reduce((sum, file) => sum + file.deleted, 0);

    expect([added, deleted]).toEqual([15, 3]);
  });

  it('marks a binary rename as binary and keeps both paths', () => {
    expect(parseNumstat(renamed('-', '-', 'old/logo.png', 'new/logo.png'))[0]).toEqual({
      path: 'new/logo.png',
      oldPath: 'old/logo.png',
      added: 0,
      deleted: 0,
      binary: true,
    });
  });
});

describe('parseNumstat — renames under -z', () => {
  // The record ends after the counts; the two paths arrive as their own fields.
  // A parser that misses this reads them as bogus entries and shifts every
  // record after them, exactly as a porcelain v2 rename does in status.
  it('consumes the following two fields as source and destination', () => {
    const stats = parseNumstat(renamed('3', '1', 'old/name.ts', 'new/name.ts'));

    expect(stats).toHaveLength(1);
    expect(stats[0]).toEqual({
      path: 'new/name.ts',
      oldPath: 'old/name.ts',
      added: 3,
      deleted: 1,
      binary: false,
    });
  });

  it('does not shift the records that follow it', () => {
    const stats = parseNumstat(
      renamed('3', '1', 'old/name.ts', 'new/name.ts') + record('9', '4', 'after.ts'),
    );

    expect(stats.map((file) => file.path)).toEqual(['new/name.ts', 'after.ts']);
    expect(stats[1]).toMatchObject({ added: 9, deleted: 4 });
  });

  it('handles a rename where both paths contain spaces', () => {
    const stats = parseNumstat(renamed('0', '0', 'old dir/old name.ts', 'new dir/new name.ts'));

    expect(stats[0]).toMatchObject({
      path: 'new dir/new name.ts',
      oldPath: 'old dir/old name.ts',
    });
  });

  it('handles consecutive renames', () => {
    const stats = parseNumstat(
      renamed('1', '1', 'a.ts', 'b.ts') + renamed('2', '2', 'c.ts', 'd.ts'),
    );

    expect(stats.map((file) => [file.oldPath, file.path])).toEqual([
      ['a.ts', 'b.ts'],
      ['c.ts', 'd.ts'],
    ]);
  });
});

describe('parseNumstat — resilience', () => {
  it('returns nothing for empty output', () => {
    expect(parseNumstat('')).toEqual([]);
  });

  it('returns nothing for output that is only a terminator', () => {
    expect(parseNumstat(NUL)).toEqual([]);
  });

  it('skips a record with no count fields rather than throwing', () => {
    const stats = parseNumstat(
      record('1', '2', 'a.ts') + `garbage${NUL}` + record('3', '4', 'b.ts'),
    );

    expect(stats.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('skips a record whose counts are not numbers', () => {
    const stats = parseNumstat(
      record('1', '2', 'a.ts') + record('x', '2', 'bad.ts') + record('3', '4', 'b.ts'),
    );

    expect(stats.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('drops a rename whose destination never arrived', () => {
    // Output cut short mid-rename: counts and a source path, nothing after it.
    expect(parseNumstat(`0\t0\t${NUL}old/name.ts`)).toEqual([]);
  });

  it('drops a rename with unreadable counts without emitting its paths as files', () => {
    const stats = parseNumstat(
      `x\ty\t${NUL}old.ts${NUL}new.ts${NUL}` + record('5', '5', 'after.ts'),
    );

    expect(stats.map((file) => file.path)).toEqual(['after.ts']);
  });
});
