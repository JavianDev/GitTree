import { describe, expect, it } from 'vitest';
import { parseDiff, unquotePath } from '../src/extension/git/parsers/diff';

const MODIFIED = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@ export function main()',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
  '',
].join('\n');

describe('parseDiff — hunks and line numbers', () => {
  it('parses a single modified file', () => {
    const files = parseDiff(MODIFIED);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'src/app.ts',
      oldPath: 'src/app.ts',
      status: 'modified',
      binary: false,
      additions: 2,
      deletions: 1,
    });
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('keeps the hunk header verbatim, including the section heading', () => {
    const hunk = parseDiff(MODIFIED)[0]?.hunks[0];
    expect(hunk?.header).toBe('@@ -1,4 +1,5 @@ export function main()');
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 });
  });

  it('numbers context, added and deleted lines independently', () => {
    const lines = parseDiff(MODIFIED)[0]?.hunks[0]?.lines ?? [];

    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['delete', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
    ]);
  });

  it('defaults an omitted hunk count to 1', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]?.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 });
  });

  it('parses multiple hunks in one file', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      '-a',
      '+A',
      ' b',
      '@@ -10,2 +10,2 @@',
      '-c',
      '+C',
      ' d',
      '',
    ].join('\n');

    const file = parseDiff(patch)[0];
    expect(file?.hunks).toHaveLength(2);
    expect(file?.hunks[1]?.oldStart).toBe(10);
    expect(file).toMatchObject({ additions: 2, deletions: 2 });
  });

  it('parses multiple files in one patch', () => {
    const files = parseDiff(MODIFIED + MODIFIED.replace(/app\.ts/g, 'other.ts'));
    expect(files.map((f) => f.path)).toEqual(['src/app.ts', 'src/other.ts']);
  });
});

describe('parseDiff — file status', () => {
  it('detects an added file and fills the path from the + side', () => {
    const patch = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+line one',
      '+line two',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({
      path: 'new.ts',
      oldPath: 'new.ts',
      status: 'added',
      newMode: '100644',
      additions: 2,
      deletions: 0,
    });
  });

  it('detects a deleted file and fills the path from the - side', () => {
    const patch = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line one',
      '-line two',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({
      path: 'gone.ts',
      oldPath: 'gone.ts',
      status: 'deleted',
      oldMode: '100644',
      deletions: 2,
    });
  });

  it('reads rename paths from the rename lines, not the diff --git header', () => {
    // The `diff --git a/x b/y` header is ambiguous when paths contain spaces;
    // `rename from` / `rename to` carry exactly one path each.
    const patch = [
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 92%',
      'rename from old name.ts',
      'rename to new name.ts',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({
      status: 'renamed',
      oldPath: 'old name.ts',
      path: 'new name.ts',
      score: 92,
    });
  });

  it('detects a copy', () => {
    const patch = [
      'diff --git a/src.ts b/dst.ts',
      'similarity index 100%',
      'copy from src.ts',
      'copy to dst.ts',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({ status: 'copied', oldPath: 'src.ts', path: 'dst.ts' });
  });

  it('flags binary files and produces no hunks', () => {
    const patch = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({ path: 'logo.png', binary: true });
    expect(parseDiff(patch)[0]?.hunks).toEqual([]);
  });

  it('records a mode change as a typechange', () => {
    const patch = [
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({
      status: 'typechange',
      path: 'run.sh',
      oldMode: '100644',
      newMode: '100755',
    });
  });
});

describe('parseDiff — paths recovered from the diff --git header', () => {
  // Binary diffs and pure mode changes emit no ---/+++ lines, so the header is
  // the only place the path appears.
  it('recovers a plain path', () => {
    const files = parseDiff('diff --git a/src/app.ts b/src/app.ts\nBinary files differ\n');
    expect(files[0]).toMatchObject({ path: 'src/app.ts', oldPath: 'src/app.ts' });
  });

  it('recovers a path containing spaces by using the equal-paths form', () => {
    const files = parseDiff('diff --git a/my dir/my file.png b/my dir/my file.png\nBinary files differ\n');
    expect(files[0]).toMatchObject({ path: 'my dir/my file.png', oldPath: 'my dir/my file.png' });
  });

  it('recovers a path that itself contains " b/"', () => {
    const path = 'src/a b/c.png';
    const files = parseDiff(`diff --git a/${path} b/${path}\nBinary files differ\n`);
    expect(files[0]?.path).toBe(path);
  });

  it('is overridden by the unambiguous rename lines when paths differ', () => {
    const patch = [
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 92%',
      'rename from old name.ts',
      'rename to new name.ts',
      '',
    ].join('\n');

    expect(parseDiff(patch)[0]).toMatchObject({
      oldPath: 'old name.ts',
      path: 'new name.ts',
    });
  });
});

describe('parseDiff — edge cases', () => {
  it('marks the preceding line when the file has no trailing newline', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    const lines = parseDiff(patch)[0]?.hunks[0]?.lines ?? [];
    expect(lines[0]).toMatchObject({ kind: 'delete', noNewline: true });
    expect(lines[1]).toMatchObject({ kind: 'add', noNewline: true });
  });

  it('treats a removed line that looks like a diff header as content', () => {
    // Source code can legitimately contain "diff --git" or "index ".
    const patch = [
      'diff --git a/doc.md b/doc.md',
      '--- a/doc.md',
      '+++ b/doc.md',
      '@@ -1,3 +1,3 @@',
      ' Example:',
      '-diff --git a/foo b/foo',
      '+index 1234567..89abcde 100644',
      '',
    ].join('\n');

    const files = parseDiff(patch);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines.map((l) => l.text)).toEqual([
      'Example:',
      'diff --git a/foo b/foo',
      'index 1234567..89abcde 100644',
    ]);
  });

  it('preserves a carriage return as content rather than a line terminator', () => {
    const patch = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-old\r', '+new\r', ''].join('\n');
    const lines = parseDiff(patch)[0]?.hunks[0]?.lines ?? [];
    expect(lines[0]?.text).toBe('old\r');
    expect(lines[1]?.text).toBe('new\r');
  });

  it('keeps non-ASCII paths intact', () => {
    const patch = ['diff --git a/日本語.ts b/日本語.ts', '--- a/日本語.ts', '+++ b/日本語.ts', ''].join('\n');
    expect(parseDiff(patch)[0]?.path).toBe('日本語.ts');
  });

  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

describe('unquotePath', () => {
  it('leaves an unquoted path alone', () => {
    expect(unquotePath('src/app.ts')).toBe('src/app.ts');
  });

  it('unquotes escaped control characters', () => {
    expect(unquotePath('"tab\\there"')).toBe('tab\there');
    expect(unquotePath('"line\\nbreak"')).toBe('line\nbreak');
  });

  it('unquotes escaped quotes and backslashes', () => {
    expect(unquotePath('"say \\"hi\\""')).toBe('say "hi"');
    expect(unquotePath('"back\\\\slash"')).toBe('back\\slash');
  });

  it('decodes octal byte escapes', () => {
    expect(unquotePath('"\\101\\102"')).toBe('AB');
  });
});
