import { describe, expect, it } from 'vitest';
import type { Commit, GraphRow } from '../src/shared/model';
import { layoutGraph } from '../src/extension/graph/layout';
import { type RailSegment, railSegments } from '../src/webview/features/history/railSegments';

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

/**
 * The GitTree-Demo repository exactly as `git log --all --topo-order` emits it
 * — the history in the screenshot where five branch rails stopped in mid-air
 * beside `main` instead of joining it.
 */
const DEMO: Commit[] = [
  commit('7411e38', ['9243df9', 'aaa6574']), // stash
  commit('aaa6574', ['9243df9']), // stash index
  commit('1bcbfa5', ['9243df9']), // demo/rebase-feature
  commit('9dbe4af', ['9243df9']), // demo/rebase-onto
  commit('147cdb0', ['9243df9']), // demo/conflict-mine
  commit('adb8ce5', ['9243df9']), // demo/conflict-theirs
  commit('9243df9', ['64dabe2']), // main
  commit('64dabe2', ['457d67c']),
  commit('457d67c', ['62eef15']),
  commit('62eef15', ['52b914f']),
  commit('52b914f', ['f1216cb']),
  commit('0a6f908', ['108dd62']), // bugfix/staging
  commit('108dd62', ['a5bcdac']),
  commit('a5bcdac', ['8dc67f5']),
  commit('8dc67f5', ['f1216cb']),
  commit('f1216cb'), // root
];

const index = (rows: readonly GraphRow[], hash: string): number => rows.findIndex((row) => row.hash === hash);

/**
 * The rendering invariant: every segment that reaches row `i + 1` either lands
 * on that row's node or carries on through the next gap. Anything else is a
 * rail that ends in mid-air.
 */
function danglingEnds(rows: readonly GraphRow[], segments: readonly RailSegment[]): string[] {
  const problems: string[] = [];
  for (const segment of segments) {
    const next = rows[segment.row + 1];
    if (!next || segment.toLane === next.lane) continue;
    const continues = segments.some((other) => other.row === segment.row + 1 && other.fromLane === segment.toLane);
    if (!continues) problems.push(`row ${segment.row}: lane ${segment.fromLane}→${segment.toLane} stops before ${next.hash}`);
  }
  return problems;
}

describe('railSegments — the demo history', () => {
  const rows = layoutGraph(DEMO);
  const segments = railSegments(rows, 0, rows.length - 1);

  it('leaves no rail ending in mid-air', () => {
    expect(danglingEnds(rows, segments)).toEqual([]);
  });

  it('bends every branch that shares main as a parent into main’s node', () => {
    const main = index(rows, '9243df9');
    const mainRow = rows[main]!;
    const arriving = segments.filter((segment) => segment.row === main - 1 && segment.toLane === mainRow.lane);

    // Five tips plus the stash's two rails all converge on 9243df9.
    expect(mainRow.incoming.length).toBeGreaterThan(1);
    expect(arriving).toHaveLength(mainRow.incoming.length);
    expect(new Set(arriving.map((segment) => segment.fromLane))).toEqual(new Set(mainRow.incoming));
  });

  it('joins the side branch back into the root commit', () => {
    const root = index(rows, 'f1216cb');
    const rootRow = rows[root]!;
    const arriving = segments.filter((segment) => segment.row === root - 1 && segment.toLane === rootRow.lane);
    expect(arriving).toHaveLength(2); // main's line and bugfix/staging's line
  });

  it('draws nothing below the root', () => {
    expect(segments.filter((segment) => segment.row === rows.length - 1)).toEqual([]);
  });

  it('gives every node except the tips a rail arriving from above', () => {
    const tips = new Set(['7411e38', '1bcbfa5', '9dbe4af', '147cdb0', 'adb8ce5', '0a6f908']);
    for (let row = 1; row < rows.length; row++) {
      const node = rows[row]!;
      const arriving = segments.some((segment) => segment.row === row - 1 && segment.toLane === node.lane);
      expect(arriving, node.hash).toBe(!tips.has(node.hash));
    }
  });
});

describe('railSegments — windowing', () => {
  const rows = layoutGraph(DEMO);

  it('still bends converging rails into the parent when their tips are outside the window', () => {
    // Only the gap directly above main is in view; every tip is above it.
    const main = index(rows, '9243df9');
    const segments = railSegments(rows, main - 1, main - 1);
    const arriving = segments.filter((segment) => segment.toLane === rows[main]!.lane);
    expect(arriving).toHaveLength(rows[main]!.incoming.length);
  });

  it('carries rails straight down past the last loaded row', () => {
    const partial = layoutGraph(DEMO.slice(0, 3));
    const segments = railSegments(partial, 0, partial.length - 1);
    const last = segments.filter((segment) => segment.row === partial.length - 1);
    expect(last.length).toBeGreaterThan(0);
    expect(last.every((segment) => segment.fromLane === segment.toLane)).toBe(true);
  });
});

describe('railSegments — simple shapes', () => {
  it('draws a linear history as one straight lane', () => {
    const rows = layoutGraph([commit('C', ['B']), commit('B', ['A']), commit('A')]);
    expect(railSegments(rows, 0, rows.length - 1)).toEqual([
      { row: 0, fromLane: 0, toLane: 0, color: rows[0]!.color },
      { row: 1, fromLane: 0, toLane: 0, color: rows[1]!.color },
    ]);
  });

  it('opens a merge’s second parent into its own lane and closes it at the fork point', () => {
    // M merges F into D; F and D both come from A.
    const rows = layoutGraph([
      commit('M', ['D', 'F']),
      commit('F', ['A']),
      commit('D', ['A']),
      commit('A'),
    ]);
    const segments = railSegments(rows, 0, rows.length - 1);
    expect(danglingEnds(rows, segments)).toEqual([]);
    expect(segments.filter((segment) => segment.row === 0).map((s) => [s.fromLane, s.toLane]).sort()).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });
});
