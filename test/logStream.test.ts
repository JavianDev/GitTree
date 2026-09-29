import { beforeEach, describe, expect, it } from 'vitest';
import type { Commit, GraphRow } from '../src/shared/model';
import { LogStream, nextStreamId, resetStreamIds } from '../src/webview/features/history/logStream';

function commit(hash: string): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    author: { name: 'A', email: 'a@example.com' },
    authorDate: '2026-08-20T10:00:00Z',
    committer: { name: 'A', email: 'a@example.com' },
    commitDate: '2026-08-20T10:00:00Z',
    refs: [],
    signature: 'none',
    subject: hash,
    body: '',
  };
}

/** Rows travel with their commits, so the fixture supplies both. */
const row = (hash: string, index: number): GraphRow => ({
  hash,
  row: index,
  lane: 0,
  color: 0,
  passthrough: [],
  incoming: [],
  edges: [],
  width: 1,
  isMerge: false,
  isRoot: false,
});

const batch = (streamId: string, hashes: string[], done = false) => ({
  streamId,
  commits: hashes.map(commit),
  rows: hashes.map(row),
  done,
});

beforeEach(() => resetStreamIds());

describe('nextStreamId', () => {
  it('produces a fresh id each call', () => {
    expect([nextStreamId(), nextStreamId(), nextStreamId()]).toEqual(['log-1', 'log-2', 'log-3']);
  });
});

describe('LogStream — the ordering invariant', () => {
  // The regression this file exists for: history rendered "No commits yet" on a
  // repository full of commits, because the correlation id was learned from the
  // log/start *response* while the host began emitting batches immediately. On a
  // small repository every batch — including the terminal one — won that race and
  // was discarded, leaving the view permanently empty.
  it('has its id before anything is sent, so no batch can be unroutable', () => {
    const stream = new LogStream();
    expect(stream.streamId).toBe('log-1');
    expect(stream.done).toBe(false);
  });

  it('accepts a complete sequence delivered before any response could resolve', () => {
    const stream = new LogStream();

    // Everything the host would emit, all of it landing synchronously — the exact
    // timing that used to drop the entire history.
    expect(stream.accept(batch(stream.streamId, ['a', 'b']))).toBe(true);
    expect(stream.accept(batch(stream.streamId, ['c']))).toBe(true);
    expect(stream.accept(batch(stream.streamId, [], true))).toBe(true);

    expect(stream.commits.map((c) => c.hash)).toEqual(['a', 'b', 'c']);
    expect(stream.done).toBe(true);
  });

  it('preserves arrival order across batches', () => {
    const stream = new LogStream();
    stream.accept(batch(stream.streamId, ['1', '2']));
    stream.accept(batch(stream.streamId, ['3', '4']));

    expect(stream.commits.map((c) => c.hash)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps rows index-aligned with commits', () => {
    // The canvas indexes rows by list position; a drift here silently draws the
    // wrong rail beside the wrong commit.
    const stream = new LogStream();
    stream.accept(batch(stream.streamId, ['a', 'b']));
    stream.accept(batch(stream.streamId, ['c'], true));

    expect(stream.rows).toHaveLength(stream.commits.length);
    expect(stream.rows.map((r) => r.hash)).toEqual(stream.commits.map((c) => c.hash));
  });

  it('ignores batches belonging to another stream', () => {
    const first = new LogStream();
    const second = new LogStream();

    expect(first.accept(batch(second.streamId, ['x']))).toBe(false);
    expect(first.size).toBe(0);

    expect(second.accept(batch(second.streamId, ['x']))).toBe(true);
    expect(second.size).toBe(1);
  });

  it('reports a matching but empty batch as accepted', () => {
    // "Not mine" and "mine, but nothing in it" are different answers; the caller
    // repaints on the second and not on the first.
    const stream = new LogStream();
    expect(stream.accept(batch(stream.streamId, []))).toBe(true);
    expect(stream.size).toBe(0);
  });

  it('does not let another stream terminate this one', () => {
    const stream = new LogStream();
    const other = new LogStream();

    stream.accept(batch(other.streamId, [], true));
    expect(stream.done).toBe(false);

    stream.accept(batch(stream.streamId, [], true));
    expect(stream.done).toBe(true);
  });

  it('gives concurrent streams independent ids and buffers', () => {
    // Two repositories loading at once must not merge their histories.
    const a = new LogStream();
    const b = new LogStream();

    expect(a.streamId).not.toBe(b.streamId);

    a.accept(batch(a.streamId, ['a1']));
    b.accept(batch(b.streamId, ['b1', 'b2']));

    expect(a.commits.map((c) => c.hash)).toEqual(['a1']);
    expect(b.commits.map((c) => c.hash)).toEqual(['b1', 'b2']);
  });

  it('accepts an explicit id, for a caller that already has one', () => {
    const stream = new LogStream('log-restored');
    expect(stream.accept(batch('log-restored', ['z'], true))).toBe(true);
    expect(stream.done).toBe(true);
  });
});
