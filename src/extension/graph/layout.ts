import type { Commit, GraphEdge, GraphPassthrough, GraphRow } from '@shared/model';

/**
 * Number of distinct rail colours.
 *
 * Twelve rather than a handful: with eight, a busy repository wraps often enough
 * that two visible rails regularly share a hue, which is exactly when the graph
 * stops being readable.
 */
export const PALETTE_SIZE = 12;

/**
 * Incremental lane assignment.
 *
 * Stateful on purpose. Laying out the whole history at once means the graph
 * cannot appear until the last commit has been walked, and it forces the entire
 * commit array across a boundary to wherever the layout runs. Feeding commits in
 * as they stream keeps each row O(lanes) and lets rails render with the first
 * batch.
 *
 * Commits must arrive in the order git emitted them. Under `--topo-order` a
 * parent never precedes its child, which is what keeps rails running downward.
 */
export class GraphLayout {
  /** lanes[i] holds the hash lane i is travelling toward, or null when free. */
  private readonly lanes: (string | null)[] = [];
  /** Palette index held by lane i for as long as its current rail lives. */
  private readonly laneColors: number[] = [];
  private nextRow = 0;
  private nextColor = 0;

  constructor(private readonly paletteSize = PALETTE_SIZE) {}

  /** Assigns one commit and returns its row. */
  push(commit: Commit): GraphRow {
    const lanes = this.lanes;

    // Every lane awaiting this commit terminates here. More than one means
    // several children share this parent; they converge into the lowest lane.
    const incoming: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) incoming.push(i);
    }

    const lane = incoming.length > 0 ? (incoming[0] as number) : this.allocate();
    for (const i of incoming) lanes[i] = null;

    const color = this.laneColors[lane] ?? 0;

    // Rails belonging to unrelated branches that pass this row untouched.
    const passthrough: GraphPassthrough[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && i !== lane) {
        passthrough.push({ lane: i, color: this.laneColors[i] ?? 0 });
      }
    }

    const edges: GraphEdge[] = [];

    for (let p = 0; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      if (!parent) continue;

      if (p === 0) {
        // The first parent continues the commit's own lane, which is what keeps
        // a branch reading as one vertical line — and keeps its colour.
        lanes[lane] = parent;
        edges.push({ fromLane: lane, toLane: lane, kind: 'straight', parent, color });
        continue;
      }

      // Additional parents are merges. If a lane is already heading for that
      // parent, join it rather than opening a redundant rail.
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        edges.push({
          fromLane: lane,
          toLane: existing,
          kind: 'merge',
          parent,
          // A merge rail takes the colour of the branch it joins, so the eye
          // follows the destination rather than the crossing.
          color: this.laneColors[existing] ?? 0,
        });
      } else {
        const target = this.allocate();
        lanes[target] = parent;
        edges.push({
          fromLane: lane,
          toLane: target,
          kind: 'branch',
          parent,
          color: this.laneColors[target] ?? 0,
        });
      }
    }

    // A root commit ends its lane.
    if (commit.parents.length === 0) lanes[lane] = null;

    // Trailing free lanes should not widen the gutter.
    let width = lanes.length;
    while (width > 0 && lanes[width - 1] === null) width--;

    return {
      hash: commit.hash,
      row: this.nextRow++,
      lane,
      color,
      passthrough,
      incoming,
      edges,
      width: Math.max(width, lane + 1),
      isMerge: commit.parents.length > 1,
      isRoot: commit.parents.length === 0,
    };
  }

  /** Assigns a batch, preserving order. */
  pushAll(commits: readonly Commit[]): GraphRow[] {
    const rows: GraphRow[] = [];
    for (const commit of commits) {
      if (commit) rows.push(this.push(commit));
    }
    return rows;
  }

  /**
   * Claims a free lane and gives its new rail the next colour.
   *
   * Colours cycle from a counter rather than from the lane index. Indexing by
   * lane means lane 0 is always the same hue, so long stretches of history look
   * monotone and two adjacent branches can land on neighbouring — easily
   * confused — colours. Advancing per rail gives consecutive branches visibly
   * different colours as they appear.
   */
  private allocate(): number {
    const free = this.lanes.indexOf(null);
    const lane = free !== -1 ? free : this.lanes.push(null) - 1;

    this.laneColors[lane] = this.nextColor % this.paletteSize;
    this.nextColor++;
    return lane;
  }
}

/**
 * Lays out a complete history in one call.
 *
 * A thin wrapper over `GraphLayout` so the algorithm can be tested against a
 * whole fixture at once; production streams through the class instead.
 */
export function layoutGraph(commits: readonly Commit[]): GraphRow[] {
  return new GraphLayout().pushAll(commits);
}

/** Highest lane index used anywhere in the layout; drives gutter sizing. */
export function maxWidth(rows: readonly GraphRow[]): number {
  let max = 0;
  for (const row of rows) max = Math.max(max, row.width);
  return max;
}
