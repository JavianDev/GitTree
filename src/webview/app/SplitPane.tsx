import { Children, Fragment, useEffect, useRef, useState } from 'react';
import { RAIL_WIDTH, fitMoves } from './useLayout';
import './splitpane.css';

/**
 * Flow width of a drag handle.
 *
 * Declared here rather than in the stylesheet because the measurement below has
 * to subtract it: the handles sit in the same flex row as the panes, so the
 * container width is not the space the panes have to share, and reporting it
 * unadjusted makes every drag drift by a handle width per boundary.
 */
const HANDLE_WIDTH = 6;

/** Arrow-key step. Large enough to be worth pressing, small enough to aim with. */
const KEYBOARD_STEP = 16;

/**
 * Width an auto-hidden pane opens to when the caller offers no better one.
 *
 * The width the user last dragged to lives in the model's `preferred`, which is
 * deliberately not part of this component's contract — a hover affordance is a
 * poor reason to widen it. `defaults` is already here and is a known-good width
 * for the same pane, so this is only reached by a caller that passes neither
 * defaults nor minimums.
 */
const PEEK_WIDTH = 260;

/** Room past the longest text, so a name that just fits is not ellipsized by rounding. */
const FIT_SLOP = 8;

/** Quiet time after the last DOM change before a newly loaded pane is fitted. */
const FIT_SETTLE_MS = 250;

/** A pane that keeps changing (a long history streaming in) is fitted by this point anyway. */
const FIT_DEADLINE_MS = 2500;

/**
 * Wait between a fit being asked for and its measurement — a few frames, for a
 * pane that has just opened to lay out and the list inside it to render rows for
 * its new height. A timer rather than animation frames, which a webview does not
 * run while it is in the background.
 */
const FIT_DELAY_MS = 50;

/**
 * The width at which every `[data-fit]` text in the pane shows in full.
 *
 * Measured as slack rather than as text width: how much room each marked
 * element has beyond its text, where a negative value is how much it is cut
 * off by. The pane can move by the smallest slack and every row still fits,
 * whatever else sits in those rows — pills, counts, indentation — because the
 * marked element is the one that absorbs a change in the pane's width.
 */
function measureFit(pane: HTMLElement): number | undefined {
  const paneWidth = pane.getBoundingClientRect().width;
  const range = document.createRange();
  let slack = Number.POSITIVE_INFINITY;

  for (const element of pane.querySelectorAll<HTMLElement>('[data-fit]')) {
    const box = element.getBoundingClientRect();
    // Inside a collapsed folder or a hidden section: not on screen to be cut off.
    if (box.width === 0) continue;

    const style = getComputedStyle(element);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const inner = element.clientWidth - padding;

    range.selectNodeContents(element);
    let text = range.getBoundingClientRect().width;
    // An ellipsized element reports its overflow in `scrollWidth`; trust whichever is larger.
    if (element.scrollWidth > element.clientWidth + 1) text = Math.max(text, element.scrollWidth - padding);

    slack = Math.min(slack, inner - text);
  }

  return Number.isFinite(slack) && paneWidth > 0 ? paneWidth - slack + FIT_SLOP : undefined;
}

interface DragState {
  pointerId: number;
  startX: number;
  startSize: number;
}

export interface SplitPaneProps {
  /** One child per pane, in order. */
  children: React.ReactNode;
  sizes: readonly number[];
  mins: readonly number[];
  collapsed: readonly boolean[];
  /** Per-pane pin state. An unpinned pane hides to its rail when it is not in use. */
  pinned?: readonly boolean[];
  /** Reset targets for a double-click or Home on a handle. */
  defaults?: readonly number[];
  /** Pane names, used for the rail and for the handle's accessible name. */
  labels?: readonly string[];
  onResize: (index: number, deltaPx: number) => void;
  onToggleCollapse: (index: number) => void;
  /** Omitted by callers that do not offer pinning; the pane controls are then absent. */
  onTogglePin?: (index: number) => void;
  /** Receives the measured width of the pane area whenever it changes. */
  onMeasure?: (total: number) => void;
  /**
   * Per-pane ceiling for fitting to content. A pane with one widens or narrows
   * to its `[data-fit]` text when it opens, when its content first loads, and
   * on a double-click of the handle after it; one without keeps its width.
   */
  fitMax?: readonly (number | undefined)[];
  /** Changing it (a different repository) fits the panes to their new content. */
  fitKey?: string;
}

/**
 * The resizing primitive: N panes in a row, with a draggable handle between
 * each pair and a rail in place of a collapsed one.
 *
 * It owns no geometry. Every gesture is reported as a pixel delta and the
 * caller decides what the layout becomes, which is what keeps the arithmetic in
 * `useLayout` where it can be tested without a DOM.
 *
 * The one thing it does own is the *peek*: an unpinned pane that the pointer or
 * focus has reached opens over its neighbour instead of beside it. That is
 * presentation, not layout — the row still holds the pane at its rail — so it
 * lives here rather than in the model.
 */
export function SplitPane({
  children,
  sizes,
  mins,
  collapsed,
  pinned,
  defaults,
  labels,
  onResize,
  onToggleCollapse,
  onTogglePin,
  onMeasure,
  fitMax,
  fitKey,
}: SplitPaneProps): React.JSX.Element {
  const panes = Children.toArray(children);
  const count = panes.length;

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const [dragging, setDragging] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [focused, setFocused] = useState(-1);

  const paneRefs = useRef<(HTMLElement | null)[]>([]);
  /** Read by the deferred fit, which runs frames after the render that asked for it. */
  const latest = useRef({ sizes, mins, collapsed, defaults, fitMax, onResize });
  latest.current = { sizes, mins, collapsed, defaults, fitMax, onResize };
  /** Panes waiting to be fitted, with how many passes each has left. */
  const fitQueue = useRef(new Map<number, number>());
  const fitTimer = useRef(0);

  /** Resizes one pane to its content; true when that moved the handle. */
  const fitNow = (index: number, allowShrink: boolean): boolean => {
    const { sizes, mins, collapsed, defaults, fitMax, onResize } = latest.current;
    const pane = paneRefs.current[index];
    const size = sizes[index];
    const neighbour = sizes[index + 1];
    const max = fitMax?.[index];
    if (!pane || size === undefined || neighbour === undefined || max === undefined) return false;
    if (collapsed[index] === true || collapsed[index + 1] === true) return false;

    const width = pane.getBoundingClientRect().width;
    const wanted = measureFit(pane);
    if (wanted === undefined || width <= 0) return false;

    // Model units per pixel: 1 once the row has settled, but a fit can land
    // while it is still reflowing.
    const scale = size / width;
    const floor = (at: number): number => Math.max(mins[at] ?? 0, defaults?.[at] ?? 0);
    const beyond = collapsed[index + 2] === true ? undefined : sizes[index + 2];
    const [move, push] = fitMoves({
      size,
      neighbour,
      min: mins[index] ?? 0,
      neighbourFloor: floor(index + 1),
      ...(beyond !== undefined ? { beyond, beyondFloor: floor(index + 2) } : {}),
      wanted: wanted * scale,
      max: max * scale,
    });
    if (move === 0 || (move < 0 && !allowShrink)) return false;

    // The neighbour moves along first, so the second resize takes back only
    // what it can spare and it ends no narrower than its floor.
    if (push > 0) onResize(index + 1, push);
    onResize(index, move);
    return true;
  };

  /*
   * Fits run one pane at a time, left to right, because fitting a pane moves its
   * right-hand neighbour, which is the next one to be measured.
   *
   * Each pane gets a second, grow-only pass. Widening a pane can bring back a
   * column its container query had hidden — the Git Tree's author — which takes
   * room from the text that was just fitted.
   */
  const pumpFits = (): void => {
    window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      const [index] = [...fitQueue.current.keys()].sort((a, b) => a - b);
      if (index === undefined) return;
      const passes = fitQueue.current.get(index) ?? 0;
      fitQueue.current.delete(index);

      const moved = fitNow(index, passes > 1);
      if (moved && passes > 1) fitQueue.current.set(index, passes - 1);
      if (fitQueue.current.size > 0) pumpFits();
    }, FIT_DELAY_MS);
  };

  const requestFit = (index: number): void => {
    if (latest.current.fitMax?.[index] === undefined) return;
    fitQueue.current.set(index, 2);
    pumpFits();
  };

  useEffect(() => () => window.clearTimeout(fitTimer.current), []);

  // Opening a pane — its rail, Restore panels, a keyboard toggle — fits it.
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    const before = wasCollapsed.current;
    wasCollapsed.current = collapsed;
    collapsed.forEach((now, index) => {
      if (before[index] === true && now !== true) requestFit(index);
    });
    // `requestFit` reads everything else through `latest`.
  }, [collapsed]);

  /*
   * And so does the pane's content arriving: on first load and whenever the
   * repository changes. Waited out rather than taken at the first mutation,
   * because a sidebar renders its current branch well before the rest, and
   * fitting to that alone would cut off every name that lands after it.
   */
  useEffect(() => {
    const stops: Array<() => void> = [];

    paneRefs.current.forEach((pane, index) => {
      if (!pane || latest.current.fitMax?.[index] === undefined) return;

      const deadline = performance.now() + FIT_DEADLINE_MS;
      let timer = 0;
      const observer = new MutationObserver(() => settle());
      const done = (): void => {
        observer.disconnect();
        window.clearTimeout(timer);
        if (pane.querySelector('[data-fit]')) requestFit(index);
      };
      const settle = (): void => {
        window.clearTimeout(timer);
        if (performance.now() >= deadline) done();
        else timer = window.setTimeout(done, FIT_SETTLE_MS);
      };
      observer.observe(pane, { childList: true, subtree: true, characterData: true });
      settle();

      stops.push(() => {
        observer.disconnect();
        window.clearTimeout(timer);
      });
    });

    return () => stops.forEach((stop) => stop());
  }, [fitKey, count]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !onMeasure) return;

    const gutter = HANDLE_WIDTH * Math.max(0, count - 1);
    const report = () => onMeasure(node.clientWidth - gutter);

    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, onMeasure]);

  /*
   * Only a pane with a neighbour to hide behind can auto-hide.
   *
   * The last pane is the content the other two are about; turning it into a rail
   * hides the thing being looked at, and it has nothing to its right to open
   * over. So the controls stop before it.
   */
  const canPin = (index: number): boolean => onTogglePin !== undefined && index < count - 1;

  const isAuto = (index: number): boolean => canPin(index) && pinned?.[index] === false;

  /** Open over the neighbour: railed in the row, but reached and so shown. */
  const isPeeking = (index: number): boolean =>
    isAuto(index) &&
    collapsed[index] === true &&
    (hovered === index || focused === index) &&
    dragging < 0;

  const peekWidth = (index: number): number =>
    Math.max(defaults?.[index] ?? 0, mins[index] ?? 0) || PEEK_WIDTH;

  /*
   * An unpinned pane that is neither hovered nor focused belongs at its rail.
   *
   * Stated as a synchronisation rather than as a pair of leave handlers, because
   * the two ways of leaving overlap: clicking away from a pane the pointer is
   * still resting on is not a departure, and a handler that could not see the
   * other half of the state would shut the pane under the cursor.
   */
  useEffect(() => {
    // A captured drag retargets pointer events to the handle, so every pane the
    // cursor crosses reports a departure it never made.
    if (dragging >= 0) return;

    for (let index = 0; index < count; index++) {
      if (!isAuto(index) || collapsed[index] === true) continue;
      if (hovered === index || focused === index) continue;
      onToggleCollapse(index);
    }
    // `isAuto` is derived from the props already listed here.
  }, [count, pinned, collapsed, hovered, focused, dragging, onTogglePin, onToggleCollapse]);

  const isLocked = (index: number): boolean =>
    collapsed[index] === true || collapsed[index + 1] === true;

  const reset = (index: number): void => {
    const target = defaults?.[index];
    const current = sizes[index];
    if (target === undefined || current === undefined) return;
    onResize(index, target - current);
  };

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const size = sizes[index];
    // A second finger landing on the handle mid-drag would otherwise restart it
    // from wherever that finger is.
    if (event.button !== 0 || !event.isPrimary || size === undefined || isLocked(index)) return;

    // Pointer capture, not a mousemove listener: capture keeps every later move
    // and the release addressed to this element even after the cursor has left
    // its six pixels, which is exactly what a fast drag does.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startSize: size };
    setDragging(index);
    // Otherwise the gesture starts selecting text in the panes either side.
    event.preventDefault();
  };

  const moveDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    const current = sizes[index];
    if (!active || active.pointerId !== event.pointerId || current === undefined) return;

    // Measured from where the drag began rather than from the last move: while a
    // pane is held at its minimum the caller discards the movement, and
    // accumulated deltas would leave the handle permanently offset from the
    // cursor once it comes back.
    const target = active.startSize + (event.clientX - active.startX);
    if (target !== current) onResize(index, target - current);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setDragging(-1);
  };

  const handleKey = (index: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      onToggleCollapse(index);
      event.preventDefault();
      return;
    }

    if (event.key === 'Home') {
      reset(index);
      event.preventDefault();
      return;
    }

    if (isLocked(index)) return;

    const step =
      event.key === 'ArrowLeft' ? -KEYBOARD_STEP : event.key === 'ArrowRight' ? KEYBOARD_STEP : 0;
    if (step === 0) return;

    onResize(index, step);
    event.preventDefault();
  };

  const renderHandle = (index: number): React.JSX.Element => {
    const size = sizes[index] ?? 0;
    const minLeft = mins[index] ?? 0;
    const minRight = mins[index + 1] ?? 0;
    const pair = size + (sizes[index + 1] ?? 0);
    const locked = isLocked(index);

    return (
      <div
        className="gt-split-handle"
        // A separator that can only be dragged is unusable without a mouse, so
        // it is a real widget: focusable, with a value the reader can hear move.
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${labels?.[index] ?? `pane ${index + 1}`}`}
        aria-valuenow={Math.round(size)}
        aria-valuemin={Math.round(minLeft)}
        aria-valuemax={Math.round(Math.max(minLeft, pair - minRight))}
        aria-disabled={locked ? true : undefined}
        tabIndex={0}
        data-locked={locked ? 'true' : undefined}
        style={{ flex: `0 0 ${HANDLE_WIDTH}px` }}
        onPointerDown={startDrag(index)}
        onPointerMove={moveDrag(index)}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        // Fit to content where the pane has text to fit, otherwise back to its default.
        onDoubleClick={() => (fitMax?.[index] !== undefined ? requestFit(index) : reset(index))}
        onKeyDown={handleKey(index)}
      />
    );
  };

  return (
    <div
      className="gt-split"
      ref={containerRef}
      data-dragging={dragging >= 0 ? 'true' : undefined}
    >
      {panes.map((pane, index) => {
        const isCollapsed = collapsed[index] === true;
        const label = labels?.[index] ?? `Pane ${index + 1}`;
        const peeking = isPeeking(index);
        const isPinned = pinned?.[index] !== false;

        return (
          <Fragment key={index}>
            {index > 0 && renderHandle(index - 1)}

            <section
              ref={(node) => {
                paneRefs.current[index] = node;
              }}
              className="gt-split-pane"
              aria-label={label}
              data-collapsed={isCollapsed ? 'true' : undefined}
              data-peek={peeking ? 'true' : undefined}
              style={
                isCollapsed
                  ? { flex: `0 0 ${RAIL_WIDTH}px` }
                  : // No CSS minimum: the model already holds the floor, and a
                    // second one here would overflow the row on a window
                    // narrower than the minimums add up to.
                    { flexGrow: sizes[index] ?? 1, flexBasis: 0 }
              }
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered((current) => (current === index ? -1 : current))}
              onFocus={() => setFocused(index)}
              onBlur={(event) => {
                // React's blur is `focusout`, so it also fires for a move from
                // one control in the pane to the next — which is not a departure.
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setFocused((current) => (current === index ? -1 : current));
              }}
            >
              {isCollapsed && (
                <button
                  type="button"
                  className="gt-split-rail"
                  aria-label={`Expand ${label}`}
                  title={`Expand ${label}`}
                  onClick={() => onToggleCollapse(index)}
                >
                  <span className="gt-split-rail-glyph" aria-hidden="true">
                    ▸
                  </span>
                  <span className="gt-split-rail-label">{label}</span>
                </button>
              )}

              {/* Kept mounted while collapsed: unmounting would throw away the
                  pane's scroll position and expansion state every time. */}
              <div
                className="gt-split-body"
                // A peek is an overlay, so its width cannot come from the flex
                // row — the row is still holding this pane at its rail, which is
                // the whole point of not reflowing the graph on every hover.
                style={peeking ? { width: peekWidth(index) } : undefined}
              >
                {/* A title bar per pane, with pin and collapse inside it rather
                    than floating over the pane's own content — where they sat on
                    top of whatever that pane put in its top-right corner. First
                    in the DOM so tabbing into the pane reaches them first. */}
                <header className="gt-pane-header">
                  <span className="gt-pane-title">{label}</span>
                {canPin(index) && (
                  <div className="gt-split-controls">
                    <button
                      type="button"
                      className="gt-split-control"
                      aria-pressed={isPinned}
                      aria-label={`Keep ${label} open`}
                      title={
                        isPinned
                          ? `${label} stays open. Unpin to hide it until you reach for it.`
                          : `${label} hides when you move away. Pin to keep it open.`
                      }
                      onClick={() => onTogglePin?.(index)}
                    >
                      <span className="gt-split-control-glyph" aria-hidden="true">
                        📌
                      </span>
                    </button>

                    <button
                      type="button"
                      className="gt-split-control"
                      aria-label={`Collapse ${label}`}
                      title={`Collapse ${label}`}
                      onClick={() => onToggleCollapse(index)}
                    >
                      <span className="gt-split-control-glyph" aria-hidden="true">
                        ◂
                      </span>
                    </button>
                  </div>
                )}
                </header>

                <div className="gt-pane-content">{pane}</div>
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}
