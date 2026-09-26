import { describe, expect, it } from 'vitest';
import type { FileChangeKind, StatusLetter } from '../src/shared/model';
import {
  buildFileTree,
  flattenFiles,
  folderPaths,
  sortFiles,
  type FileFolder,
  type FileNode,
  type ReviewFile,
} from '../src/webview/features/review/fileTree';
import { describeSide, fileState, type CellState } from '../src/webview/features/review/fileState';
import {
  dragPaths,
  emptySelection,
  pruneSelection,
  selectionReducer,
  type SelectionState,
} from '../src/webview/features/review/useFileSelection';

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

const LETTERS: readonly StatusLetter[] = ['.', 'M', 'T', 'A', 'D', 'R', 'C', 'U'];

function letter(char: string | undefined): StatusLetter {
  return LETTERS.find((candidate) => candidate === char) ?? '.';
}

/** Mirrors `parsers/status.ts`, so the fixtures are what the parser really emits. */
function kindFor(index: StatusLetter, worktree: StatusLetter): FileChangeKind {
  switch (index !== '.' ? index : worktree) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case 'U':
      return 'conflicted';
    default:
      return 'modified';
  }
}

/** A tracked path carrying the porcelain `XY` code `xy`. */
function tracked(path: string, xy: string, extra: Partial<ReviewFile> = {}): ReviewFile {
  const index = letter(xy[0]);
  const worktree = letter(xy[1]);

  return {
    path,
    index,
    worktree,
    kind: kindFor(index, worktree),
    staged: index !== '.',
    unstaged: worktree !== '.',
    conflicted: false,
    ...extra,
  };
}

/** Untracked and ignored records have no `XY` field at all; both letters stay `.`. */
function untracked(path: string, extra: Partial<ReviewFile> = {}): ReviewFile {
  return {
    path,
    index: '.',
    worktree: '.',
    kind: 'untracked',
    staged: false,
    unstaged: true,
    conflicted: false,
    ...extra,
  };
}

function ignored(path: string): ReviewFile {
  return {
    path,
    index: '.',
    worktree: '.',
    kind: 'ignored',
    staged: false,
    unstaged: false,
    conflicted: false,
  };
}

function conflicted(path: string, code = 'UU'): ReviewFile {
  return {
    path,
    index: letter(code[0]),
    worktree: letter(code[1]),
    kind: 'conflicted',
    staged: false,
    unstaged: true,
    conflicted: true,
    conflict: { code },
  };
}

/** Modelled on the reference change: a few deep C# projects and two loose files. */
const FILES: ReviewFile[] = [
  tracked('Insight.Api/Controllers/V1/CompanyController.cs', 'A.', { additions: 90, deletions: 0 }),
  tracked('Insight.Api/Controllers/V1/SurveyController.cs', 'MM', { additions: 12, deletions: 3 }),
  tracked('Insight.Api/Services/ICompanyService.cs', '.M', { additions: 5, deletions: 5 }),
  tracked('Insight.Core/Models/Company.cs', 'M.', { additions: 2, deletions: 1 }),
  tracked('Insight.Jobs/Sync/Handlers/Nightly/Runner.cs', 'M.', { additions: 8, deletions: 2 }),
  untracked('Insight.Jobs/Sync/Handlers/Nightly/scratch.log'),
  tracked('README.md', '.M', { additions: 1, deletions: 1 }),
  untracked('notes.md'),
];

function folderAt(nodes: readonly FileNode[], name: string): FileFolder | undefined {
  return nodes.find((node): node is FileFolder => node.kind === 'folder' && node.name === name);
}

function paths(files: readonly ReviewFile[]): string[] {
  return files.map((file) => file.path);
}

/* ------------------------------------------------------------------------ */
/* fileTree                                                                 */
/* ------------------------------------------------------------------------ */

describe('buildFileTree', () => {
  const tree = buildFileTree(FILES);

  it('groups files into folders by slash', () => {
    expect(folderAt(tree, 'Insight.Api')).toBeDefined();
    expect(folderAt(tree, 'Insight.Api')?.path).toBe('Insight.Api');
  });

  it('keeps a repo-root file as a top-level leaf', () => {
    const leaf = tree.find((node) => node.kind === 'leaf' && node.name === 'README.md');
    expect(leaf).toMatchObject({ kind: 'leaf', path: 'README.md' });
  });

  it('counts every file beneath a folder, not just direct children', () => {
    expect(folderAt(tree, 'Insight.Api')?.count).toBe(3);
  });

  it('rolls line counts up to every ancestor', () => {
    expect(folderAt(tree, 'Insight.Api')).toMatchObject({ additions: 107, deletions: 8 });

    const v1 = folderAt(folderAt(tree, 'Insight.Api')?.children ?? [], 'Controllers/V1');
    expect(v1).toMatchObject({ count: 2, additions: 102, deletions: 3 });
  });

  it('treats a file with no counts yet as zero rather than NaN', () => {
    // The counts come from a second git call; the tree has to render before it lands.
    const nightly = folderAt(tree, 'Insight.Jobs/Sync/Handlers/Nightly');
    expect(nightly).toMatchObject({ count: 2, additions: 8, deletions: 2 });

    const scratch = nightly?.children.find((node) => node.name === 'scratch.log');
    expect(scratch).toMatchObject({ additions: 0, deletions: 0 });
  });

  it('collapses a chain of single-child folders into one row', () => {
    // Four rows of indentation carrying one bit of information between them.
    const nightly = folderAt(tree, 'Insight.Jobs/Sync/Handlers/Nightly');
    expect(nightly?.path).toBe('Insight.Jobs/Sync/Handlers/Nightly');
    expect(nightly?.children.map((node) => node.name)).toEqual(['Runner.cs', 'scratch.log']);
  });

  it('stops collapsing where the chain branches', () => {
    // Insight.Api holds two folders, so it stays its own row; Controllers holds
    // only V1, so those two merge.
    expect(folderAt(tree, 'Insight.Api/Controllers')).toBeUndefined();
    const api = folderAt(tree, 'Insight.Api');
    expect(api?.children.map((node) => node.name)).toEqual(['Controllers/V1', 'Services']);
  });

  it('does not collapse a folder whose only child is a file', () => {
    // That row is where the file's own row hangs.
    const services = folderAt(folderAt(tree, 'Insight.Api')?.children ?? [], 'Services');
    expect(services?.path).toBe('Insight.Api/Services');
    expect(services?.children).toHaveLength(1);
  });

  it('sorts folders before leaves, each by name', () => {
    expect(tree.map((node) => node.name)).toEqual([
      'Insight.Api',
      'Insight.Core/Models',
      'Insight.Jobs/Sync/Handlers/Nightly',
      'notes.md',
      'README.md',
    ]);
  });

  it('round-trips every file through flatten', () => {
    expect(flattenFiles(tree)).toHaveLength(FILES.length);
  });

  it('returns nothing for an empty file list', () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe('folderPaths', () => {
  const tree = buildFileTree(FILES);

  it('lists the rendered rows, not the segments a collapse swallowed', () => {
    // Expansion state keyed on `Insight.Api/Controllers` would target a row
    // that does not exist.
    expect(folderPaths(tree)).toEqual([
      'Insight.Api',
      'Insight.Api/Controllers/V1',
      'Insight.Api/Services',
      'Insight.Core/Models',
      'Insight.Jobs/Sync/Handlers/Nightly',
    ]);
  });
});

describe('sortFiles', () => {
  const MIXED: ReviewFile[] = [
    tracked('src/zeta.ts', 'M.'),
    tracked('src/nested/alpha.ts', 'M.'),
    tracked('app.ts', 'M.'),
  ];

  it('orders by path alphabetically, ignoring folder structure', () => {
    expect(paths(sortFiles(MIXED, 'path'))).toEqual([
      'app.ts',
      'src/nested/alpha.ts',
      'src/zeta.ts',
    ]);
  });

  it('puts folders before files at every level in tree mode', () => {
    expect(paths(sortFiles(MIXED, 'tree'))).toEqual([
      'src/nested/alpha.ts',
      'src/zeta.ts',
      'app.ts',
    ]);
  });

  it('matches the order the nested tree flattens to', () => {
    // Switching a view between flat and nested must not reorder the rows.
    expect(paths(sortFiles(FILES, 'tree'))).toEqual(paths(flattenFiles(buildFileTree(FILES))));
  });

  it('puts conflicts first and ignored last in status mode', () => {
    const files = [
      untracked('z-new.txt'),
      tracked('b.ts', 'M.'),
      conflicted('a-conflict.ts'),
      tracked('c.ts', 'A.'),
      ignored('build.log'),
    ];

    expect(paths(sortFiles(files, 'status'))).toEqual([
      'a-conflict.ts',
      'c.ts',
      'b.ts',
      'z-new.txt',
      'build.log',
    ]);
  });

  it('breaks status ties by path, so equal kinds keep a stable order', () => {
    const files = [tracked('b.ts', 'M.'), tracked('a.ts', 'M.')];
    expect(paths(sortFiles(files, 'status'))).toEqual(['a.ts', 'b.ts']);
  });

  it('orders names that differ only by case deterministically', () => {
    // Both can exist in one tree; a comparator that calls them equal lets the
    // sort place them differently from one refresh to the next.
    const forward = sortFiles([tracked('README.md', 'M.'), tracked('readme.md', 'M.')], 'path');
    const backward = sortFiles([tracked('readme.md', 'M.'), tracked('README.md', 'M.')], 'path');
    expect(paths(forward)).toEqual(paths(backward));
  });

  it('leaves the array it was given untouched', () => {
    const input = [...MIXED];
    sortFiles(input, 'path');
    expect(paths(input)).toEqual(paths(MIXED));
  });
});

/* ------------------------------------------------------------------------ */
/* fileState — the XY matrix                                                */
/* ------------------------------------------------------------------------ */

describe('fileState', () => {
  it('lights both cells for a partly staged file', () => {
    // `MM` — staged, then edited again. The case the old inspector got wrong:
    // it showed the same file twice with no sign the rows were related.
    expect(fileState(tracked('src/app.ts', 'MM'))).toEqual({
      index: 'on',
      worktree: 'on',
      bothSides: true,
    });
  });

  const MATRIX: Array<[string, CellState, CellState, boolean]> = [
    ['M.', 'on', 'off', false],
    ['.M', 'off', 'on', false],
    ['MM', 'on', 'on', true],
    ['A.', 'on', 'off', false],
    ['AM', 'on', 'on', true],
    ['AD', 'on', 'on', true],
    ['D.', 'on', 'off', false],
    ['.D', 'off', 'on', false],
    ['R.', 'on', 'off', false],
    ['RM', 'on', 'on', true],
    ['RD', 'on', 'on', true],
    ['C.', 'on', 'off', false],
    ['T.', 'on', 'off', false],
    ['.T', 'off', 'on', false],
    ['MD', 'on', 'on', true],
    ['..', 'off', 'off', false],
  ];

  it.each(MATRIX)('reads %s as index %s / worktree %s', (xy, index, worktree, bothSides) => {
    expect(fileState(tracked('src/app.ts', xy))).toEqual({ index, worktree, bothSides });
  });

  it('lights a cell exactly when its own side of the code is modified', () => {
    const ordinary = LETTERS.filter((value) => value !== 'U');

    for (const x of ordinary) {
      for (const y of ordinary) {
        const cells = fileState(tracked('src/app.ts', `${x}${y}`));
        expect({ code: `${x}${y}`, ...cells }).toEqual({
          code: `${x}${y}`,
          index: x === '.' ? 'off' : 'on',
          worktree: y === '.' ? 'off' : 'on',
          bothSides: x !== '.' && y !== '.',
        });
      }
    }
  });

  it('shows an untracked file as unstaged, despite both letters being "."', () => {
    const file = untracked('notes.md');
    // Pinning the trap: the letters really are unmodified on both sides.
    expect([file.index, file.worktree]).toEqual(['.', '.']);
    expect(fileState(file)).toEqual({ index: 'off', worktree: 'on', bothSides: false });
  });

  it('shows an ignored file as pending on neither side', () => {
    expect(fileState(ignored('build.log'))).toEqual({
      index: 'off',
      worktree: 'off',
      bothSides: false,
    });
  });

  it.each(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'])(
    'renders the %s conflict as conflicted on both cells, never on or off',
    (code) => {
      const cells = fileState(conflicted('src/merge.ts', code));
      expect(cells).toEqual({ index: 'conflict', worktree: 'conflict', bothSides: false });
    },
  );

  it('treats a conflict flag as authoritative even if the letters look ordinary', () => {
    const file: ReviewFile = { ...tracked('src/merge.ts', 'AA'), conflicted: true };
    expect(fileState(file).index).toBe('conflict');
  });

  it('never reports bothSides for a conflict, which is neither side', () => {
    expect(fileState(conflicted('src/merge.ts')).bothSides).toBe(false);
  });
});

describe('describeSide', () => {
  it('names each side of a partly staged file separately', () => {
    const file = tracked('src/app.ts', 'MM');
    expect(describeSide(file, 'index')).toBe('staged: modified');
    expect(describeSide(file, 'worktree')).toBe('not staged: modified');
  });

  it('describes an empty cell as empty, per side', () => {
    expect(describeSide(tracked('src/app.ts', 'M.'), 'worktree')).toBe('nothing unstaged');
    expect(describeSide(tracked('src/app.ts', '.M'), 'index')).toBe('nothing staged');
  });

  it('uses the change letter of the side asked about, not the file kind', () => {
    // `AD`: added to the index, then deleted from the working tree.
    const file = tracked('src/app.ts', 'AD');
    expect(describeSide(file, 'index')).toBe('staged: added');
    expect(describeSide(file, 'worktree')).toBe('not staged: deleted');
  });

  it('names the source path of a rename, which the tree has no room for', () => {
    const file = tracked('src/new.ts', 'R.', { origPath: 'src/old.ts' });
    expect(describeSide(file, 'index')).toBe('staged: renamed from src/old.ts');
  });

  it('falls back to the bare verb when a rename has no source path', () => {
    expect(describeSide(tracked('src/new.ts', 'C.'), 'index')).toBe('staged: copied');
  });

  it('describes an untracked file', () => {
    expect(describeSide(untracked('notes.md'), 'worktree')).toBe('not staged: untracked');
    expect(describeSide(untracked('notes.md'), 'index')).toBe('nothing staged');
  });

  it('reads a conflict code in plain English on both cells', () => {
    const file = conflicted('src/merge.ts', 'UU');
    expect(describeSide(file, 'index')).toBe('conflicted: both modified');
    expect(describeSide(file, 'worktree')).toBe('conflicted: both modified');
    expect(describeSide(conflicted('src/merge.ts', 'DU'), 'index')).toBe('conflicted: deleted by us');
    expect(describeSide(conflicted('src/merge.ts', 'AA'), 'index')).toBe('conflicted: both added');
  });

  it('degrades to "unmerged" for a code it does not know', () => {
    expect(describeSide(conflicted('src/merge.ts', 'ZZ'), 'index')).toBe('conflicted: unmerged');
  });

  it('describes a type change in words rather than a letter', () => {
    expect(describeSide(tracked('src/link', '.T'), 'worktree')).toBe('not staged: type changed');
  });
});

/* ------------------------------------------------------------------------ */
/* selection                                                                */
/* ------------------------------------------------------------------------ */

/** Staged rows first, then unstaged — one flat list, as the pane renders it. */
const ORDER = [
  'src/staged-one.ts',
  'src/staged-two.ts',
  /* group boundary */
  'src/unstaged-one.ts',
  'src/unstaged-two.ts',
  'src/unstaged-three.ts',
];

function click(
  state: SelectionState,
  path: string,
  modifiers: { ctrl?: boolean; shift?: boolean } = {},
  order: readonly string[] = ORDER,
): SelectionState {
  return selectionReducer(
    state,
    { type: 'click', path, ctrl: modifiers.ctrl, shift: modifiers.shift },
    order,
  );
}

function selected(state: SelectionState): string[] {
  return [...state.selected];
}

describe('selectionReducer', () => {
  it('selects just the clicked row on a plain click, and anchors there', () => {
    const state = click(emptySelection(), 'src/staged-two.ts');
    expect(selected(state)).toEqual(['src/staged-two.ts']);
    expect(state.anchor).toBe('src/staged-two.ts');
  });

  it('replaces the whole selection on a plain click', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/unstaged-one.ts', { ctrl: true });
    state = click(state, 'src/unstaged-two.ts');
    expect(selected(state)).toEqual(['src/unstaged-two.ts']);
  });

  it('adds a row with ctrl and moves the anchor to it', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/unstaged-one.ts', { ctrl: true });
    expect(selected(state)).toEqual(['src/staged-one.ts', 'src/unstaged-one.ts']);
    expect(state.anchor).toBe('src/unstaged-one.ts');
  });

  it('removes an already-selected row with ctrl, still moving the anchor', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/unstaged-one.ts', { ctrl: true });
    state = click(state, 'src/staged-one.ts', { ctrl: true });
    expect(selected(state)).toEqual(['src/unstaged-one.ts']);
    expect(state.anchor).toBe('src/staged-one.ts');
  });

  it('selects the inclusive range on shift, forwards', () => {
    let state = click(emptySelection(), 'src/staged-two.ts');
    state = click(state, 'src/unstaged-one.ts', { shift: true });
    expect(selected(state)).toEqual(['src/staged-two.ts', 'src/unstaged-one.ts']);
  });

  it('selects the inclusive range on shift, backwards', () => {
    let state = click(emptySelection(), 'src/unstaged-two.ts');
    state = click(state, 'src/staged-two.ts', { shift: true });
    expect(selected(state)).toEqual([
      'src/staged-two.ts',
      'src/unstaged-one.ts',
      'src/unstaged-two.ts',
    ]);
  });

  it('ranges across the staged/unstaged boundary, because the order is flat', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/unstaged-three.ts', { shift: true });
    expect(selected(state)).toEqual(ORDER);
  });

  it('re-ranges from the same anchor instead of accumulating', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/unstaged-two.ts', { shift: true });
    state = click(state, 'src/staged-two.ts', { shift: true });
    expect(selected(state)).toEqual(['src/staged-one.ts', 'src/staged-two.ts']);
    expect(state.anchor).toBe('src/staged-one.ts');
  });

  it('adds the range to the existing selection with ctrl+shift', () => {
    let state = click(emptySelection(), 'src/unstaged-three.ts');
    state = click(state, 'src/staged-one.ts', { ctrl: true });
    state = click(state, 'src/staged-two.ts', { ctrl: true, shift: true });
    expect(selected(state).sort()).toEqual([
      'src/staged-one.ts',
      'src/staged-two.ts',
      'src/unstaged-three.ts',
    ]);
  });

  it('behaves as a plain click when shift is held with no anchor', () => {
    const state = click(emptySelection(), 'src/unstaged-two.ts', { shift: true });
    expect(selected(state)).toEqual(['src/unstaged-two.ts']);
    expect(state.anchor).toBe('src/unstaged-two.ts');
  });

  it('behaves as a plain click when the anchor has gone from the list', () => {
    // Its file was committed away between the two clicks; ranging from where it
    // used to be would select a span the user never pointed at.
    let state = click(emptySelection(), 'src/staged-one.ts');
    const survivors = ORDER.filter((path) => path !== 'src/staged-one.ts');
    state = click(state, 'src/unstaged-two.ts', { shift: true }, survivors);
    expect(selected(state)).toEqual(['src/unstaged-two.ts']);
  });

  it('behaves as a plain click when the clicked row is not in the list', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = click(state, 'src/ghost.ts', { shift: true });
    expect(selected(state)).toEqual(['src/ghost.ts']);
  });

  it('clears the selection and the anchor', () => {
    let state = click(emptySelection(), 'src/staged-one.ts');
    state = selectionReducer(state, { type: 'clear' }, ORDER);
    expect(selected(state)).toEqual([]);
    expect(state.anchor).toBeUndefined();
  });

  it('returns the identical state when clearing an empty selection', () => {
    const state = emptySelection();
    expect(selectionReducer(state, { type: 'clear' }, ORDER)).toBe(state);
  });

  it('replaces everything on set, anchoring at the last path', () => {
    let state = click(emptySelection(), 'src/unstaged-three.ts');
    state = selectionReducer(state, { type: 'set', paths: ORDER.slice(0, 2) }, ORDER);
    expect(selected(state)).toEqual(['src/staged-one.ts', 'src/staged-two.ts']);
    expect(state.anchor).toBe('src/staged-two.ts');
  });

  it('sets an empty selection without an anchor', () => {
    const state = selectionReducer(emptySelection(), { type: 'set', paths: [] }, ORDER);
    expect(selected(state)).toEqual([]);
    expect(state.anchor).toBeUndefined();
  });

  it('never mutates the state it is given', () => {
    const state: SelectionState = {
      selected: new Set(['src/staged-one.ts']),
      anchor: 'src/staged-one.ts',
    };

    const ranged = click(state, 'src/unstaged-two.ts', { shift: true });
    click(state, 'src/staged-two.ts', { ctrl: true });
    selectionReducer(state, { type: 'clear' }, ORDER);

    expect(selected(state)).toEqual(['src/staged-one.ts']);
    expect(state.anchor).toBe('src/staged-one.ts');
    expect(ranged.selected).not.toBe(state.selected);
  });
});

describe('pruneSelection', () => {
  it('drops paths that are no longer listed', () => {
    const state: SelectionState = {
      selected: new Set(['src/staged-one.ts', 'src/committed.ts']),
      anchor: 'src/staged-one.ts',
    };

    expect(selected(pruneSelection(state, ORDER))).toEqual(['src/staged-one.ts']);
  });

  it('drops an anchor whose row has gone', () => {
    const state: SelectionState = { selected: new Set(), anchor: 'src/committed.ts' };
    expect(pruneSelection(state, ORDER).anchor).toBeUndefined();
  });

  it('returns the identical state when everything is still listed', () => {
    // A refresh that removed nothing must not force a re-render.
    const state: SelectionState = {
      selected: new Set(['src/staged-one.ts']),
      anchor: 'src/staged-one.ts',
    };

    expect(pruneSelection(state, ORDER)).toBe(state);
  });
});

describe('dragPaths', () => {
  it('drags the whole selection when the row is part of it', () => {
    const state = selectionReducer(
      emptySelection(),
      { type: 'set', paths: ['src/unstaged-two.ts', 'src/staged-one.ts'] },
      ORDER,
    );

    // In display order, not selection order.
    expect(dragPaths(state.selected, 'src/staged-one.ts', ORDER)).toEqual([
      'src/staged-one.ts',
      'src/unstaged-two.ts',
    ]);
  });

  it('drags only the row itself when it is not selected', () => {
    // Otherwise a drag quietly stages files selected minutes ago and forgotten.
    const state = click(emptySelection(), 'src/staged-one.ts');
    expect(dragPaths(state.selected, 'src/unstaged-two.ts', ORDER)).toEqual([
      'src/unstaged-two.ts',
    ]);
  });
});
