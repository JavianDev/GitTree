import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINS,
  RAIL_WIDTH,
  clampSizes,
  defaultLayout,
  parseLayout,
  resizeAt,
  serializeLayout,
  toggleCollapse,
  togglePin,
  type LayoutState,
} from '../src/webview/app/useLayout';

const TOTAL = 1000;

/** Three panes at the real proportions: branches, commit tree, review. */
function layout(sizes: number[], mins: number[] = [150, 240, 260]): LayoutState {
  return {
    sizes: [...sizes],
    mins: [...mins],
    preferred: [...sizes],
    collapsed: sizes.map(() => false),
    pinned: sizes.map(() => true),
  };
}

const sum = (sizes: readonly number[]): number => sizes.reduce((a, b) => a + b, 0);

function expectSizes(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((size, index) => expect(size).toBeCloseTo(expected[index]!, 6));
}

describe('clampSizes', () => {
  it('leaves a layout that already fits alone', () => {
    expectSizes(clampSizes([200, 500, 300], [150, 240, 260], TOTAL), [200, 500, 300]);
  });

  it('raises a pane to its minimum and takes the space from the others', () => {
    const sizes = clampSizes([50, 500, 450], [200, 200, 200], TOTAL);

    expect(sizes[0]).toBeCloseTo(200, 6);
    // The remaining 800 is split in the 500:450 ratio the caller asked for.
    expect(sizes[1]).toBeCloseTo((500 / 950) * 800, 6);
    expect(sizes[2]).toBeCloseTo((450 / 950) * 800, 6);
  });

  it('grows every pane proportionally when the container gets wider', () => {
    expectSizes(clampSizes([200, 500, 300], [150, 240, 260], 2000), [400, 1000, 600]);
  });

  it('scales the minimums down when the window cannot hold them', () => {
    // 400 x 3 will not fit in 600. Every pane stays visible rather than the
    // last one being squeezed out of existence.
    const sizes = clampSizes([500, 300, 200], [400, 400, 400], 600);

    expectSizes(sizes, [200, 200, 200]);
    expect(sum(sizes)).toBeCloseTo(600, 6);
  });

  it('substitutes the minimum for a size that is not a number', () => {
    const sizes = clampSizes([Number.NaN, 500, 300], [150, 240, 260], TOTAL);

    expect(Number.isFinite(sizes[0])).toBe(true);
    expect(sizes[0]).toBeGreaterThanOrEqual(150);
    expect(sum(sizes)).toBeCloseTo(TOTAL, 6);
  });

  it('never returns a pane below its minimum while there is room', () => {
    const mins = [150, 240, 260];
    const sizes = clampSizes([10, 10, 900], mins, TOTAL);

    sizes.forEach((size, index) => expect(size).toBeGreaterThanOrEqual(mins[index]! - 1e-6));
  });

  it('always sums to the total', () => {
    const cases: Array<[number[], number[], number]> = [
      [[200, 500, 300], [150, 240, 260], 1000],
      [[10, 10, 10], [150, 240, 260], 1000],
      [[900, 900, 900], [150, 240, 260], 400],
      [[0, 0, 0], [0, 0, 0], 300],
      [[248], [150], 700],
    ];

    for (const [sizes, mins, total] of cases) {
      expect(sum(clampSizes(sizes, mins, total))).toBeCloseTo(total, 6);
    }
  });

  it('returns nothing for no panes', () => {
    expect(clampSizes([], [], TOTAL)).toEqual([]);
  });
});

describe('resizeAt', () => {
  const state = layout([248, 452, 300]);

  it('moves the boundary by the delta and takes it from the neighbour', () => {
    expectSizes(resizeAt(state, 0, 60, TOTAL), [308, 392, 300]);
  });

  it('moves the boundary the other way too', () => {
    expectSizes(resizeAt(state, 1, -100, TOTAL), [248, 352, 400]);
  });

  it('stops at the neighbour minimum instead of pushing it under', () => {
    // 452 - 400 would leave the commit tree at 52, well under its 240 floor.
    const sizes = resizeAt(state, 0, 400, TOTAL);

    expect(sizes[1]).toBeCloseTo(240, 6);
    expect(sizes[0]).toBeCloseTo(460, 6);
    expect(sum(sizes)).toBeCloseTo(TOTAL, 6);
  });

  it('stops at its own minimum when dragged shut', () => {
    const sizes = resizeAt(state, 0, -500, TOTAL);

    expect(sizes[0]).toBeCloseTo(150, 6);
    expect(sizes[1]).toBeCloseTo(550, 6);
  });

  it('leaves panes beyond the boundary untouched', () => {
    expect(resizeAt(state, 0, 60, TOTAL)[2]).toBe(300);
  });

  it('refuses to drag a handle beside a collapsed pane', () => {
    const collapsed = toggleCollapse(state, 0);

    expect(resizeAt(collapsed, 0, 120, TOTAL)).toEqual(collapsed.sizes);
  });

  it('is a no-op past the last boundary', () => {
    expect(resizeAt(state, 2, 40, TOTAL)).toEqual(state.sizes);
    expect(resizeAt(state, -1, 40, TOTAL)).toEqual(state.sizes);
  });

  it('is a no-op for a delta that is not a number', () => {
    expect(resizeAt(state, 0, Number.NaN, TOTAL)).toEqual(state.sizes);
  });
});

describe('toggleCollapse', () => {
  const state = layout([248, 452, 300]);

  it('parks a collapsed pane at the rail width and hands the space to the others', () => {
    const collapsed = toggleCollapse(state, 0);

    expect(collapsed.collapsed[0]).toBe(true);
    expect(collapsed.sizes[0]).toBe(RAIL_WIDTH);
    expect(collapsed.sizes[1]).toBeGreaterThan(452);
    expect(collapsed.sizes[2]).toBeGreaterThan(300);
    expect(sum(collapsed.sizes)).toBeCloseTo(TOTAL, 6);
  });

  it('restores every pane to the width it had before collapsing', () => {
    const roundTrip = toggleCollapse(toggleCollapse(state, 0), 0);

    expect(roundTrip.collapsed[0]).toBe(false);
    expectSizes(roundTrip.sizes, state.sizes);
  });

  it('does not drift across repeated collapse cycles', () => {
    let current = state;
    for (let cycle = 0; cycle < 5; cycle++) {
      current = toggleCollapse(toggleCollapse(current, 1), 1);
    }

    expectSizes(current.sizes, state.sizes);
  });

  it('reopens at the width the user dragged to, not at the default', () => {
    const dragged: LayoutState = { ...state, sizes: resizeAt(state, 0, 100, TOTAL) };
    const roundTrip = toggleCollapse(toggleCollapse(dragged, 0), 0);

    expect(roundTrip.sizes[0]).toBeCloseTo(348, 6);
  });

  it('caps an expand at the room the other minimums leave', () => {
    // A pane remembered at 900 cannot come back to 900 when 500 of the row is
    // spoken for by the other two minimums.
    const cramped: LayoutState = {
      ...layout([RAIL_WIDTH, 472, 500], [100, 240, 260]),
      preferred: [900, 472, 500],
      collapsed: [true, false, false],
    };

    const expanded = toggleCollapse(cramped, 0);

    expect(expanded.sizes[0]).toBeCloseTo(500, 6);
    expect(expanded.sizes[1]).toBeCloseTo(240, 6);
    expect(expanded.sizes[2]).toBeCloseTo(260, 6);
    expect(sum(expanded.sizes)).toBeCloseTo(TOTAL, 6);
  });

  it('keeps the sum on the total in every collapsed combination', () => {
    for (let mask = 0; mask < 8; mask++) {
      let current = state;
      for (let index = 0; index < 3; index++) {
        if ((mask & (1 << index)) !== 0) current = toggleCollapse(current, index);
      }

      expect(sum(current.sizes)).toBeCloseTo(TOTAL, 6);
      current.sizes.forEach((size) => expect(size).toBeGreaterThanOrEqual(RAIL_WIDTH));
    }
  });

  it('is a no-op for an index that is not a pane', () => {
    expect(toggleCollapse(state, 7)).toBe(state);
  });
});

describe('togglePin', () => {
  const state = layout([248, 452, 300]);

  it('starts every pane pinned', () => {
    expect(defaultLayout().pinned).toEqual([true, true, true, true]);
  });

  it('sends a pane to its rail as it is unpinned', () => {
    const unpinned = togglePin(state, 0);

    expect(unpinned.pinned[0]).toBe(false);
    expect(unpinned.collapsed[0]).toBe(true);
    expect(unpinned.sizes[0]).toBe(RAIL_WIDTH);
    expect(sum(unpinned.sizes)).toBeCloseTo(TOTAL, 6);
  });

  it('brings the pane back to the width it was unpinned at', () => {
    const roundTrip = togglePin(togglePin(state, 1), 1);

    expect(roundTrip.pinned[1]).toBe(true);
    expect(roundTrip.collapsed[1]).toBe(false);
    expectSizes(roundTrip.sizes, state.sizes);
  });

  it('leaves a pane that is already a rail where it is', () => {
    const collapsed = toggleCollapse(state, 0);
    const unpinned = togglePin(collapsed, 0);

    expect(unpinned.collapsed[0]).toBe(true);
    expectSizes(unpinned.sizes, collapsed.sizes);
  });

  it('opens a railed pane when it is pinned again', () => {
    // Otherwise pinning a rail changes a glyph and nothing else, which reads as
    // a control that did not work.
    const railed = togglePin(toggleCollapse(state, 0), 0);

    expect(togglePin(railed, 0).collapsed[0]).toBe(false);
  });

  it('touches only the pane it is given', () => {
    expect(togglePin(state, 1).pinned).toEqual([true, false, true]);
  });

  it('is a no-op for an index that is not a pane', () => {
    expect(togglePin(state, 7)).toBe(state);
  });
});

describe('parseLayout', () => {
  // A three-pane window, so these pin down parsing itself independently of how
  // many panes the real window has. The real four-pane window and its
  // migration from three are covered separately below.
  const fallback = layout([180, 250, 890], [120, 150, 260]);

  it('restores what was written', () => {
    const saved = toggleCollapse(layout([300, 400, 300]), 2);
    const restored = parseLayout(serializeLayout(saved), fallback);

    expectSizes(restored.sizes, saved.sizes);
    expect(restored.collapsed).toEqual(saved.collapsed);
    expect(restored.preferred).toEqual(saved.preferred);
  });

  it('takes minimums from the code, never from storage', () => {
    const tampered = JSON.stringify({
      version: 1,
      sizes: [300, 400, 300],
      preferred: [300, 400, 300],
      collapsed: [false, false, false],
      mins: [900, 900, 900],
    });

    expect(parseLayout(tampered, fallback).mins).toEqual([120, 150, 260]);
  });

  it('falls back when the pane count changed since the layout was saved', () => {
    const twoPanes = JSON.stringify({
      version: 1,
      sizes: [400, 600],
      preferred: [400, 600],
      collapsed: [false, false],
    });

    expect(parseLayout(twoPanes, fallback)).toBe(fallback);
  });

  it('restores the pins that were written', () => {
    const saved = togglePin(layout([300, 400, 300]), 0);

    expect(parseLayout(serializeLayout(saved), fallback).pinned).toEqual([false, true, true]);
  });

  it('fills the pins in from a payload written before they existed', () => {
    // v1 is the shape that shipped before pinning. Rejecting it over the one
    // missing field would reset the widths the user dragged to, which is the
    // half of this payload that took effort to produce.
    const v1 = JSON.stringify({
      version: 1,
      sizes: [300, 400, 300],
      preferred: [320, 380, 300],
      collapsed: [false, true, false],
    });

    const restored = parseLayout(v1, fallback);

    expect(restored.pinned).toEqual([true, true, true]);
    expectSizes(restored.sizes, [300, 400, 300]);
    expect(restored.preferred).toEqual([320, 380, 300]);
    expect(restored.collapsed).toEqual([false, true, false]);
  });

  it('falls back on a payload from a build newer than this one', () => {
    // Its fields may mean anything; guessing is how a layout half-applies.
    const future = JSON.stringify({
      version: 99,
      sizes: [300, 400, 300],
      preferred: [300, 400, 300],
      collapsed: [false, false, false],
      pinned: [true, true, true],
    });

    expect(parseLayout(future, fallback)).toBe(fallback);
  });

  it('falls back on a pins array that is present but wrong', () => {
    const shapes = [
      { pinned: [true, 'yes', true] },
      { pinned: [true, true] },
      { pinned: 'true' },
      { pinned: null },
    ];

    for (const shape of shapes) {
      const raw = JSON.stringify({
        version: 2,
        sizes: [300, 400, 300],
        preferred: [300, 400, 300],
        collapsed: [false, false, false],
        ...shape,
      });

      expect(parseLayout(raw, fallback)).toBe(fallback);
    }
  });

  it('falls back on an older payload version', () => {
    const old = JSON.stringify({ version: 0, sizes: [1, 2, 3], preferred: [1, 2, 3], collapsed: [false, false, false] });

    expect(parseLayout(old, fallback)).toBe(fallback);
  });

  it('falls back on nothing, on garbage, and on the wrong shapes', () => {
    expect(parseLayout(null, fallback)).toBe(fallback);
    expect(parseLayout('', fallback)).toBe(fallback);
    expect(parseLayout('{oops', fallback)).toBe(fallback);
    expect(parseLayout('[]', fallback)).toBe(fallback);
    expect(parseLayout('42', fallback)).toBe(fallback);
    expect(
      parseLayout(
        JSON.stringify({ version: 1, sizes: [1, 2, 3], preferred: [1, 2, 3], collapsed: [0, 1, 0] }),
        fallback,
      ),
    ).toBe(fallback);
  });

  it('falls back on a size that is not a finite number', () => {
    // JSON has no NaN, so a corrupted width arrives as null or a string.
    const corrupt = JSON.stringify({
      version: 1,
      sizes: [null, '452', 300],
      preferred: [248, 452, 300],
      collapsed: [false, false, false],
    });

    expect(parseLayout(corrupt, fallback)).toBe(fallback);
  });

  it('re-fits a restored layout onto whatever container it lands in', () => {
    const saved = parseLayout(serializeLayout(layout([300, 400, 300])), fallback);
    const fitted = clampSizes(saved.sizes, saved.mins, 1400);

    expect(sum(fitted)).toBeCloseTo(1400, 6);
    expectSizes(fitted, [420, 560, 420]);
  });
});

describe('the four-pane window', () => {
  const fallback = defaultLayout();

  it('has branches, commit tree, files, and code', () => {
    expect(fallback.sizes).toHaveLength(4);
    expect(fallback.mins).toEqual([...DEFAULT_MINS]);
    expect(fallback.collapsed).toEqual([false, false, false, false]);
  });

  it('round-trips a four-pane layout', () => {
    const saved = toggleCollapse(layout([180, 250, 280, 610], [...DEFAULT_MINS]), 0);
    const restored = parseLayout(serializeLayout(saved), fallback);

    expectSizes(restored.sizes, saved.sizes);
    expect(restored.collapsed).toEqual([true, false, false, false]);
  });

  it('splits a three-pane layout’s review pane into Files and Code, keeping every width', () => {
    // What every existing install has stored: the review pane dragged to 900px.
    const v2 = JSON.stringify({
      version: 2,
      sizes: [200, 300, 900],
      preferred: [200, 300, 900],
      collapsed: [false, false, false],
      pinned: [false, true, true],
    });

    const migrated = parseLayout(v2, fallback);

    expect(migrated.sizes).toHaveLength(4);
    expect(migrated.sizes[0]).toBe(200);
    expect(migrated.sizes[1]).toBe(300);
    // The two new panes share exactly the old review pane's width.
    expect((migrated.sizes[2] ?? 0) + (migrated.sizes[3] ?? 0)).toBeCloseTo(900, 6);
    expect(migrated.sizes[3]).toBeGreaterThan(migrated.sizes[2] ?? 0);
    expect(sum(migrated.sizes)).toBeCloseTo(1400, 6);
    expect(migrated.pinned).toEqual([false, true, true, true]);
    expect(migrated.collapsed).toEqual([false, false, false, false]);
    expect(migrated.mins).toEqual([...DEFAULT_MINS]);
  });

  it('migrates a three-pane layout written before pins existed', () => {
    const v1 = JSON.stringify({
      version: 1,
      sizes: [28, 400, 900],
      preferred: [200, 400, 900],
      collapsed: [true, false, false],
    });

    const migrated = parseLayout(v1, fallback);

    expect(migrated.collapsed).toEqual([true, false, false, false]);
    expect(migrated.pinned).toEqual([true, true, true, true]);
    expect(migrated.preferred[0]).toBe(200);
  });

  it('keeps both halves collapsed when the old review pane was', () => {
    const v2 = JSON.stringify({
      version: 2,
      sizes: [300, 1000, 28],
      preferred: [300, 400, 700],
      collapsed: [false, false, true],
      pinned: [true, true, true],
    });

    const migrated = parseLayout(v2, fallback);
    expect(migrated.collapsed).toEqual([false, false, true, true]);
    expect(sum(migrated.sizes)).toBeCloseTo(1328, 6);
  });

  it('does not migrate a three-pane payload that claims to be from the four-pane era', () => {
    const odd = JSON.stringify({
      version: 3,
      sizes: [200, 300, 900],
      preferred: [200, 300, 900],
      collapsed: [false, false, false],
      pinned: [true, true, true],
    });

    expect(parseLayout(odd, fallback)).toBe(fallback);
  });
});
