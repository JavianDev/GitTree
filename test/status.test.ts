import { describe, expect, it } from 'vitest';
import { parseStatus } from '../src/extension/git/parsers/status';

const H1 = '1111111111111111111111111111111111111111';
const H2 = '2222222222222222222222222222222222222222';
const H3 = '3333333333333333333333333333333333333333';
const ZERO = '0'.repeat(40);

/** An ordinary `1` record with the given XY code and path. */
const ordinary = (xy: string, path: string, sub = 'N...') =>
  `1 ${xy} ${sub} 100644 100644 100644 ${H1} ${H2} ${path}`;

describe('parseStatus — branch headers', () => {
  it('reads oid, head, upstream and ahead/behind', () => {
    const { branch } = parseStatus([
      `# branch.oid ${H1}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +3 -2',
    ]);

    expect(branch).toEqual({
      oid: H1,
      head: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 3,
      behind: 2,
    });
  });

  it('treats (initial) as an unborn branch with no oid', () => {
    const { branch } = parseStatus(['# branch.oid (initial)', '# branch.head main']);
    expect(branch.oid).toBeUndefined();
    expect(branch.head).toBe('main');
  });

  it('flags a detached HEAD and leaves the branch name unset', () => {
    const { branch } = parseStatus([`# branch.oid ${H1}`, '# branch.head (detached)']);
    expect(branch.detached).toBe(true);
    expect(branch.head).toBeUndefined();
  });

  it('defaults ahead/behind to zero with no upstream', () => {
    const { branch } = parseStatus(['# branch.head main']);
    expect(branch).toMatchObject({ ahead: 0, behind: 0 });
    expect(branch.upstream).toBeUndefined();
  });
});

describe('parseStatus — ordinary entries', () => {
  it('separates staged from unstaged positions', () => {
    const { files } = parseStatus([
      ordinary('M.', 'staged-only.ts'),
      ordinary('.M', 'unstaged-only.ts'),
      ordinary('MM', 'both.ts'),
    ]);

    expect(files.map((f) => [f.path, f.staged, f.unstaged])).toEqual([
      ['staged-only.ts', true, false],
      ['unstaged-only.ts', false, true],
      ['both.ts', true, true],
    ]);
  });

  it('maps XY codes to a primary change kind, index position winning', () => {
    const { files } = parseStatus([
      ordinary('A.', 'added.ts'),
      ordinary('D.', 'deleted.ts'),
      ordinary('T.', 'typechanged.ts'),
      ordinary('AM', 'added-then-edited.ts'),
    ]);

    expect(files.map((f) => f.kind)).toEqual(['added', 'deleted', 'typechange', 'added']);
  });

  it('keeps paths containing spaces intact', () => {
    const { files } = parseStatus([ordinary('.M', 'src/my folder/some file.ts')]);
    expect(files[0]?.path).toBe('src/my folder/some file.ts');
  });

  it('keeps non-ASCII paths intact', () => {
    const { files } = parseStatus([ordinary('.M', 'src/日本語/café.ts')]);
    expect(files[0]?.path).toBe('src/日本語/café.ts');
  });

  it('parses submodule state from the S field', () => {
    const { files } = parseStatus([ordinary('.M', 'vendor/lib', 'SCMU')]);
    expect(files[0]?.submodule).toEqual({
      commitChanged: true,
      hasModifiedTracked: true,
      hasUntracked: true,
    });
  });

  it('leaves submodule unset for ordinary files', () => {
    const { files } = parseStatus([ordinary('.M', 'src/app.ts')]);
    expect(files[0]?.submodule).toBeUndefined();
  });
});

describe('parseStatus — renames under -z', () => {
  // Under -z the original path is NOT tab-separated inside the record: it
  // arrives as the next NUL-terminated field. A parser that misses this reads
  // the original path as a bogus entry and every later record shifts by one.
  it('consumes the following field as the rename source', () => {
    const { files } = parseStatus([
      `2 R. N... 100644 100644 100644 ${H1} ${H2} R100 new/name.ts`,
      'old/name.ts',
    ]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'new/name.ts',
      origPath: 'old/name.ts',
      kind: 'renamed',
      score: 100,
      staged: true,
    });
  });

  it('does not shift subsequent records', () => {
    const { files } = parseStatus([
      `2 R. N... 100644 100644 100644 ${H1} ${H2} R087 new/name.ts`,
      'old/name.ts',
      ordinary('.M', 'after-the-rename.ts'),
    ]);

    expect(files.map((f) => f.path)).toEqual(['new/name.ts', 'after-the-rename.ts']);
    expect(files[0]?.score).toBe(87);
  });

  it('distinguishes a copy from a rename', () => {
    const { files } = parseStatus([
      `2 C. N... 100644 100644 100644 ${H1} ${H2} C075 copy.ts`,
      'source.ts',
    ]);

    expect(files[0]).toMatchObject({ kind: 'copied', origPath: 'source.ts', score: 75 });
  });

  it('handles a rename where both paths contain spaces', () => {
    const { files } = parseStatus([
      `2 R. N... 100644 100644 100644 ${H1} ${H2} R100 new dir/new name.ts`,
      'old dir/old name.ts',
    ]);

    expect(files[0]).toMatchObject({
      path: 'new dir/new name.ts',
      origPath: 'old dir/old name.ts',
    });
  });
});

describe('parseStatus — unmerged entries', () => {
  it('surfaces all three merge stages', () => {
    const { files } = parseStatus([
      `u UU N... 100644 100644 100644 100644 ${H1} ${H2} ${H3} conflict.txt`,
    ]);

    expect(files[0]).toMatchObject({
      path: 'conflict.txt',
      kind: 'conflicted',
      conflicted: true,
    });
    expect(files[0]?.conflict).toEqual({
      code: 'UU',
      base: { mode: '100644', oid: H1 },
      ours: { mode: '100644', oid: H2 },
      theirs: { mode: '100644', oid: H3 },
    });
  });

  it('omits a stage whose mode is 000000', () => {
    // add/add: both sides created the file, so there is no merge base. A
    // resolver that assumes stage 1 exists crashes on exactly the conflicts
    // users most need help with.
    const { files } = parseStatus([
      `u AA N... 000000 100644 100644 100644 ${ZERO} ${H2} ${H3} both-added.txt`,
    ]);

    expect(files[0]?.conflict?.base).toBeUndefined();
    expect(files[0]?.conflict?.ours).toEqual({ mode: '100644', oid: H2 });
    expect(files[0]?.conflict?.theirs).toEqual({ mode: '100644', oid: H3 });
    expect(files[0]?.conflict?.code).toBe('AA');
  });

  it('never reports a conflicted file as staged', () => {
    const { files } = parseStatus([
      `u DU N... 100644 000000 100644 100644 ${H1} ${ZERO} ${H3} gone.txt`,
    ]);

    expect(files[0]?.staged).toBe(false);
    expect(files[0]?.unstaged).toBe(true);
  });
});

describe('parseStatus — untracked and ignored', () => {
  it('marks untracked as unstaged and ignored as neither', () => {
    const { files } = parseStatus(['? new.ts', '! dist/bundle.js']);

    expect(files[0]).toMatchObject({
      path: 'new.ts',
      kind: 'untracked',
      unstaged: true,
      staged: false,
    });
    expect(files[1]).toMatchObject({
      path: 'dist/bundle.js',
      kind: 'ignored',
      unstaged: false,
      staged: false,
    });
  });

  it('keeps spaces in untracked paths', () => {
    const { files } = parseStatus(['? some dir/some file.txt']);
    expect(files[0]?.path).toBe('some dir/some file.txt');
  });
});

describe('parseStatus — resilience', () => {
  it('returns an empty result for empty input', () => {
    expect(parseStatus([])).toEqual({
      branch: { detached: false, ahead: 0, behind: 0 },
      files: [],
    });
  });

  it('skips blank and unknown records rather than aborting', () => {
    const { files } = parseStatus([
      '',
      ordinary('.M', 'a.ts'),
      'z something new',
      ordinary('.M', 'b.ts'),
    ]);
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores a truncated record', () => {
    const { files } = parseStatus(['1 .M N... 100644', ordinary('.M', 'ok.ts')]);
    expect(files.map((f) => f.path)).toEqual(['ok.ts']);
  });
});
