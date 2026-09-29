import { describe, expect, it } from 'vitest';
import { MAX_UNTRACKED_LINES, synthesizeAddedFile } from '../src/extension/git/untrackedDiff';

describe('synthesizeAddedFile', () => {
  it('shows every line of a new file as added, numbered from 1', () => {
    const file = synthesizeAddedFile('src/new.ts', Buffer.from('const a = 1;\nconst b = 2;\n'));

    expect(file).toMatchObject({ path: 'src/new.ts', oldPath: 'src/new.ts', status: 'added', binary: false });
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]?.header).toBe('@@ -0,0 +1,2 @@');
    expect(file.hunks[0]?.lines).toEqual([
      { kind: 'add', newNo: 1, text: 'const a = 1;' },
      { kind: 'add', newNo: 2, text: 'const b = 2;' },
    ]);
  });

  it('strips CRLF line endings so Windows files read cleanly', () => {
    const file = synthesizeAddedFile('a.txt', Buffer.from('one\r\ntwo\r\n'));
    expect(file.hunks[0]?.lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('marks a missing trailing newline on the last line', () => {
    const file = synthesizeAddedFile('a.txt', Buffer.from('one\ntwo'));
    const lines = file.hunks[0]?.lines ?? [];
    expect(lines[0]?.noNewline).toBeUndefined();
    expect(lines[1]?.noNewline).toBe(true);
  });

  it('reports a file with a NUL byte as binary, with no hunks', () => {
    const file = synthesizeAddedFile('image.png', Buffer.from([0x89, 0x50, 0x00, 0x47]));
    expect(file.binary).toBe(true);
    expect(file.hunks).toEqual([]);
  });

  it('gives an empty file no hunks', () => {
    const file = synthesizeAddedFile('empty.txt', Buffer.alloc(0));
    expect(file.hunks).toEqual([]);
    expect(file.additions).toBe(0);
  });

  it('truncates very long files with a note, but still counts every line', () => {
    const total = MAX_UNTRACKED_LINES + 250;
    const text = Array.from({ length: total }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    const file = synthesizeAddedFile('big.txt', Buffer.from(text));
    const lines = file.hunks[0]?.lines ?? [];

    expect(file.additions).toBe(total);
    expect(lines).toHaveLength(MAX_UNTRACKED_LINES + 1);
    expect(lines.at(-1)).toEqual({ kind: 'meta', text: '… 250 more lines not shown' });
  });
});
