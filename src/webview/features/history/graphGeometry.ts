import type { GraphRow } from '@shared/model';

/** Lane pitch when there is room for it. */
export const LANE_WIDTH = 16;
/** Densest a lane gets before rails would visually merge into one another. */
export const MIN_LANE_WIDTH = 6;
/** The widest the graph grows unless the caller gives it a budget. */
export const DEFAULT_MAX_WIDTH = 240;
/** Space between a row's rightmost rail and its text. */
export const TEXT_GAP = 6;

/**
 * Lane pitch for `lanes` lanes within `maxWidth`. Past the budget, lanes are
 * drawn closer together rather than off the edge — a busy history gets a
 * denser graph, never a cut-off one.
 */
export function laneWidthFor(lanes: number, maxWidth = DEFAULT_MAX_WIDTH): number {
  const count = Math.max(1, lanes);
  return Math.max(MIN_LANE_WIDTH, Math.min(LANE_WIDTH, (maxWidth - LANE_WIDTH / 2) / count));
}

export function laneCenter(lane: number, laneWidth: number): number {
  return laneWidth / 2 + lane * laneWidth;
}

/**
 * The rightmost lane any rail occupies inside this row's box: its node, rails
 * passing through, rails converging into it from above, and rails leaving it.
 * Every rail segment that crosses the row's box starts or ends on one of
 * these lanes (see `railSegments`), so text indented past it never collides.
 */
export function rowExtent(row: GraphRow): number {
  let extent = row.lane;
  for (const rail of row.passthrough) extent = Math.max(extent, rail.lane);
  for (const lane of row.incoming) extent = Math.max(extent, lane);
  for (const edge of row.edges) extent = Math.max(extent, edge.fromLane, edge.toLane);
  return extent;
}

/**
 * Where a row's text starts: just past its own rails, not past the widest row
 * in history. This is what puts each commit message right beside its node
 * instead of after one wide, mostly empty graph column.
 */
export function rowIndent(row: GraphRow | undefined, laneWidth: number): number {
  const extent = row ? rowExtent(row) : 0;
  return Math.round((extent + 1) * laneWidth + TEXT_GAP);
}

export type Rgb = readonly [number, number, number];

/** `#rgb`, `#rrggbb`, and `rgb()/rgba()` — the forms the palette tokens use. */
export function parseColor(value: string): Rgb | undefined {
  const color = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return undefined;
}
