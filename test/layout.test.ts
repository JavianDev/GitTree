import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/shared/model';
import { GraphLayout, layoutGraph, maxWidth } from '../src/extension/graph/layout';

/** Minimal commit stub — layout only reads `hash` and `parents`. */
function commit(hash: string, parents: string[] = []): Commit {
  return {
    hash,
    shortHash: hash,
    parents,
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

describe('layoutGraph — linear history', () => {
  const rows = layoutGraph([commit('C', ['B']), commit('B', ['A']), commit('A')]);

  it('keeps a single chain in one lane', () => {
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(maxWidth(rows)).toBe(1);
  });

  it('connects each commit to its parent with a straight rail', () => {
    expect(rows[0]?.edges).toMatchObject([{ fromLane: 0, toLane: 0, kind: 'straight', parent: 'B' }]);
    expect(rows[1]?.edges).toMatchObject([{ fromLane: 0, toLane: 0, kind: 'straight', parent: 'A' }]);
  });

  it('emits no edges from a root commit', () => {
    expect(rows[2]?.edges).toEqual([]);
  });

  it('numbers rows in input order', () => {
    expect(rows.map((r) => r.row)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.hash)).toEqual(['C', 'B', 'A']);
  });
});

describe('layoutGraph — merges', () => {
  //   M        merge of A and B
  //   |\
  //   A B      both branched from R
  //   |/
  //   R
  const rows = layoutGraph([
    commit('M', ['A', 'B']),
    commit('A', ['R']),
    commit('B', ['R']),
    commit('R'),
  ]);

  it('continues the first parent in the merge commit lane', () => {
    expect(rows[0]?.lane).toBe(0);
    expect(rows[0]?.edges[0]).toMatchObject({ fromLane: 0, toLane: 0, kind: 'straight', parent: 'A' });
  });

  it('opens a new lane for the second parent', () => {
    expect(rows[0]?.edges[1]).toMatchObject({ fromLane: 0, toLane: 1, kind: 'branch', parent: 'B' });
    expect(rows[0]?.width).toBe(2);
  });

  it('places the second parent in the lane that was opened for it', () => {
    expect(rows[2]?.hash).toBe('B');
    expect(rows[2]?.lane).toBe(1);
  });

  it('converges shared parents into the lowest waiting lane', () => {
    // Both A and B have parent R, so R terminates two rails at once.
    expect(rows[3]?.hash).toBe('R');
    expect(rows[3]?.lane).toBe(0);
  });

  it('reports lanes that pass a row untouched', () => {
    // While A is drawn in lane 0, the rail heading for B occupies lane 1.
    expect(rows[1]?.passthrough.map((r) => r.lane)).toEqual([1]);
  });
});

describe('layoutGraph — octopus merge', () => {
  const rows = layoutGraph([
    commit('O', ['P1', 'P2', 'P3']),
    commit('P1'),
    commit('P2'),
    commit('P3'),
  ]);

  it('emits one edge per parent', () => {
    expect(rows[0]?.edges).toHaveLength(3);
    expect(rows[0]?.edges.map((e) => e.kind)).toEqual(['straight', 'branch', 'branch']);
  });

  it('widens the gutter to hold every parent rail', () => {
    expect(rows[0]?.width).toBe(3);
    expect(maxWidth(rows)).toBe(3);
  });

  it('gives each parent its own lane', () => {
    expect(rows.slice(1).map((r) => r.lane)).toEqual([0, 1, 2]);
  });
});

describe('layoutGraph — lane reuse', () => {
  it('reuses a lane freed by a completed branch', () => {
    //   M        merges the short-lived branch B
    //   |\
    //   A B
    //   |/
    //   R
    //   |
    //   X        after R, lane 1 is free again
    const rows = layoutGraph([
      commit('M', ['A', 'B']),
      commit('A', ['R']),
      commit('B', ['R']),
      commit('R', ['X']),
      commit('X'),
    ]);

    expect(rows[4]?.lane).toBe(0);
    expect(rows[4]?.width).toBe(1);
  });

  it('joins an existing rail instead of opening a duplicate', () => {
    // Both M1 and M2 merge in B; the second merge must reuse B's lane.
    const rows = layoutGraph([
      commit('M1', ['M2', 'B']),
      commit('M2', ['A', 'B']),
      commit('A', ['R']),
      commit('B', ['R']),
      commit('R'),
    ]);

    const secondMerge = rows[1]?.edges.find((e) => e.parent === 'B');
    expect(secondMerge?.kind).toBe('merge');
    expect(maxWidth(rows)).toBe(2);
  });
});

describe('GraphLayout — streaming matches whole-history layout', () => {
  // The graph is laid out incrementally as commits stream in, so rails appear
  // with the first batch instead of only after the walk completes. That is only
  // safe if feeding commits in pieces produces byte-identical rows to laying out
  // the finished array — otherwise the graph would depend on batch boundaries,
  // which are a function of network timing.
  const history = [
    commit('M1', ['M2', 'B']),
    commit('M2', ['A', 'B']),
    commit('A', ['R']),
    commit('B', ['R']),
    commit('R', ['X']),
    commit('X'),
  ];

  it('produces the same rows one commit at a time', () => {
    const layout = new GraphLayout();
    const streamed = history.map((entry) => layout.push(entry));

    expect(streamed).toEqual(layoutGraph(history));
  });

  it('is independent of where the batch boundaries fall', () => {
    const expected = layoutGraph(history);

    for (const size of [1, 2, 3, 4, 5, 6, 100]) {
      const layout = new GraphLayout();
      const streamed: ReturnType<typeof layoutGraph> = [];

      for (let i = 0; i < history.length; i += size) {
        streamed.push(...layout.pushAll(history.slice(i, i + size)));
      }

      expect(streamed, `batch size ${size}`).toEqual(expected);
    }
  });

  it('numbers rows continuously across batches', () => {
    const layout = new GraphLayout();
    layout.pushAll(history.slice(0, 2));
    const later = layout.pushAll(history.slice(2));

    expect(later.map((r) => r.row)).toEqual([2, 3, 4, 5]);
  });

  it('starts empty', () => {
    expect(new GraphLayout().pushAll([])).toEqual([]);
  });
});

describe('rail colours', () => {
  it('keeps one colour for a rail across its whole life', () => {
    // A branch that changes hue as lanes are recycled beneath it is impossible
    // to follow down a long history.
    const rows = layoutGraph([commit('C', ['B']), commit('B', ['A']), commit('A')]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
  });

  it('gives a newly opened branch a different colour from the one it left', () => {
    const rows = layoutGraph([
      commit('M', ['A', 'B']),
      commit('A', ['R']),
      commit('B', ['R']),
      commit('R'),
    ]);

    const mainColor = rows[0]?.color;
    const branchColor = rows.find((r) => r.hash === 'B')?.color;
    expect(branchColor).not.toBe(mainColor);
  });

  it('cycles rather than running out, however many branches appear', () => {
    const layout = new GraphLayout(4);
    // Ten independent roots, so ten separate rails are opened.
    const rows = layout.pushAll(Array.from({ length: 10 }, (_, i) => commit(`R${i}`)));

    for (const row of rows) {
      expect(row.color).toBeGreaterThanOrEqual(0);
      expect(row.color).toBeLessThan(4);
    }
  });

  it('colours a merge edge for the branch it joins, not the one it leaves', () => {
    // The eye should follow a merge rail to its destination.
    const rows = layoutGraph([
      commit('M1', ['M2', 'B']),
      commit('M2', ['A', 'B']),
      commit('A', ['R']),
      commit('B', ['R']),
      commit('R'),
    ]);

    const mergeEdge = rows[1]?.edges.find((e) => e.kind === 'merge');
    const target = rows.find((r) => r.hash === 'B');
    expect(mergeEdge?.color).toBe(target?.color);
  });

  it('carries the rail colour on passthrough segments', () => {
    const rows = layoutGraph([
      commit('M', ['A', 'B']),
      commit('A', ['R']),
      commit('B', ['R']),
      commit('R'),
    ]);

    const passing = rows[1]?.passthrough[0];
    const owner = rows.find((r) => r.hash === 'B');
    expect(passing?.color).toBe(owner?.color);
  });
});

describe('node shape flags', () => {
  // Shape carries what colour cannot: it survives a colour-vision difference.
  const rows = layoutGraph([commit('M', ['A', 'B']), commit('A', ['R']), commit('B', ['R']), commit('R')]);

  it('marks a merge', () => {
    expect(rows[0]).toMatchObject({ hash: 'M', isMerge: true, isRoot: false });
  });

  it('marks a root', () => {
    expect(rows[3]).toMatchObject({ hash: 'R', isMerge: false, isRoot: true });
  });

  it('leaves an ordinary commit unmarked', () => {
    expect(rows[1]).toMatchObject({ hash: 'A', isMerge: false, isRoot: false });
  });

  it('treats an octopus merge as a merge', () => {
    expect(layoutGraph([commit('O', ['P1', 'P2', 'P3'])])[0]?.isMerge).toBe(true);
  });
});

describe('layoutGraph — edge cases', () => {
  it('returns nothing for empty input', () => {
    expect(layoutGraph([])).toEqual([]);
    expect(maxWidth([])).toBe(0);
  });

  it('handles a single root commit', () => {
    const rows = layoutGraph([commit('A')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lane: 0, width: 1, edges: [] });
  });

  it('leaves a rail open when a parent is outside the walk', () => {
    // A shallow clone or a --max-count walk truncates history; the rail
    // should run off the bottom rather than being dropped.
    const rows = layoutGraph([commit('C', ['MISSING'])]);
    expect(rows[0]?.edges).toMatchObject([
      { fromLane: 0, toLane: 0, kind: 'straight', parent: 'MISSING' },
    ]);
    expect(rows[0]?.width).toBe(1);
  });

  it('handles two unrelated root chains', () => {
    const rows = layoutGraph([commit('A1', ['A2']), commit('A2'), commit('B1', ['B2']), commit('B2')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0, 0]);
  });
});

describe('layoutGraph — converging branches', () => {
  it('records every lane that converges into a shared parent', () => {
    // Three branches off one commit: each tip gets its own lane, and all of
    // them end at P. The renderer bends those lanes into P's node from this.
    const rows = layoutGraph([
      commit('X', ['P']),
      commit('Y', ['P']),
      commit('Z', ['P']),
      commit('P', ['R']),
      commit('R'),
    ]);

    expect(rows.slice(0, 3).map((row) => row.lane)).toEqual([0, 1, 2]);
    expect(rows[3]?.lane).toBe(0);
    expect(rows[3]?.incoming).toEqual([0, 1, 2]);
    expect(rows[4]?.incoming).toEqual([0]);
  });

  it('gives a branch tip no incoming lanes', () => {
    const rows = layoutGraph([commit('B', ['A']), commit('A')]);
    expect(rows[0]?.incoming).toEqual([]);
  });
});
