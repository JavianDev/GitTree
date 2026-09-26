import { describe, expect, it } from 'vitest';
import type { RefEntry } from '../src/shared/model';
import {
  buildRefTree,
  flattenRefs,
  folderPaths,
  recentRefs,
  type RefFolder,
} from '../src/webview/features/sidebar/BranchTree';
import { filterRefs, highlightSegments, matchRef } from '../src/webview/features/sidebar/RefFilter';

function branch(name: string, extra: Partial<RefEntry> = {}): RefEntry {
  return {
    kind: 'localBranch',
    name,
    fullName: `refs/heads/${name}`,
    oid: 'a'.repeat(40),
    isHead: false,
    ...extra,
  };
}

/** Modelled on the real workspace from the screenshot: many ticket branches. */
const REFS: RefEntry[] = [
  branch('dev'),
  branch('backup/pre-migration'),
  branch('backup/2026-07'),
  branch('bugfix/INST-10499-null-guard'),
  branch('bugfix/INST-10510-viewmore-bypass-fix'),
  branch('feature/9564-SearchCriteriaOptimization'),
  branch('feature/adaptive-sampling-implementation'),
  branch('feature/ApplicationLogsInDataDog'),
  branch('feature/INST-10234-survey-purchaser-aigc-access'),
  branch('feature/INST-10555-apim-pipeline-fix'),
  branch('feature/INST-11308-11309-11310-crm-decoupling-ingestion', { isHead: true }),
  branch('feature/nested/deeply/thing'),
  branch('chore/deps'),
];

describe('buildRefTree', () => {
  const tree = buildRefTree(REFS);
  const folder = (name: string) =>
    tree.find((node): node is RefFolder => node.kind === 'folder' && node.name === name);

  it('groups refs into folders by slash', () => {
    expect(folder('feature')).toBeDefined();
    expect(folder('bugfix')).toBeDefined();
    expect(folder('backup')).toBeDefined();
  });

  it('counts every ref beneath a folder, not just direct children', () => {
    // `feature` holds 7 leaves plus one under feature/nested/deeply.
    expect(folder('feature')?.count).toBe(7);
    expect(folder('bugfix')?.count).toBe(2);
  });

  it('nests folders to arbitrary depth', () => {
    const nested = folder('feature')?.children.find(
      (node): node is RefFolder => node.kind === 'folder' && node.name === 'nested',
    );
    const deeply = nested?.children.find(
      (node): node is RefFolder => node.kind === 'folder' && node.name === 'deeply',
    );

    expect(deeply?.children).toHaveLength(1);
    expect(deeply?.children[0]).toMatchObject({ kind: 'leaf', name: 'thing' });
  });

  it('keeps an unprefixed ref at the top level as a leaf', () => {
    expect(tree.find((node) => node.kind === 'leaf' && node.name === 'dev')).toBeDefined();
  });

  it('sorts folders before leaves, each alphabetically', () => {
    const names = tree.map((node) => node.name);
    const firstLeaf = tree.findIndex((node) => node.kind === 'leaf');
    const lastFolder = tree.map((n) => n.kind).lastIndexOf('folder');

    expect(lastFolder).toBeLessThan(firstLeaf);
    expect(names.slice(0, lastFolder + 1)).toEqual(['backup', 'bugfix', 'chore', 'feature']);
  });

  it('strips only the final segment into the leaf name', () => {
    const leaf = folder('feature')?.children.find(
      (node) => node.kind === 'leaf' && node.name.startsWith('INST-11308'),
    );
    expect(leaf).toMatchObject({ name: 'INST-11308-11309-11310-crm-decoupling-ingestion' });
  });

  it('round-trips every ref through flatten', () => {
    expect(flattenRefs(tree)).toHaveLength(REFS.length);
  });

  it('lists folder paths including nested ones', () => {
    expect(folderPaths(tree)).toEqual(
      expect.arrayContaining(['feature', 'feature/nested', 'feature/nested/deeply']),
    );
  });

  it('returns nothing for an empty ref list', () => {
    expect(buildRefTree([])).toEqual([]);
  });
});

describe('recentRefs', () => {
  it('orders by commit date, newest first', () => {
    const refs = [
      branch('old', { committedAt: '2026-01-01T00:00:00Z' }),
      branch('newest', { committedAt: '2026-08-20T00:00:00Z' }),
      branch('middle', { committedAt: '2026-05-01T00:00:00Z' }),
    ];

    expect(recentRefs(refs).map((r) => r.name)).toEqual(['newest', 'middle', 'old']);
  });

  it('excludes the checked-out branch, which has its own group', () => {
    const refs = [
      branch('current', { isHead: true, committedAt: '2026-08-20T00:00:00Z' }),
      branch('other', { committedAt: '2026-08-19T00:00:00Z' }),
    ];

    expect(recentRefs(refs).map((r) => r.name)).toEqual(['other']);
  });

  it('excludes tags and remote branches', () => {
    const refs = [
      branch('local', { committedAt: '2026-08-20T00:00:00Z' }),
      { ...branch('v1.0'), kind: 'tag' as const, committedAt: '2026-08-21T00:00:00Z' },
      { ...branch('origin/main'), kind: 'remoteBranch' as const, committedAt: '2026-08-22T00:00:00Z' },
    ];

    expect(recentRefs(refs).map((r) => r.name)).toEqual(['local']);
  });

  it('honours the requested count', () => {
    const refs = Array.from({ length: 10 }, (_, i) =>
      branch(`b${i}`, { committedAt: `2026-08-${10 + i}T00:00:00Z` }),
    );
    expect(recentRefs(refs, 3)).toHaveLength(3);
  });
});

describe('matchRef — the forty-branch problem', () => {
  const target = REFS.find((r) => r.name.includes('11308'))!;

  it('finds a branch by a bare ticket number buried in the path', () => {
    // Nobody types "feature/INST-" from memory; they type the ticket.
    expect(matchRef('11308', target)).toBeDefined();
  });

  it('matches a non-contiguous subsequence', () => {
    expect(matchRef('crmdecoup', target)).toBeDefined();
  });

  it('is case-insensitive', () => {
    expect(matchRef('CRM', target)).toBeDefined();
    expect(matchRef('applicationlogs', branch('feature/ApplicationLogsInDataDog'))).toBeDefined();
  });

  it('rejects a query whose characters are not all present in order', () => {
    expect(matchRef('zzz', target)).toBeUndefined();
    // Right characters, wrong order.
    expect(matchRef('80311', target)).toBeUndefined();
  });

  it('treats an empty query as matching everything', () => {
    expect(matchRef('', target)).toMatchObject({ positions: [] });
    expect(matchRef('   ', target)).toBeDefined();
  });

  it('reports positions that index into the ref name', () => {
    const match = matchRef('dev', branch('dev'))!;
    expect(match.positions).toEqual([0, 1, 2]);
  });
});

describe('filterRefs', () => {
  it('narrows a large list to the intended branch', () => {
    const matches = filterRefs('11308', REFS);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ref.name).toContain('11308');
  });

  it('ranks a contiguous match above a scattered one', () => {
    const refs = [branch('feature/a-b-c-k-u-p'), branch('backup/thing')];
    expect(filterRefs('backup', refs)[0]?.ref.name).toBe('backup/thing');
  });

  it('returns every ref for an empty query, unsorted', () => {
    expect(filterRefs('', REFS)).toHaveLength(REFS.length);
  });

  it('returns nothing when there is no match', () => {
    expect(filterRefs('qqqqqq', REFS)).toEqual([]);
  });

  it('prefers the checked-out branch among equal matches', () => {
    const refs = [branch('feature/x-thing'), branch('feature/x-other', { isHead: true })];
    expect(filterRefs('x', refs)[0]?.ref.isHead).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('splits a name into matched and unmatched runs', () => {
    expect(highlightSegments('backup', [0, 1, 2])).toEqual([
      { text: 'bac', matched: true },
      { text: 'kup', matched: false },
    ]);
  });

  it('handles a match in the middle', () => {
    expect(highlightSegments('abcd', [1, 2])).toEqual([
      { text: 'a', matched: false },
      { text: 'bc', matched: true },
      { text: 'd', matched: false },
    ]);
  });

  it('returns one unmatched run when nothing matched', () => {
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', matched: false }]);
  });

  it('reassembles into the original string', () => {
    const segments = highlightSegments('feature/INST-11308', [8, 9, 10, 11]);
    expect(segments.map((s) => s.text).join('')).toBe('feature/INST-11308');
  });
});
