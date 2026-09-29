import { useLayoutEffect, useRef } from 'react';
import type { GraphRow } from '@shared/model';
import { railSegments } from './railSegments';

const LANE_WIDTH = 16;
/**
 * The widest the gutter grows unless the caller says otherwise. Past it, lanes
 * are drawn closer together rather than off the canvas edge — a busy history
 * gets a denser graph, never a cut-off one.
 */
const DEFAULT_MAX_WIDTH = 240;
/** Densest a lane gets before rails would visually merge into one another. */
const MIN_LANE_WIDTH = 6;
const RAIL_WIDTH = 2.1;
const NODE_RADIUS = 4.4;
/** Gap punched around a node so rails passing behind never touch it. */
const NODE_RING = 2.2;
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
   * pixel-smoothly via the browser's native scroll. Drawing at `(index -
   * start) * rowHeight` assumed `start`'s row sat exactly at the canvas's top
   * edge, which is only true the instant `scrollTop` is a multiple of
   * `rowHeight` — every other frame the rails drifted out of register with
   * the commit rows beneath them, worsening until the next whole-row snap.
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
 * Draws the commit rails.
 *
 * Canvas for the rails, DOM for the commit rows: curves are cheap to paint and
 * expensive to express as elements, while text has to stay selectable and
 * reachable by a screen reader. The canvas is viewport-sized and repainted on
 * scroll rather than sized to the full history — at 28px per row a 50k-commit
 * repository would need a 1.4M-pixel-tall canvas, far past what browsers
 * allocate.
 *
 * Node shape carries meaning that colour alone cannot: a merge is drawn as a
 * ring, a root as a square, an ordinary commit as a filled dot. That survives a
 * colour-vision difference and reads at a glance while scrolling.
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

  // A layout effect, not a plain effect: the list beside this canvas scrolls
  // natively, so painting after the browser has already painted leaves the
  // rails a frame behind their rows on every scroll tick.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const lanes = Math.max(1, width);
    const laneWidth = Math.max(MIN_LANE_WIDTH, Math.min(LANE_WIDTH, (maxWidth - LANE_WIDTH / 2) / lanes));
    const cssWidth = Math.ceil(lanes * laneWidth + LANE_WIDTH / 2);
    // Nodes shrink with their lane so neighbours never overlap.
    const nodeRadius = Math.min(NODE_RADIUS, laneWidth * 0.3);
    const nodeRing = Math.min(NODE_RING, laneWidth * 0.15);

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, height);

    const { palette, ring } = readPalette();
    const laneX = (lane: number) => laneWidth / 2 + lane * laneWidth;
    // Positioned from the same scroll offset the list itself uses, not from
    // `start`, so a row's rail lines up with its DOM row at every scroll
    // position — not just the ones where `scrollTop` happens to land exactly
    // on a row boundary.
    const rowY = (index: number) => index * rowHeight - scrollTop + rowHeight / 2;
    const colorOf = (index: number) => palette[index % PALETTE_SIZE] ?? palette[0] ?? '#888';

    const last = Math.min(end, rows.length);

    context.lineWidth = RAIL_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    /* --- Rails, painted first so nodes sit on top --------------------- */

    // Gap by gap — see `railSegments` for why a rail is never one long stroke.
    // Starting one row above the window draws the gap that enters it.
    for (const segment of railSegments(rows, start - 1, last - 1)) {
      const x1 = laneX(segment.fromLane);
      const x2 = laneX(segment.toLane);
      const y1 = rowY(segment.row);
      const y2 = y1 + rowHeight;
      const dimmed = selectedRow !== undefined && selectedRow !== segment.row;

      context.strokeStyle = colorOf(segment.color);
      context.globalAlpha = dimmed ? 0.42 : 1;
      context.beginPath();
      context.moveTo(x1, y1);

      if (x1 === x2) {
        context.lineTo(x2, y2);
      } else {
        // Control points half a row in leave the node vertically and arrive
        // vertically, so a branch reads as one continuous line bending into its
        // lane rather than a diagonal cutting the corner.
        const bend = rowHeight * 0.5;
        context.bezierCurveTo(x1, y1 + bend, x2, y2 - bend, x2, y2);
      }

      context.stroke();
    }

    context.globalAlpha = 1;

    /* --- Nodes -------------------------------------------------------- */

    for (let i = start; i < last; i++) {
      const row = rows[i];
      if (!row) continue;

      const x = laneX(row.lane);
      const y = rowY(i);
      const color = colorOf(row.color);
      const selected = selectedRow === i;

      // Punch a hole in the rails so the node reads as sitting on top of them
      // rather than being crossed by them.
      context.fillStyle = ring;
      context.beginPath();
      context.arc(x, y, nodeRadius + nodeRing, 0, Math.PI * 2);
      context.fill();

      if (selected) {
        // A soft halo, not a hard outline: it marks the row without competing
        // with the rail colours around it.
        context.fillStyle = color;
        context.globalAlpha = 0.22;
        context.beginPath();
        context.arc(x, y, nodeRadius + 5.5, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }

      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = 2;

      if (row.isMerge) {
        // Hollow: a merge joins histories rather than adding content of its own.
        context.beginPath();
        context.arc(x, y, nodeRadius - 0.4, 0, Math.PI * 2);
        context.stroke();
      } else if (row.isRoot) {
        // Square: history starts here and nothing continues below.
        const size = nodeRadius * 1.65;
        context.fillRect(x - size / 2, y - size / 2, size, size);
      } else {
        context.beginPath();
        context.arc(x, y, nodeRadius, 0, Math.PI * 2);
        context.fill();
      }

      context.lineWidth = RAIL_WIDTH;
    }
  }, [rows, rowCount, start, end, scrollTop, rowHeight, height, width, maxWidth, selectedRow]);

  return <canvas ref={canvasRef} className="gt-graph-gutter" aria-hidden="true" />;
}

/**
 * Resolves the rail tokens on every paint, so a theme change is picked up
 * without the component needing to know a theme changed.
 */
function readPalette(): { palette: string[]; ring: string } {
  const styles = getComputedStyle(document.body);
  const palette: string[] = [];

  for (let i = 0; i < PALETTE_SIZE; i++) {
    palette.push(styles.getPropertyValue(`--gt-lane-${i}`).trim() || '#888888');
  }

  return {
    palette,
    ring: styles.getPropertyValue('--gt-node-ring').trim() || '#ffffff',
  };
}
