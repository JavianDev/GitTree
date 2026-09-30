import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/shared/model';
import { layoutGraph } from '../src/extension/graph/layout';
import {
  LANE_WIDTH,
  MIN_LANE_WIDTH,
  TEXT_GAP,
  laneCenter,
  laneWidthFor,
  parseColor,
  rowExtent,
  rowIndent,
} from '../src/webview/features/history/graphGeometry';
import { railSegments } from '../src/webview/features/history/railSegments';

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

/** The GitTree-Demo history: five branches and a stash off `main`, and a side branch into the root. */
const DEMO = [
  commit('7411e38', ['9243df9', 'aaa6574']),
  commit('aaa6574', ['9243df9']),
  commit('1bcbfa5', ['9243df9']),
  commit('9dbe4af', ['9243df9']),
  commit('147cdb0', ['9243df9']),
  commit('adb8ce5', ['9243df9']),
  commit('9243df9', ['64dabe2']),
  commit('64dabe2', ['457d67c']),
  commit('457d67c', ['62eef15']),
  commit('62eef15', ['52b914f']),
  commit('52b914f', ['f1216cb']),
  commit('0a6f908', ['108dd62']),
  commit('108dd62', ['a5bcdac']),
  commit('a5bcdac', ['8dc67f5']),
  commit('8dc67f5', ['f1216cb']),
  commit('f1216cb'),
];

describe('per-row text indent', () => {
  const rows = layoutGraph(DEMO);
  const segments = railSegments(rows, 0, rows.length - 1);

  it('never lets a rail reach into a row’s text', () => {
    // A row's box holds the lower half of the gap above it and the upper half
    // of the gap below: every lane either touches must sit left of the text.
    for (const [index, row] of rows.entries()) {
      const touching = segments
        .filter((segment) => segment.row === index || segment.row === index - 1)
        .flatMap((segment) => [segment.fromLane, segment.toLane]);
      const widest = Math.max(row.lane, ...touching);
      const railEdge = laneCenter(widest, LANE_WIDTH) + LANE_WIDTH / 2;

      expect(rowIndent(row, LANE_WIDTH), row.hash).toBeGreaterThanOrEqual(railEdge);
    }
  });

  it('starts text right after a row’s own rails, not after the widest row in history', () => {
    const indents = rows.map((row) => rowIndent(row, LANE_WIDTH));
    // The graph is six lanes wide where the branches fan out…
    expect(Math.max(...indents)).toBe(6 * LANE_WIDTH + TEXT_GAP);
    // …but the root commit, with a single lane, keeps its text beside its node.
    expect(indents.at(-1)).toBe(2 * LANE_WIDTH + TEXT_GAP);
  });

  it('covers every lane converging into a shared parent', () => {
    const main = rows.find((row) => row.hash === '9243df9')!;
    expect(rowExtent(main)).toBe(Math.max(...main.incoming));
  });

  it('indents a single-lane history by exactly one lane', () => {
    const linear = layoutGraph([commit('C', ['B']), commit('B', ['A']), commit('A')]);
    for (const row of linear) expect(rowIndent(row, LANE_WIDTH)).toBe(LANE_WIDTH + TEXT_GAP);
  });

  it('has an indent even for a row that has not loaded yet', () => {
    expect(rowIndent(undefined, LANE_WIDTH)).toBe(LANE_WIDTH + TEXT_GAP);
  });
});

describe('laneWidthFor', () => {
  it('uses the full lane width while it fits', () => {
    expect(laneWidthFor(6, 240)).toBe(LANE_WIDTH);
  });

  it('compresses lanes to fit the budget, down to a floor', () => {
    expect(laneWidthFor(30, 240)).toBeCloseTo((240 - LANE_WIDTH / 2) / 30, 6);
    expect(laneWidthFor(500, 240)).toBe(MIN_LANE_WIDTH);
  });
});

describe('parseColor', () => {
  it('reads the palette token forms', () => {
    expect(parseColor('#4c9dff')).toEqual([76, 157, 255]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
  });

  it('returns undefined for anything else, so drawing falls back to the flat colour', () => {
    expect(parseColor('var(--x)')).toBeUndefined();
    expect(parseColor('tomato')).toBeUndefined();
  });
});
