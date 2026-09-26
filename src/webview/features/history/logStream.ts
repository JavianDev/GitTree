import type { Commit, GraphRow } from '@shared/model';
import type { Events } from '@shared/protocol';

type LogBatch = Events['log/batch'];

let counter = 0;

/**
 * Mints a correlation id for a history walk.
 *
 * A monotonic counter rather than a random value: ids only need to be unique
 * within one webview session, and a deterministic sequence makes the tests
 * assert exact values instead of shapes.
 */
export function nextStreamId(): string {
  counter += 1;
  return `log-${counter}`;
}

/** Resets the counter. Test-only. */
export function resetStreamIds(): void {
  counter = 0;
}

/**
 * Accumulates the batches of one history walk.
 *
 * Exists as a separate, React-free unit because the bug it replaces was a
 * lifecycle race, not a rendering fault: the id has to exist *before* the
 * request goes out, and that ordering is only provable in isolation.
 *
 * A handle is created with its id already assigned, so there is no window in
 * which an arriving batch cannot be routed.
 */
export class LogStream {
  readonly streamId: string;
  private readonly collected: Commit[] = [];
  private readonly collectedRows: GraphRow[] = [];
  private finished = false;

  constructor(streamId: string = nextStreamId()) {
    this.streamId = streamId;
  }

  /**
   * Consumes a batch. Returns true when it belonged to this stream, so callers
   * can tell "not mine" apart from "mine but empty".
   */
  accept(batch: LogBatch): boolean {
    if (batch.streamId !== this.streamId) return false;

    // `push(...batch)` spreads the batch onto the call stack and overflows it
    // somewhere around 100k arguments — reachable on a large history, and a
    // crash rather than a slowdown when it happens.
    for (const commit of batch.commits) this.collected.push(commit);
    for (const row of batch.rows) this.collectedRows.push(row);

    if (batch.done) this.finished = true;
    return true;
  }

  /** Commits received so far, in arrival order. */
  get commits(): readonly Commit[] {
    return this.collected;
  }

  /** Graph rows, index-aligned with `commits`. */
  get rows(): readonly GraphRow[] {
    return this.collectedRows;
  }

  get done(): boolean {
    return this.finished;
  }

  get size(): number {
    return this.collected.length;
  }
}
