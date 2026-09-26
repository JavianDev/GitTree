import { useCallback, useMemo, useReducer, useRef } from 'react';

/**
 * Multi-select for file rows, as a pure reducer with a thin hook over it.
 *
 * The reducer takes the visible row order as a third argument rather than
 * holding it in state: the order changes on every status refresh, and a
 * selection model that cached it would resolve a shift-range against rows that
 * are no longer on screen.
 */

export interface SelectionState {
  selected: Set<string>;
  /** Where the next shift-range starts. Survives shift-clicks, moves on plain and ctrl clicks. */
  anchor?: string;
}

export type SelectionAction =
  | { type: 'click'; path: string; ctrl?: boolean; shift?: boolean }
  | { type: 'clear' }
  | { type: 'set'; paths: readonly string[] };

export function emptySelection(): SelectionState {
  return { selected: new Set() };
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
  orderedPaths: readonly string[],
): SelectionState {
  switch (action.type) {
    case 'clear':
      return state.selected.size === 0 && state.anchor === undefined ? state : emptySelection();

    case 'set': {
      const paths = [...action.paths];
      // The anchor lands where the programmatic selection ended, so a
      // shift-click after "select all" extends from the last row rather than
      // silently collapsing the selection to one file.
      return { selected: new Set(paths), anchor: paths[paths.length - 1] };
    }

    case 'click': {
      if (action.shift) {
        const range = rangeFor(state, action.path, orderedPaths);
        if (range) {
          // Ctrl+Shift adds the range to what is already selected; Shift alone
          // replaces it, which is what makes repeated shift-clicks from one
          // anchor feel like dragging a boundary rather than accumulating.
          const selected = action.ctrl ? new Set([...state.selected, ...range]) : new Set(range);
          return { selected, anchor: state.anchor };
        }
        // No usable range: fall through to a plain click below.
      } else if (action.ctrl) {
        const selected = new Set(state.selected);
        // Toggling a row off still moves the anchor to it — the user's last
        // deliberate row is where they expect the next range to start.
        if (!selected.delete(action.path)) selected.add(action.path);
        return { selected, anchor: action.path };
      }

      return { selected: new Set([action.path]), anchor: action.path };
    }
  }
}

/**
 * The inclusive span between the anchor and the clicked row, or undefined when
 * there is no range to take.
 *
 * A range needs both ends on screen. With no anchor there is nothing to range
 * from; with a stale anchor — its file was committed away between the two
 * clicks — ranging from wherever it used to be would select a span the user
 * never pointed at. Both degrade to a plain click, which is recoverable.
 */
function rangeFor(
  state: SelectionState,
  path: string,
  orderedPaths: readonly string[],
): string[] | undefined {
  if (state.anchor === undefined) return undefined;

  const from = orderedPaths.indexOf(state.anchor);
  const to = orderedPaths.indexOf(path);
  if (from === -1 || to === -1) return undefined;

  // `orderedPaths` is flat across the Staged and Unstaged groups, so a range
  // that starts in one and ends in the other simply works.
  return from <= to ? orderedPaths.slice(from, to + 1) : orderedPaths.slice(to, from + 1);
}

/**
 * Drops paths that are no longer listed.
 *
 * Without this, committing leaves the selection pointing at files that have
 * ceased to exist, and the next "stage selected" or drag operates on ghosts.
 * The identical state is returned unchanged so a refresh that removed nothing
 * does not force a re-render.
 */
export function pruneSelection(
  state: SelectionState,
  orderedPaths: readonly string[],
): SelectionState {
  const visible = new Set(orderedPaths);
  const kept = [...state.selected].filter((path) => visible.has(path));
  const anchor = state.anchor !== undefined && visible.has(state.anchor) ? state.anchor : undefined;

  if (kept.length === state.selected.size && anchor === state.anchor) return state;
  return { selected: new Set(kept), anchor };
}

/**
 * What a drag starting on `path` should carry: the whole selection when the
 * row is part of it, and just that row when it is not — the file-manager rule,
 * and the one that keeps a drag from quietly staging files the user had
 * selected minutes ago and forgotten about. Ordered for display, so a drop
 * reports its paths the way they were listed.
 */
export function dragPaths(
  selected: ReadonlySet<string>,
  path: string,
  orderedPaths: readonly string[],
): string[] {
  if (!selected.has(path)) return [path];
  return orderedPaths.filter((candidate) => selected.has(candidate));
}

export interface SelectionModifiers {
  ctrl?: boolean;
  shift?: boolean;
}

export interface FileSelection {
  selected: ReadonlySet<string>;
  anchor?: string;
  isSelected: (path: string) => boolean;
  click: (path: string, modifiers?: SelectionModifiers) => void;
  clear: () => void;
  /** Replaces the selection outright — select-all, or restoring after a mutation. */
  select: (paths: readonly string[]) => void;
  /** Paths a drag from this row should carry. */
  dragging: (path: string) => string[];
}

export function useFileSelection(orderedPaths: readonly string[]): FileSelection {
  // The row order reaches the reducer through a ref rather than a closure.
  // `useReducer` only passes (state, action), and a reducer closing over the
  // order captured at mount would resolve a range against rows from before the
  // last refresh — the bug being avoided is a shift-click selecting a span the
  // user is no longer looking at.
  const orderRef = useRef(orderedPaths);
  orderRef.current = orderedPaths;

  const [state, dispatch] = useReducer(
    (current: SelectionState, action: SelectionAction) =>
      selectionReducer(current, action, orderRef.current),
    undefined,
    emptySelection,
  );

  const visible = useMemo(() => pruneSelection(state, orderedPaths), [state, orderedPaths]);

  const isSelected = useCallback((path: string) => visible.selected.has(path), [visible]);

  const click = useCallback((path: string, modifiers: SelectionModifiers = {}) => {
    dispatch({ type: 'click', path, ctrl: modifiers.ctrl, shift: modifiers.shift });
  }, []);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const select = useCallback((paths: readonly string[]) => dispatch({ type: 'set', paths }), []);

  const dragging = useCallback(
    (path: string) => dragPaths(visible.selected, path, orderRef.current),
    [visible],
  );

  return {
    selected: visible.selected,
    anchor: visible.anchor,
    isSelected,
    click,
    clear,
    select,
    dragging,
  };
}
