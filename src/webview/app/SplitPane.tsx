import { Children, Fragment, useEffect, useRef, useState } from 'react';
import { RAIL_WIDTH } from './useLayout';
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
}: SplitPaneProps): React.JSX.Element {
  const panes = Children.toArray(children);
  const count = panes.length;

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const [dragging, setDragging] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [focused, setFocused] = useState(-1);

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
        onDoubleClick={() => reset(index)}
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
                {canPin(index) && (
                  // First in the DOM so tabbing into the pane reveals the
                  // controls before anything else; they are invisible until the
                  // pane is hovered or holds focus.
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

                {pane}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}
