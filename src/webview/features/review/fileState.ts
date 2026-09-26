import type { FileStatus, StatusLetter } from '@shared/model';

/**
 * The two-cell index/worktree indicator model.
 *
 * Git gives every path *two* statuses — one in the index, one in the working
 * tree — and porcelain v2's `XY` field says so directly. GitTree parses both
 * into `FileStatus.index` and `FileStatus.worktree` and the old inspector then
 * threw the distinction away, which is why a partially staged file appeared
 * twice with identical styling and no hint that the two rows were the same
 * file. This module is the whole of that decision: which cell is lit, and what
 * each lit cell means in words.
 */

/**
 * One cell of the pill. `conflict` is a third state rather than "both on",
 * because an unmerged path is not staged *and* unstaged — it is neither.
 */
export type CellState = 'off' | 'on' | 'conflict';

export type FileSide = 'index' | 'worktree';

export interface FileCells {
  index: CellState;
  worktree: CellState;
  /**
   * True when the path is staged *and* has further edits in the working tree —
   * the case the pill exists for, and the one the cross-reference tag
   * (`also unstaged`) annotates.
   */
  bothSides: boolean;
}

export function fileState(file: FileStatus): FileCells {
  // An unmerged path is neither staged nor unstaged: its index holds up to
  // three competing stages, and `git add` on it means "I resolved this", not
  // "stage this side". Lighting either cell would invite exactly the wrong
  // action, so conflicts get their own state and never on/off.
  if (file.conflicted || file.kind === 'conflicted' || file.index === 'U' || file.worktree === 'U') {
    return { index: 'conflict', worktree: 'conflict', bothSides: false };
  }

  // Porcelain v2 reports an untracked path as a `?` record with no `XY` field
  // at all, so the parser leaves both letters `.`. Deriving the cells from the
  // letters alone would show the one file users most expect to see — the one
  // they just created — as having no changes anywhere.
  if (file.kind === 'untracked') {
    return { index: 'off', worktree: 'on', bothSides: false };
  }

  // Same shape, opposite meaning: an ignored path is listed so it can be found,
  // not because anything is pending on either side.
  if (file.kind === 'ignored') {
    return { index: 'off', worktree: 'off', bothSides: false };
  }

  const index: CellState = file.index === '.' ? 'off' : 'on';
  const worktree: CellState = file.worktree === '.' ? 'off' : 'on';
  return { index, worktree, bothSides: index === 'on' && worktree === 'on' };
}

/**
 * A short human phrase for one cell's tooltip: `staged: modified`,
 * `not staged: modified`, `conflicted: both modified`.
 *
 * "not staged" rather than "unstaged" because unstage is also a verb here — the
 * right cell is the control that performs it — and a tooltip reading
 * "unstaged: modified" over a button that unstages is ambiguous about whether
 * it describes the state or the action.
 */
export function describeSide(file: FileStatus, side: FileSide): string {
  const cells = fileState(file);
  const cell = side === 'index' ? cells.index : cells.worktree;

  if (cell === 'conflict') return `conflicted: ${describeConflict(file)}`;
  if (cell === 'off') return side === 'index' ? 'nothing staged' : 'nothing unstaged';
  if (file.kind === 'untracked') return 'not staged: untracked';

  const change = describeLetter(side === 'index' ? file.index : file.worktree, file);
  return side === 'index' ? `staged: ${change}` : `not staged: ${change}`;
}

function describeLetter(letter: StatusLetter, file: FileStatus): string {
  switch (letter) {
    case 'M':
      return 'modified';
    case 'T':
      return 'type changed';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    // The source path is the whole point of a rename row, and the tooltip is
    // the only place it fits once the tree has shortened the path to a name.
    case 'R':
      return file.origPath ? `renamed from ${file.origPath}` : 'renamed';
    case 'C':
      return file.origPath ? `copied from ${file.origPath}` : 'copied';
    case 'U':
      return 'unmerged';
    case '.':
      return 'unchanged';
  }
}

/**
 * Plain-English reading of an unmerged path's two-letter code.
 *
 * `us` and `them` are git's own words for the two sides of a merge, kept
 * deliberately: the user will meet them again in `git checkout --ours`.
 */
function describeConflict(file: FileStatus): string {
  const code = file.conflict?.code ?? `${file.index}${file.worktree}`;

  switch (code) {
    case 'DD':
      return 'both deleted';
    case 'AU':
      return 'added by us';
    case 'UD':
      return 'deleted by them';
    case 'UA':
      return 'added by them';
    case 'DU':
      return 'deleted by us';
    case 'AA':
      return 'both added';
    case 'UU':
      return 'both modified';
    default:
      return 'unmerged';
  }
}
