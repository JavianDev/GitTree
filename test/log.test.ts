import { describe, expect, it } from 'vitest';
import {
  listArgs,
  logArgs,
  parseCommitRecord,
  parseDecorations,
  parseListRecord,
  parseLog,
} from '../src/extension/git/parsers/log';

const NUL = String.fromCharCode(0);
const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

interface Fields {
  hash?: string;
  short?: string;
  parents?: string;
  refs?: string;
  sig?: string;
  subject?: string;
  body?: string;
}

/** Builds a record in the exact field order LOG_FORMAT emits. */
function record(f: Fields = {}): string {
  return [
    f.hash ?? H1,
    f.short ?? (f.hash ?? H1).slice(0, 7),
    f.parents ?? '',
    'Ada Lovelace',
    'ada@example.com',
    '2026-08-20T10:00:00+01:00',
    'Grace Hopper',
    'grace@example.com',
    '2026-08-20T11:30:00+01:00',
    f.refs ?? '',
    f.sig ?? 'N',
    f.subject ?? 'Initial commit',
    f.body ?? '',
  ].join(NUL);
}

describe('parseCommitRecord', () => {
  it('parses every field of a well-formed record', () => {
    const commit = parseCommitRecord(record({ parents: H2, subject: 'Add parser', body: 'Details here.' }));

    expect(commit).toMatchObject({
      hash: H1,
      shortHash: 'aaaaaaa',
      parents: [H2],
      author: { name: 'Ada Lovelace', email: 'ada@example.com' },
      authorDate: '2026-08-20T10:00:00+01:00',
      committer: { name: 'Grace Hopper', email: 'grace@example.com' },
      commitDate: '2026-08-20T11:30:00+01:00',
      subject: 'Add parser',
      body: 'Details here.',
      signature: 'none',
    });
  });

  it('returns an empty parent list for a root commit', () => {
    expect(parseCommitRecord(record({ parents: '' }))?.parents).toEqual([]);
  });

  it('splits multiple parents on whitespace', () => {
    const commit = parseCommitRecord(record({ parents: `${H2} ${H1}` }));
    expect(commit?.parents).toEqual([H2, H1]);
  });

  it('keeps a multi-line body intact', () => {
    const body = 'First paragraph.\n\nSecond paragraph.\n\nCo-authored-by: X <x@y.z>';
    expect(parseCommitRecord(record({ body }))?.body).toBe(body);
  });

  it('strips the leading newline that separates records', () => {
    // git emits a newline after each --format output, so every record after
    // the first begins with the previous record's terminator.
    const commit = parseCommitRecord('\n' + record({ subject: 'Second' }));
    expect(commit?.hash).toBe(H1);
    expect(commit?.subject).toBe('Second');
  });

  it('returns undefined for empty or truncated records', () => {
    expect(parseCommitRecord('')).toBeUndefined();
    expect(parseCommitRecord('\n')).toBeUndefined();
    expect(parseCommitRecord(['only', 'three', 'fields'].join(NUL))).toBeUndefined();
  });

  it('attaches a repoId when one is supplied, for unified history', () => {
    expect(parseCommitRecord(record(), 'repo-1')?.repoId).toBe('repo-1');
    expect(parseCommitRecord(record())?.repoId).toBeUndefined();
  });

  it('maps signature codes', () => {
    const sig = (code: string) => parseCommitRecord(record({ sig: code }))?.signature;
    expect(sig('G')).toBe('good');
    expect(sig('B')).toBe('bad');
    expect(sig('U')).toBe('unknown-validity');
    expect(sig('E')).toBe('cannot-check');
    expect(sig('N')).toBe('none');
  });
});

describe('parseLog', () => {
  it('skips unparseable records without aborting the walk', () => {
    const commits = parseLog([record({ hash: H1 }), '', 'garbage', '\n' + record({ hash: H2 })]);
    expect(commits.map((c) => c.hash)).toEqual([H1, H2]);
  });
});

describe('parseDecorations', () => {
  it('marks the checked-out branch from the HEAD arrow', () => {
    expect(parseDecorations('HEAD -> refs/heads/main')).toEqual([
      { kind: 'localBranch', name: 'main', isHead: true },
    ]);
  });

  it('separates local branches, remote branches and tags', () => {
    const refs = parseDecorations(
      'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.2.0',
    );

    expect(refs).toEqual([
      { kind: 'localBranch', name: 'main', isHead: true },
      { kind: 'remoteBranch', name: 'origin/main', isHead: false, remote: 'origin' },
      { kind: 'tag', name: 'v1.2.0', isHead: false },
    ]);
  });

  it('handles a detached HEAD', () => {
    expect(parseDecorations('HEAD, tag: refs/tags/v1.0')).toEqual([
      { kind: 'head', name: 'HEAD', isHead: true },
      { kind: 'tag', name: 'v1.0', isHead: false },
    ]);
  });

  it('recognises the stash ref', () => {
    expect(parseDecorations('refs/stash')).toEqual([{ kind: 'stash', name: 'stash', isHead: false }]);
  });

  it('keeps branch names containing slashes whole', () => {
    expect(parseDecorations('refs/heads/feature/nested/name')).toEqual([
      { kind: 'localBranch', name: 'feature/nested/name', isHead: false },
    ]);
  });

  it('resolves a remote branch whose name contains slashes', () => {
    expect(parseDecorations('refs/remotes/upstream/release/2.0')).toEqual([
      { kind: 'remoteBranch', name: 'upstream/release/2.0', isHead: false, remote: 'upstream' },
    ]);
  });

  it('returns nothing for an undecorated commit', () => {
    expect(parseDecorations('')).toEqual([]);
  });
});

describe('parseListRecord — the lean format', () => {
  /** Eight fields, in LIST_FORMAT order. */
  const listRecord = (over: Partial<Record<string, string>> = {}) =>
    [
      over.hash ?? H1,
      (over.hash ?? H1).slice(0, 7),
      over.parents ?? H2,
      'Ada Lovelace',
      'ada@example.com',
      '2026-08-20T10:00:00+01:00',
      over.refs ?? '',
      over.subject ?? 'Add parser',
    ].join(NUL);

  it('parses the fields the list actually renders', () => {
    expect(parseListRecord(listRecord())).toMatchObject({
      hash: H1,
      shortHash: 'aaaaaaa',
      parents: [H2],
      author: { name: 'Ada Lovelace', email: 'ada@example.com' },
      authorDate: '2026-08-20T10:00:00+01:00',
      subject: 'Add parser',
    });
  });

  it('leaves body and signature empty rather than undefined', () => {
    // The list never shows them; the inspector loads the full record instead.
    // Filling them keeps one Commit type across both paths.
    const parsed = parseListRecord(listRecord());
    expect(parsed?.body).toBe('');
    expect(parsed?.signature).toBe('none');
  });

  it('mirrors the author into the committer slot', () => {
    const parsed = parseListRecord(listRecord());
    expect(parsed?.committer).toEqual(parsed?.author);
    expect(parsed?.commitDate).toBe(parsed?.authorDate);
  });

  it('still decodes ref decorations', () => {
    const parsed = parseListRecord(listRecord({ refs: 'HEAD -> refs/heads/main' }));
    expect(parsed?.refs).toEqual([{ kind: 'localBranch', name: 'main', isHead: true }]);
  });

  it('handles a root commit', () => {
    expect(parseListRecord(listRecord({ parents: '' }))?.parents).toEqual([]);
  });

  it('strips the record-separating newline', () => {
    expect(parseListRecord('\n' + listRecord())?.hash).toBe(H1);
  });

  it('rejects a record with too few fields', () => {
    expect(parseListRecord(['a', 'b', 'c'].join(NUL))).toBeUndefined();
    expect(parseListRecord('')).toBeUndefined();
  });
});

describe('listArgs', () => {
  it('caps the walk so the first screen is not blocked by full history', () => {
    expect(listArgs({ limit: 2000 })).toContain('--max-count=2000');
  });

  it('defaults to topological order, which the incremental layout requires', () => {
    expect(listArgs({})).toContain('--topo-order');
  });

  it('offers date order, which is faster on large histories', () => {
    const args = listArgs({ order: 'date' });
    expect(args).toContain('--date-order');
    expect(args).not.toContain('--topo-order');
  });

  it('supports paging deeper into history', () => {
    expect(listArgs({ skip: 2000, limit: 2000 })).toContain('--skip=2000');
  });

  it('omits --skip when starting from the top', () => {
    expect(listArgs({ skip: 0 }).some((a) => a.startsWith('--skip'))).toBe(false);
  });

  it('requests the lean format, without the commit body', () => {
    const format = listArgs({}).find((a) => a.startsWith('--format='));
    expect(format).toBeDefined();
    expect(format).not.toContain('%b');
    expect(format).not.toContain('%G?');
  });
});

describe('logArgs', () => {
  it('walks all refs topologically by default', () => {
    const args = logArgs({});
    expect(args).toContain('--topo-order');
    expect(args).toContain('--decorate=full');
    expect(args).toContain('--all');
  });

  it('uses explicit refs instead of --all when given', () => {
    const args = logArgs({ refs: ['main', 'develop'] });
    expect(args).not.toContain('--all');
    expect(args).toContain('main');
    expect(args).toContain('develop');
  });

  it('places paths after a -- separator so they cannot be read as refs', () => {
    const args = logArgs({ paths: ['src/app.ts'] });
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThan(-1);
    expect(args.slice(sep + 1)).toEqual(['src/app.ts']);
  });

  it('passes limit, search and author through as flags', () => {
    const args = logArgs({ limit: 50, search: 'fix', author: 'ada' });
    expect(args).toContain('--max-count=50');
    expect(args).toContain('--grep=fix');
    expect(args).toContain('--author=ada');
  });
});
