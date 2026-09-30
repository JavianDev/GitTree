import { useLayoutEffect, useRef } from 'react';
import type { GraphRow } from '@shared/model';
import { DEFAULT_MAX_WIDTH, LANE_WIDTH, type Rgb, laneCenter, laneWidthFor, parseColor } from './graphGeometry';

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
import { railSegments } from './railSegments';

const RAIL_WIDTH = 2.2;
/** A wide, faint pass under each rail: the glow, without a per-stroke blur filter. */
const RAIL_GLOW_WIDTH = 6;
const RAIL_GLOW_ALPHA = 0.16;
const NODE_RADIUS = 5;
/** Clear space erased around a node, so rails meet it rather than cross it. */
const NODE_CLEARANCE = 2;
const PALETTE_SIZE = 12;

export interface GraphCanvasProps {
  /** Readonly: the accumulator owns this array and appends to it between paints. */
  rows: readonly GraphRow[];
  /** First row index currently rendered by the list. */
  start: number;
  /** One past the last rendered row index. */
  end: number;
  /**
   * The list's continuous scroll offset, in pixels.
   *
   * `start` alone is not enough to position rows: it only changes in whole-row
   * jumps (`floor(scrollTop / rowHeight)`), while the list itself scrolls
   * pixel-smoothly via the browser's native scroll. Positioning from `start`
   * left the rails drifting out of register with their rows between snaps.
   */
  scrollTop: number;
  rowHeight: number;
  /** Pixel height of the viewport. */
  height: number;
  /** Widest lane count across the loaded history; fixes the gutter width. */
  width: number;
  /**
   * How many rows are loaded. `rows` is appended to in place by the stream
   * accumulator, so its identity never changes between batches — this is
   * what tells the paint effect that there is something new to draw.
   */
  rowCount: number;
  /** Width budget in px; lanes compress to fit it. */
  maxWidth?: number;
  /** Row index of the selected commit, emphasised in the drawing. */
  selectedRow?: number;
}

/**
 * Draws the commit rails and nodes, as a transparent layer over the list.
 *
 * Canvas for the rails, DOM for the commit rows: curves are cheap to paint and
 * expensive to express as elements, while text has to stay selectable and
 * reachable by a screen reader. The canvas is viewport-sized and repainted on
 * scroll rather than sized to the full history, which at 24px a row would be
 * far taller than browsers allocate on a large repository.
 *
 * Nodes are small glass gems, and their shape carries meaning colour alone
 * cannot — an orb for a commit, a lens with a dark core for a merge, a rounded
 * square for the root — so they read at a glance and survive a colour-vision
 * difference.
 */
export function GraphCanvas({
  rows,
  start,
  end,
  scrollTop,
  rowHeight,
  height,
  width,
  rowCount,
  maxWidth = DEFAULT_MAX_WIDTH,
  selectedRow,
}: GraphCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // A layout effect, not a plain effect: the list under this canvas scrolls
  // natively, so painting after the browser has already painted leaves the
  // rails a frame behind their rows on every scroll tick.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const lanes = Math.max(1, width);
    const laneWidth = laneWidthFor(lanes, maxWidth);
    const cssWidth = Math.ceil(lanes * laneWidth + LANE_WIDTH / 2);
    // Nodes shrink with their lane so neighbours never overlap.
    const radius = Math.min(NODE_RADIUS, laneWidth * 0.34);

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, height);

    const palette = readPalette();
    const colorOf = (index: number) => palette[index % PALETTE_SIZE] ?? palette[0] ?? '#888888';
    const laneX = (lane: number) => laneCenter(lane, laneWidth);
    // Positioned from the same scroll offset the list itself uses, so a row's
    // rail lines up with its DOM row at every scroll position.
    const rowY = (index: number) => index * rowHeight - scrollTop + rowHeight / 2;
    const last = Math.min(end, rows.length);

    context.lineCap = 'round';
    context.lineJoin = 'round';

    /* --- Rails, painted first so nodes sit on top --------------------- */

    // Gap by gap — see `railSegments` for why a rail is never one long stroke.
    // Starting one row above the window draws the gap that enters it.
    const segments = railSegments(rows, start - 1, last - 1);
    const trace = (segment: (typeof segments)[number]) => {
      const x1 = laneX(segment.fromLane);
      const x2 = laneX(segment.toLane);
      const y1 = rowY(segment.row);
      const y2 = y1 + rowHeight;
      context.beginPath();
      context.moveTo(x1, y1);
      if (x1 === x2) {
        context.lineTo(x2, y2);
      } else {
        // Control points half a row in leave the node vertically and arrive
        // vertically, so a branch reads as one line bending into its lane.
        const bend = rowHeight * 0.5;
        context.bezierCurveTo(x1, y1 + bend, x2, y2 - bend, x2, y2);
      }
    };

    // Two passes rather than a shadow blur per stroke: the blur is what makes a
    // canvas stutter while scrolling, and a faint wide stroke reads the same.
    context.globalAlpha = RAIL_GLOW_ALPHA;
    context.lineWidth = RAIL_GLOW_WIDTH;
    for (const segment of segments) {
      context.strokeStyle = colorOf(segment.color);
      trace(segment);
      context.stroke();
    }

    context.globalAlpha = 1;
    context.lineWidth = RAIL_WIDTH;
    for (const segment of segments) {
      context.strokeStyle = colorOf(segment.color);
      trace(segment);
      context.stroke();
    }

    /* --- Nodes -------------------------------------------------------- */

    for (let i = start; i < last; i++) {
      const row = rows[i];
      if (!row) continue;

      const shape: NodeShape = row.isRoot ? 'root' : row.isMerge ? 'merge' : 'commit';
      drawGlassNode(context, laneX(row.lane), rowY(i), radius, colorOf(row.color), shape, selectedRow === i);
    }
  }, [rows, rowCount, start, end, scrollTop, rowHeight, height, width, maxWidth, selectedRow]);

  return <canvas ref={canvasRef} className="gt-graph-gutter" aria-hidden="true" />;
}

/* -------------------------------------------------------------------------- */
/* Glass nodes                                                                */
/* -------------------------------------------------------------------------- */

type NodeShape = 'commit' | 'merge' | 'root';

function nodePath(context: CanvasRenderingContext2D, shape: NodeShape, x: number, y: number, r: number): void {
  context.beginPath();
  if (shape === 'root') {
    const side = r * 1.8;
    context.roundRect(x - side / 2, y - side / 2, side, side, r * 0.45);
  } else {
    context.arc(x, y, r, 0, Math.PI * 2);
  }
}

function drawGlassNode(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  shape: NodeShape,
  selected: boolean,
): void {
  const rgb = parseColor(color);
  const tint = (towards: Rgb, amount: number, alpha = 1) => (rgb ? css(mix(rgb, towards, amount), alpha) : color);

  // Erase the rails beneath, so the gem sits on whatever is behind the canvas —
  // the row's hover or selection band included — rather than on a painted disc.
  context.save();
  context.globalCompositeOperation = 'destination-out';
  nodePath(context, shape, x, y, r + NODE_CLEARANCE);
  context.fill();
  context.restore();

  if (selected) {
    context.save();
    context.strokeStyle = tint(WHITE, 0.25, 0.7);
    context.lineWidth = 1.5;
    nodePath(context, shape, x, y, r + 3.2);
    context.stroke();
    context.restore();
  }

  // Body: lit from the top left, falling off to a deeper shade at the far edge.
  context.save();
  context.shadowColor = tint(WHITE, 0, selected ? 0.9 : 0.55);
  context.shadowBlur = selected ? 10 : 5;
  const body = context.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r * 1.15);
  body.addColorStop(0, tint(WHITE, 0.6));
  body.addColorStop(0.5, color);
  body.addColorStop(1, tint(BLACK, 0.35));
  context.fillStyle = body;
  nodePath(context, shape, x, y, r);
  context.fill();
  context.restore();

  // A merge is a lens: a dark glass core with its own small highlight.
  if (shape === 'merge') {
    const core = context.createRadialGradient(x - r * 0.12, y - r * 0.12, 0, x, y, r * 0.5);
    core.addColorStop(0, tint(BLACK, 0.2));
    core.addColorStop(1, tint(BLACK, 0.6));
    context.fillStyle = core;
    context.beginPath();
    context.arc(x, y, r * 0.48, 0, Math.PI * 2);
    context.fill();
  }

  // Rim, for definition against light and dark backgrounds alike.
  context.lineWidth = 1;
  context.strokeStyle = tint(BLACK, 0.5, 0.85);
  nodePath(context, shape, x, y, r);
  context.stroke();

  // Specular highlight — the glint that makes it read as glass.
  if (r >= 3) {
    context.fillStyle = 'rgba(255, 255, 255, 0.6)';
    context.beginPath();
    context.ellipse(x - r * 0.28, y - r * 0.42, r * 0.5, r * 0.26, -0.35, 0, Math.PI * 2);
    context.fill();
  }
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(from[i]! + (to[i]! - from[i]!) * amount)) as unknown as Rgb;
}

function css([r, g, b]: Rgb, alpha: number): string {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolves the rail tokens on every paint, so a theme change is picked up
 * without the component needing to know a theme changed.
 */
function readPalette(): string[] {
  const styles = getComputedStyle(document.body);
  const palette: string[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    palette.push(styles.getPropertyValue(`--gt-lane-${i}`).trim() || '#888888');
  }
  return palette;
}
