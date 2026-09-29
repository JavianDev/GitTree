import { useEffect, useRef } from 'react';
import type { GraphRow } from '@shared/model';

const LANE_WIDTH = 16;
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
  selectedRow,
}: GraphCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, width * LANE_WIDTH + LANE_WIDTH);

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, height);

    const { palette, ring } = readPalette();
    const laneX = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH;
    // Positioned from the same scroll offset the list itself uses, not from
    // `start`, so a row's rail lines up with its DOM row at every scroll
    // position — not just the ones where `scrollTop` happens to land exactly
    // on a row boundary.
    const rowY = (index: number) => index * rowHeight - scrollTop + rowHeight / 2;
    const colorOf = (index: number) => palette[index % PALETTE_SIZE] ?? palette[0] ?? '#888';

    const last = Math.min(end, rows.length);

    const byHash = new Map<string, number>();
    for (let i = start; i < last; i++) {
      const row = rows[i];
      if (row) byHash.set(row.hash, i);
    }

    context.lineWidth = RAIL_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    /* --- Rails, painted first so nodes sit on top --------------------- */

    for (let i = start; i < last; i++) {
      const row = rows[i];
      if (!row) continue;

      const y = rowY(i);
      const dimmed = selectedRow !== undefined && selectedRow !== i;

      for (const edge of row.edges) {
        const targetIndex = byHash.get(edge.parent);
        // A parent outside the rendered window still needs a rail leaving the
        // viewport, or branches appear to stop at the scroll boundary.
        const targetY = targetIndex === undefined ? height + rowHeight : rowY(targetIndex);

        context.strokeStyle = colorOf(edge.color);
        context.globalAlpha = dimmed ? 0.42 : 1;
        context.beginPath();
        context.moveTo(laneX(edge.fromLane), y);

        if (edge.fromLane === edge.toLane) {
          context.lineTo(laneX(edge.toLane), targetY);
        } else {
          // Control points pulled most of the way down make the curve leave the
          // node vertically and arrive vertically, so a branch reads as one
          // continuous line rather than a diagonal cutting the corner.
          const span = targetY - y;
          context.bezierCurveTo(
            laneX(edge.fromLane),
            y + span * 0.45,
            laneX(edge.toLane),
            targetY - span * 0.45,
            laneX(edge.toLane),
            targetY,
          );
        }

        context.stroke();
      }

      for (const rail of row.passthrough) {
        context.strokeStyle = colorOf(rail.color);
        context.globalAlpha = dimmed ? 0.42 : 1;
        context.beginPath();
        context.moveTo(laneX(rail.lane), y - rowHeight / 2 - 0.5);
        context.lineTo(laneX(rail.lane), y + rowHeight / 2 + 0.5);
        context.stroke();
      }
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
      context.arc(x, y, NODE_RADIUS + NODE_RING, 0, Math.PI * 2);
      context.fill();

      if (selected) {
        // A soft halo, not a hard outline: it marks the row without competing
        // with the rail colours around it.
        context.fillStyle = color;
        context.globalAlpha = 0.22;
        context.beginPath();
        context.arc(x, y, NODE_RADIUS + 5.5, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }

      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = 2;

      if (row.isMerge) {
        // Hollow: a merge joins histories rather than adding content of its own.
        context.beginPath();
        context.arc(x, y, NODE_RADIUS - 0.4, 0, Math.PI * 2);
        context.stroke();
      } else if (row.isRoot) {
        // Square: history starts here and nothing continues below.
        const size = NODE_RADIUS * 1.65;
        context.fillRect(x - size / 2, y - size / 2, size, size);
      } else {
        context.beginPath();
        context.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        context.fill();
      }

      context.lineWidth = RAIL_WIDTH;
    }
  }, [rows, start, end, scrollTop, rowHeight, height, width, selectedRow]);

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
