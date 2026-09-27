import { useCallback, useEffect, useState } from 'react';

/**
 * Pane geometry for the resizable working area.
 *
 * The arithmetic lives in pure functions rather than inside the splitter,
 * because the behaviour worth pinning down is all at the edges: a drag that
 * would push a neighbour under its minimum, a window narrower than the minimums
 * add up to, a collapse and re-expand that has to land back where it started.
 * None of that is worth exercising through a rendered component.
 *
 * Sizes are pixel widths, and `sizes` always sums to the width of the pane
 * area. Holding that invariant is what lets `toggleCollapse` know how much
 * space it is handing back without being told the container width again.
 */

/** Width a collapsed pane keeps, as a click-to-expand rail. */
export const RAIL_WIDTH = 28;

const STORAGE_KEY = 'gitTree.layout';
const STORAGE_VERSION = 2;

/**
 * Oldest payload this build still reads.
 *
 * v1 predates `pinned`. Refusing it would be defensible and wrong: the only
 * thing missing is one boolean per pane with an obvious default, and discarding
 * the payload over it also discards the widths the user dragged to — the part
 * that cost them something to get right.
 */
const MIN_READABLE_VERSION = 1;

/** Sub-pixel noise; anything smaller is floating point, not a real difference. */
const EPSILON = 1e-9;

/** A measured width this close to the current one is the layout we already have. */
const FIT_TOLERANCE = 0.5;

export interface LayoutState {
  /**
   * Rendered widths in px. Always sums to the pane area; a collapsed pane sits
   * at RAIL_WIDTH.
   */
  sizes: number[];
  /** Floor per pane while it is expanded. */
  mins: number[];
  /** Width a pane returns to when it is expanded again. */
  preferred: number[];
  collapsed: boolean[];
  /**
   * Whether each pane holds its place in the row.
   *
   * A pinned pane behaves as it always has. An unpinned one is a rail unless it
   * is being used, and opens *over* its neighbour rather than pushing it — so
   * the flag says nothing about `sizes`, which stay at the rail throughout.
   */
  pinned: boolean[];
}

/**
 * Starting geometry: branches, commit tree, review.
 *
 * Widths are absolute rather than fractions so a reset means the same thing at
 * any window size; the first `fit` scales them into the real container.
 *
 * Defaults: branches 180px, commit tree 250px, diff pane ~890px.
 * This maximizes diff visibility while keeping navigation and history accessible.
 */
export const DEFAULT_SIZES: readonly number[] = [180, 250, 890];
export const DEFAULT_MINS: readonly number[] = [120, 150, 260];

/** A fresh default state. A shared constant would be mutable across callers. */
export function defaultLayout(): LayoutState {
  return {
    sizes: [...DEFAULT_SIZES],
    mins: [...DEFAULT_MINS],
    preferred: [...DEFAULT_SIZES],
    collapsed: DEFAULT_SIZES.map(() => false),
    pinned: DEFAULT_SIZES.map(() => true),
  };
}

/* -------------------------------------------------------------------------- */
/* Pure geometry                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fits `sizes` into `total`, respecting `mins`.
 *
 * Free panes are scaled proportionally, anything landing under its floor is
 * pinned there, and the pass repeats. Scaling by size rather than by headroom
 * matters: it makes growing and shrinking exact inverses, which is what stops
 * the row drifting a few pixels every time a pane is collapsed and reopened.
 */
export function clampSizes(
  sizes: readonly number[],
  mins: readonly number[],
  total: number,
): number[] {
  const count = sizes.length;
  if (count === 0) return [];

  const floors = Array.from({ length: count }, (_, index) => Math.max(finite(mins[index], 0), 0));
  const floorTotal = floors.reduce(add, 0);

  // A split editor can be narrower than the minimums add up to. Honouring them
  // would overflow the row and push the last pane off the edge, so they scale
  // down together instead: every pane stays visible, just tighter.
  if (!(total > floorTotal)) {
    const scaled =
      floorTotal <= 0
        ? floors.map(() => total / count)
        : floors.map((floor) => (floor / floorTotal) * total);
    return settleResidual(scaled, total);
  }

  const result = sizes.map((size, index) => Math.max(finite(size, floors[index] ?? 0), 0));
  const pinned = new Array<boolean>(count).fill(false);

  // Each pass pins at least one pane, so `count` passes always reach a fixed
  // point; the extra iteration is the one that finds nothing left to pin.
  for (let pass = 0; pass <= count; pass++) {
    let budget = total;
    let freeTotal = 0;
    let freeCount = 0;

    for (let index = 0; index < count; index++) {
      const size = result[index] ?? 0;
      if (pinned[index] === true) {
        budget -= size;
      } else {
        freeTotal += size;
        freeCount++;
      }
    }

    if (freeCount === 0) break;

    for (let index = 0; index < count; index++) {
      if (pinned[index] === true) continue;
      const size = result[index] ?? 0;
      result[index] = freeTotal > EPSILON ? size * (budget / freeTotal) : budget / freeCount;
    }

    let pinnedAny = false;
    for (let index = 0; index < count; index++) {
      const floor = floors[index] ?? 0;
      if (pinned[index] === true || (result[index] ?? 0) >= floor - EPSILON) continue;
      result[index] = floor;
      pinned[index] = true;
      pinnedAny = true;
    }

    if (!pinnedAny) break;
  }

  return settleResidual(result, total);
}

/**
 * Moves the boundary between pane `index` and the one after it by `deltaPx`.
 *
 * Only those two panes move. Spreading the delta across the whole row is what
 * makes a splitter feel unhinged from the cursor.
 */
export function resizeAt(
  state: LayoutState,
  index: number,
  deltaPx: number,
  total: number,
): number[] {
  const sizes = state.sizes.slice();
  const left = sizes[index];
  const right = sizes[index + 1];
  if (left === undefined || right === undefined || !Number.isFinite(deltaPx)) return sizes;

  // A handle beside a collapsed pane is an expand affordance, not a splitter;
  // dragging it would silently widen a pane that is meant to be a rail.
  if (state.collapsed[index] === true || state.collapsed[index + 1] === true) return sizes;

  const minLeft = Math.max(finite(state.mins[index], 0), 0);
  const minRight = Math.max(finite(state.mins[index + 1], 0), 0);
  const pair = left + right;

  const nextLeft = Math.max(minLeft, Math.min(left + deltaPx, pair - minRight));
  sizes[index] = nextLeft;
  sizes[index + 1] = pair - nextLeft;

  return clampSizes(sizes, effectiveMins(state), total);
}

/** Collapses an expanded pane to its rail, or restores a collapsed one. */
export function toggleCollapse(state: LayoutState, index: number): LayoutState {
  const size = state.sizes[index];
  if (size === undefined) return state;

  const total = state.sizes.reduce(add, 0);
  const sizes = state.sizes.slice();
  const preferred = state.preferred.slice();
  const collapsed = state.collapsed.slice();
  const min = Math.max(finite(state.mins[index], 0), 0);

  if (collapsed[index] === true) {
    collapsed[index] = false;
    // The other panes still have to fit beside it, so an expand can only be
    // granted as much as their minimums leave over.
    const room = total - otherMinTotal(state, index);
    sizes[index] = Math.min(Math.max(finite(preferred[index], min), min), Math.max(min, room));
  } else {
    collapsed[index] = true;
    // Remembered on the way down rather than read from a default on the way up,
    // so a pane reopens at the width the user last dragged it to.
    preferred[index] = size;
    sizes[index] = RAIL_WIDTH;
  }

  const next: LayoutState = { ...state, sizes, preferred, collapsed };
  return { ...next, sizes: settleAround(next, index, total) };
}

/**
 * Turns a pane's pin on or off, and moves it to where that leaves it.
 *
 * Unpinning is a request for the pane to get out of the way, so it goes to its
 * rail in the same gesture. Waiting for the pointer to leave would mean waiting
 * forever on the click that asked for it, since the pointer is on the pin.
 *
 * Both directions route through `toggleCollapse` so the remembered width and the
 * invariant that `sizes` sums to the row stay in one place.
 */
export function togglePin(state: LayoutState, index: number): LayoutState {
  const current = state.pinned[index];
  if (current === undefined) return state;

  const nowPinned = !current;
  const pinned = state.pinned.slice();
  pinned[index] = nowPinned;
  const next: LayoutState = { ...state, pinned };

  // An unpinned pane belongs at its rail, a pinned one belongs open.
  return state.collapsed[index] === !nowPinned ? next : toggleCollapse(next, index);
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/** The persisted arrangement. Minimums are code, not user data, so they stay out. */
export function serializeLayout(state: LayoutState): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    sizes: state.sizes,
    preferred: state.preferred,
    collapsed: state.collapsed,
    pinned: state.pinned,
  });
}

/**
 * Restores a persisted arrangement, falling back whenever it cannot be trusted.
 *
 * Storage outlives the build that wrote it, so a payload carrying a different
 * number of panes describes a window that no longer exists. There is no sane
 * way to map it onto this one, and a half-applied layout is worse than the
 * default, so it is discarded whole.
 *
 * A field the payload predates is a different case entirely: it is filled from
 * the fallback rather than treated as corruption, which is what stops a version
 * bump from silently resetting everyone's pane widths.
 */
export function parseLayout(raw: string | null | undefined, fallback: LayoutState): LayoutState {
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (typeof parsed !== 'object' || parsed === null) return fallback;
  const record = parsed as Record<string, unknown>;

  const version = record['version'];
  // A payload from a build newer than this one may mean anything by its fields.
  if (typeof version !== 'number' || version < MIN_READABLE_VERSION || version > STORAGE_VERSION) {
    return fallback;
  }

  const count = fallback.sizes.length;
  const sizes = numberArray(record['sizes'], count);
  const preferred = numberArray(record['preferred'], count);
  const collapsed = booleanArray(record['collapsed'], count);
  // Absent since v1, and a pin preference is cheap to lose; the widths are not.
  const pinned =
    record['pinned'] === undefined
      ? fallback.pinned.slice()
      : booleanArray(record['pinned'], count);
  if (!sizes || !preferred || !collapsed || !pinned) return fallback;

  return { sizes, mins: fallback.mins.slice(), preferred, collapsed, pinned };
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface LayoutModel {
  sizes: readonly number[];
  mins: readonly number[];
  collapsed: readonly boolean[];
  pinned: readonly boolean[];
  /** Reset targets for a double-click or Home on a handle. */
  defaults: readonly number[];
  resize: (index: number, deltaPx: number) => void;
  toggle: (index: number) => void;
  togglePin: (index: number) => void;
  /** Reports the measured width of the pane area, handles excluded. */
  fit: (total: number) => void;
}

/**
 * Pane widths and collapsed flags, persisted across reloads.
 *
 * Persistence goes through localStorage rather than the webview state API on
 * purpose: `acquireVsCodeApi()` may be called exactly once per webview and the
 * RPC client already holds that single handle, so calling it again here would
 * throw during module load and take the whole view down with it. localStorage
 * is available inside a VS Code webview, is scoped to it, and holds precisely
 * this kind of view preference.
 */
export function useLayout(): LayoutModel {
  const [state, setState] = useState<LayoutState>(() => parseLayout(readStored(), defaultLayout()));

  // A drag produces a state change per pointer move; writing on each one would
  // hit storage sixty times a second for a value only the next reload reads.
  useEffect(() => {
    const timer = setTimeout(() => writeStored(serializeLayout(state)), 250);
    return () => clearTimeout(timer);
  }, [state]);

  const resize = useCallback((index: number, deltaPx: number) => {
    setState((current) => {
      const sizes = resizeAt(current, index, deltaPx, current.sizes.reduce(add, 0));
      // A drag held past a minimum asks for the same layout on every move;
      // returning the current state keeps React from re-rendering the panes.
      return sameSizes(sizes, current.sizes) ? current : { ...current, sizes };
    });
  }, []);

  const toggle = useCallback((index: number) => {
    setState((current) => toggleCollapse(current, index));
  }, []);

  const pin = useCallback((index: number) => {
    setState((current) => togglePin(current, index));
  }, []);

  const fit = useCallback((total: number) => {
    setState((current) => {
      if (!Number.isFinite(total) || total <= 0) return current;
      if (Math.abs(current.sizes.reduce(add, 0) - total) < FIT_TOLERANCE) return current;
      return { ...current, sizes: clampSizes(current.sizes, effectiveMins(current), total) };
    });
  }, []);

  return {
    sizes: state.sizes,
    mins: state.mins,
    collapsed: state.collapsed,
    pinned: state.pinned,
    defaults: DEFAULT_SIZES,
    resize,
    toggle,
    togglePin: pin,
    fit,
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

const add = (a: number, b: number): number => a + b;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Minimums as they apply right now: a collapsed pane is allowed to be a rail. */
function effectiveMins(state: LayoutState): number[] {
  return state.mins.map((min, index) =>
    state.collapsed[index] === true ? RAIL_WIDTH : Math.max(finite(min, 0), 0),
  );
}

function otherMinTotal(state: LayoutState, index: number): number {
  return effectiveMins(state).reduce((sum, min, at) => (at === index ? sum : sum + min), 0);
}

/** Fits every pane except `pinned` into what `pinned` leaves of `total`. */
function settleAround(state: LayoutState, pinned: number, total: number): number[] {
  const mins = effectiveMins(state);
  const others: number[] = [];
  const otherMins: number[] = [];
  const source: number[] = [];

  state.sizes.forEach((size, index) => {
    if (index === pinned) return;
    others.push(size);
    otherMins.push(mins[index] ?? 0);
    source.push(index);
  });

  const held = state.sizes[pinned] ?? 0;
  const settled = clampSizes(others, otherMins, total - held);
  const sizes = state.sizes.slice();
  source.forEach((index, position) => {
    sizes[index] = settled[position] ?? sizes[index] ?? 0;
  });

  return sizes;
}

/**
 * Parks the floating-point remainder on the widest pane.
 *
 * Proportional scaling leaves a fraction of a pixel behind, and the sum has to
 * stay exact or every operation drifts the row further off the container.
 */
function settleResidual(sizes: number[], total: number): number[] {
  const residual = total - sizes.reduce(add, 0);
  if (residual === 0 || sizes.length === 0) return sizes;

  let widest = 0;
  for (let index = 1; index < sizes.length; index++) {
    if ((sizes[index] ?? 0) > (sizes[widest] ?? 0)) widest = index;
  }

  sizes[widest] = (sizes[widest] ?? 0) + residual;
  return sizes;
}

function sameSizes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((size, index) => size === b[index]);
}

function numberArray(value: unknown, count: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== count) return undefined;
  // Array.isArray widens to any[]; naming the element type keeps the guards below honest.
  const entries: unknown[] = value;
  const result: number[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return undefined;
    result.push(entry);
  }

  return result;
}

function booleanArray(value: unknown, count: number): boolean[] | undefined {
  if (!Array.isArray(value) || value.length !== count) return undefined;
  const entries: unknown[] = value;
  const result: boolean[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'boolean') return undefined;
    result.push(entry);
  }

  return result;
}

/**
 * The storage backend, reached without naming a DOM type.
 *
 * This module's pure functions are unit-tested, and the test project compiles
 * under the extension host's tsconfig, which has no `lib.dom`. Referring to
 * `window` here therefore broke the *host* build — a real failure caught by
 * gating `npm run build` on `tsc --noEmit`, since esbuild and vite both erase
 * types without checking them.
 *
 * `globalThis` is in every lib, so the lookup type-checks everywhere and the
 * runtime guard covers the case where storage genuinely is not there.
 */
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): WebStorageLike | undefined {
  const candidate = (globalThis as { localStorage?: WebStorageLike }).localStorage;
  return typeof candidate?.getItem === 'function' ? candidate : undefined;
}

/** Storage is unavailable in some embeddings, where it throws rather than returning null. */
function readStored(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, value);
  } catch {
    // A lost layout preference is not worth interrupting anything over.
  }
}
