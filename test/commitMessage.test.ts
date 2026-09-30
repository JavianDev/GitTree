import { describe, expect, it } from 'vitest';
import { parseModelReply, suggestFromFiles } from '../src/extension/commitMessage/heuristic';

describe('suggestFromFiles', () => {
  it('names a single added file', () => {
    expect(suggestFromFiles([{ path: 'src/auth.py', kind: 'untracked' }])).toEqual({
      summary: 'Add auth.py',
      description: '',
    });
  });

  it('names two files, and lists every file in the body', () => {
    const message = suggestFromFiles([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'src/b.ts', kind: 'deleted' },
    ]);
    expect(message.summary).toBe('Update a.ts and b.ts');
    expect(message.description).toBe('- Update src/a.ts\n- Remove src/b.ts');
  });

  it('counts the rest when there are many', () => {
    const files = ['a', 'b', 'c', 'd'].map((name) => ({ path: `lib/${name}.ts`, kind: 'deleted' as const }));
    expect(suggestFromFiles(files).summary).toBe('Remove a.ts and 3 other files');
  });

  it('describes a rename by both names', () => {
    expect(suggestFromFiles([{ path: 'src/new.ts', kind: 'renamed', origPath: 'src/old.ts' }]).summary).toBe(
      'Rename old.ts to new.ts',
    );
  });

  it('uses the conventional type that obviously applies', () => {
    expect(suggestFromFiles([{ path: 'README.md', kind: 'modified' }]).summary).toBe('docs: update README.md');
    expect(suggestFromFiles([{ path: 'tests/test_auth.py', kind: 'untracked' }]).summary).toBe('test: add test_auth.py');
    expect(suggestFromFiles([{ path: 'package.json', kind: 'modified' }]).summary).toBe('chore: update package.json');
  });

  it('keeps the summary under 72 characters', () => {
    const long = 'a'.repeat(90);
    expect(suggestFromFiles([{ path: `${long}.ts`, kind: 'modified' }]).summary.length).toBeLessThanOrEqual(72);
  });

  it('caps the body list', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts`, kind: 'modified' as const }));
    const lines = suggestFromFiles(files).description.split('\n');
    expect(lines).toHaveLength(13);
    expect(lines.at(-1)).toBe('- …and 8 more');
  });

  it('returns nothing for no changes', () => {
    expect(suggestFromFiles([])).toEqual({ summary: '', description: '' });
  });
});

describe('parseModelReply', () => {
  it('splits summary and body', () => {
    expect(parseModelReply('feat: add login\n\nAdds the login form.\n- validates email')).toEqual({
      summary: 'feat: add login',
      description: 'Adds the login form.\n- validates email',
    });
  });

  it('strips the wrapping chat models add', () => {
    expect(parseModelReply('```\nCommit message: "fix: handle null user"\n```')).toEqual({
      summary: 'fix: handle null user',
      description: '',
    });
  });

  it('handles an empty reply', () => {
    expect(parseModelReply('   ')).toEqual({ summary: '', description: '' });
  });
});
