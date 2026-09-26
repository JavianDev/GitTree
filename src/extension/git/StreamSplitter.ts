import { StringDecoder } from 'node:string_decoder';

/**
 * Splits a byte stream into separator-delimited records.
 *
 * Two boundary problems make the naive `chunk.toString().split(sep)` wrong, and
 * both fail silently rather than loudly:
 *
 *  1. A record separator can land across a chunk boundary, so the tail of one
 *     chunk must be carried into the next. Without the residual buffer, records
 *     straddling a 64 KB boundary are corrupted or dropped.
 *  2. A multi-byte UTF-8 sequence can also straddle a boundary. Decoding each
 *     chunk independently turns the split character into replacement bytes,
 *     which is how non-ASCII paths get mangled. `StringDecoder` holds the
 *     incomplete sequence back until the continuation bytes arrive.
 *
 * Used with `\0` for `-z` output and `\x1e` for the log record format.
 */
export class StreamSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private residual = '';

  constructor(private readonly separator: string) {
    if (separator.length === 0) {
      throw new Error('StreamSplitter requires a non-empty separator');
    }
  }

  /** Feeds a chunk and returns every record completed by it. */
  push(chunk: Buffer): string[] {
    const text = this.residual + this.decoder.write(chunk);
    const parts = text.split(this.separator);
    // The final element is either an incomplete record or '' when the chunk
    // ended exactly on a separator. Either way it is not yet a record.
    this.residual = parts.pop() ?? '';
    return parts;
  }

  /**
   * Returns whatever follows the final separator once the stream has ended.
   *
   * Git's `-z` output terminates every record, so this is normally empty; the
   * formats that use a trailing-less final record rely on it.
   */
  flush(): string[] {
    const tail = this.residual + this.decoder.end();
    this.residual = '';
    return tail.length > 0 ? [tail] : [];
  }

  /** Splits a complete buffer or string in one call. */
  static splitAll(input: Buffer | string, separator: string): string[] {
    const splitter = new StreamSplitter(separator);
    const records = splitter.push(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
    return [...records, ...splitter.flush()];
  }
}
