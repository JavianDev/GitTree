import { COMMANDS } from '@shared/commands';
import type { FileStatus } from '@shared/model';
import { CommandPreview } from '../commands/CommandPreview';
import { type CellState, type FileSide, describeSide, fileState } from './fileState';
import './review.css';

/**
 * The two-cell index/worktree indicator — and the staging control.
 *
 * Left cell is the index, right cell is the working tree, exactly as git's own
 * `XY` code reads. Position and fill carry the meaning: a lit left cell means
 * the index holds a change, a lit right cell means the working tree does, and
 * both lit is the partially staged file the old status list rendered twice with
 * no way to tell the rows apart. Hue only reinforces what position already says,
 * so the pill survives any colour vision.
 *
 * Making the indicator the control is deliberate. The thing that teaches the
 * two-sided model is the thing you operate it with, so staging never means
 * hunting for a separate button, and hovering a cell previews the command it
 * will run through the same `CommandPreview` every other action uses.
 */

/** Why a live-looking cell is inert, keyed by the side that is refusing. */
const IDLE_REASON: Record<FileSide, string> = {
  index: 'Nothing in the working tree left to stage.',
  worktree: 'Nothing staged to unstage.',
};

export interface FileStatePillProps {
  file: FileStatus;
  /** Why staging this path is refused — set for a nested repository. */
  stageBlocked?: string;
  /** True while a mutation is in flight, so a second click cannot queue one. */
  busy?: boolean;
  onStage: () => void;
  onUnstage: () => void;
}

export function FileStatePill({
  file,
  stageBlocked,
  busy,
  onStage,
  onUnstage,
}: FileStatePillProps): React.JSX.Element {
  const cells = fileState(file);

  // A conflict is not a staging state, so neither cell is a control here.
  // `git add` on an unmerged path means "I have resolved this" — a cell that
  // staged on click would be offering exactly that under the wrong label.
  if (cells.index === 'conflict') {
    const label = describeSide(file, 'index');

    return (
      <span className="gt-pill" role="img" aria-label={label} title={label}>
        <span className="gt-pill-cell" data-side="index" data-state="conflict" />
        <span className="gt-pill-cell" data-side="worktree" data-state="conflict" />
      </span>
    );
  }

  return (
    <span className="gt-pill">
      <Cell
        file={file}
        side="index"
        state={cells.index}
        // The left cell stages, so what it can act on is whatever the working
        // tree still holds — not what this cell is itself showing.
        actionable={cells.worktree === 'on'}
        blocked={stageBlocked}
        busy={busy}
        onActivate={onStage}
      />
      <Cell
        file={file}
        side="worktree"
        state={cells.worktree}
        actionable={cells.index === 'on'}
        busy={busy}
        onActivate={onUnstage}
      />
    </span>
  );
}

function Cell({
  file,
  side,
  state,
  actionable,
  blocked,
  busy,
  onActivate,
}: {
  file: FileStatus;
  side: FileSide;
  state: CellState;
  actionable: boolean;
  blocked?: string;
  busy?: boolean;
  onActivate: () => void;
}): React.JSX.Element {
  const spec = side === 'index' ? COMMANDS.stage : COMMANDS.unstage;
  const description = describeSide(file, side);
  const reason = blocked ?? (actionable ? undefined : IDLE_REASON[side]);

  return (
    <CommandPreview spec={spec} context={{ paths: [file.path] }}>
      {(preview) => (
        <button
          type="button"
          {...preview}
          className="gt-pill-cell"
          data-side={side}
          data-state={state}
          disabled={busy === true || reason !== undefined}
          // The tooltip shows the state while the control is live and the
          // obstacle while it is not. The command itself is in the preview
          // popover, which is where every other action in the app shows it.
          title={reason ?? description}
          aria-label={`${spec.title} ${file.path} — ${description}`}
          onClick={(event) => {
            // The row underneath is a selection target; a cell click is not.
            event.stopPropagation();
            onActivate();
          }}
        />
      )}
    </CommandPreview>
  );
}
