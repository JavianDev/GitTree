import type { GraphRow } from '@shared/model';

/** One piece of rail, spanning the gap between a row's node and the next row's. */
export interface RailSegment {
  /** Row at the top of the gap; the segment ends on row `row + 1`. */
  row: number;
  /** Lane at the top, at row `row`'s centre line. */
  fromLane: number;
  /** Lane at the bottom, at row `row + 1`'s centre line. */
  toLane: number;
  color: number;
}

/**
 * Every rail crossing the gaps below rows `first`…`last` (inclusive).
 *
 * Rails are drawn gap by gap rather than as one stroke from a child all the
 * way down to its parent. A single stroke has two failure modes, both of which
 * showed up as the graph "breaking":
 *
 *  - When several branches share a parent they converge into one lane, but a
 *    stroke drawn in the child's lane ends beside the parent's node, in mid-air,
 *    instead of bending into it.
 *  - A stroke only exists while its child row is being drawn, so once the child
 *    scrolled out of the window the last stretch into the parent vanished.
 *
 * Gap by gap, each segment needs only the two rows it joins: whatever crosses
 * below row `i` (its outgoing edges and its passthrough rails) lands either on
 * the same lane in row `i + 1`, or — if that lane converges there — on row
 * `i + 1`'s node.
 */
export function railSegments(rows: readonly GraphRow[], first: number, last: number): RailSegment[] {
  const segments: RailSegment[] = [];

  for (let index = Math.max(0, first); index <= last && index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    const next = rows[index + 1];

    // Not loaded yet (or the end of history): carry the rail straight down.
    const landing = (lane: number): number => (next && next.incoming.includes(lane) ? next.lane : lane);

    for (const edge of row.edges) {
      segments.push({ row: index, fromLane: edge.fromLane, toLane: landing(edge.toLane), color: edge.color });
    }

    for (const rail of row.passthrough) {
      segments.push({ row: index, fromLane: rail.lane, toLane: landing(rail.lane), color: rail.color });
    }
  }

  return segments;
}
