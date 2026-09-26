import { describe, expect, it } from 'vitest';
import { StreamSplitter } from '../src/extension/git/StreamSplitter';

/** The NUL that git emits under -z. */
const NUL = String.fromCharCode(0);
/** U+FFFD, what a broken multi-byte decode produces. */
const REPLACEMENT = String.fromCharCode(0xfffd);

describe('StreamSplitter', () => {
  it('splits records within a single chunk', () => {
    const splitter = new StreamSplitter(NUL);
    expect(splitter.push(Buffer.from(`a${NUL}b${NUL}`))).toEqual(['a', 'b']);
    expect(splitter.flush()).toEqual([]);
  });

  it('carries an incomplete record across a chunk boundary', () => {
    const splitter = new StreamSplitter(NUL);
    expect(splitter.push(Buffer.from('hel'))).toEqual([]);
    expect(splitter.push(Buffer.from(`lo${NUL}wor`))).toEqual(['hello']);
    expect(splitter.push(Buffer.from(`ld${NUL}`))).toEqual(['world']);
    expect(splitter.flush()).toEqual([]);
  });

  it('emits a trailing record with no separator on flush', () => {
    const splitter = new StreamSplitter(NUL);
    expect(splitter.push(Buffer.from(`a${NUL}tail`))).toEqual(['a']);
    expect(splitter.flush()).toEqual(['tail']);
  });

  it('does not emit an empty record when a chunk ends exactly on a separator', () => {
    const splitter = new StreamSplitter(NUL);
    expect(splitter.push(Buffer.from(`a${NUL}`))).toEqual(['a']);
    expect(splitter.push(Buffer.from(`b${NUL}`))).toEqual(['b']);
    expect(splitter.flush()).toEqual([]);
  });

  it('preserves a multi-byte character split across chunks', () => {
    // U+00E9 encodes as 0xC3 0xA9. Decoding each chunk independently splits
    // the pair and yields U+FFFD, which is how non-ASCII paths get mangled.
    const bytes = Buffer.from(`café${NUL}`, 'utf8');
    const splitter = new StreamSplitter(NUL);

    expect(splitter.push(bytes.subarray(0, 4))).toEqual([]);
    const rest = splitter.push(bytes.subarray(4));

    expect(rest).toEqual(['café']);
    expect(rest[0]).not.toContain(REPLACEMENT);
  });

  it('preserves a 4-byte emoji fed one byte at a time', () => {
    const bytes = Buffer.from(`\u{1F600}${NUL}`, 'utf8');
    const splitter = new StreamSplitter(NUL);

    const out: string[] = [];
    for (const byte of bytes) out.push(...splitter.push(Buffer.from([byte])));
    out.push(...splitter.flush());

    expect(out).toEqual(['\u{1F600}']);
  });

  it('keeps empty records that sit between two separators', () => {
    const splitter = new StreamSplitter(NUL);
    expect(splitter.push(Buffer.from(`a${NUL}${NUL}b${NUL}`))).toEqual(['a', '', 'b']);
  });

  it('splitAll handles a complete buffer in one call', () => {
    expect(StreamSplitter.splitAll(`x${NUL}y${NUL}z`, NUL)).toEqual(['x', 'y', 'z']);
  });

  it('rejects an empty separator', () => {
    expect(() => new StreamSplitter('')).toThrow(/non-empty separator/);
  });
});
