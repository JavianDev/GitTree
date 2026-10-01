import type { RefEntry, WorktreeEntry, WorktreeOpenTarget } from '@shared/model';
import './worktrees.css';

/**
 * Shown instead of `git switch` when the branch is checked out in another
 * worktree. git keeps a branch in one worktree at a time, so the switch would
 * fail; going to that worktree is what the user actually wants.
 */
export function BranchInWorktreeSheet({
  ref_,
  entry,
  onOpen,
  onClose,
}: {
  ref_: RefEntry;
  entry: WorktreeEntry;
  onOpen: (target: WorktreeOpenTarget) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="gt-sheet gt-wt-sheet" role="dialog" aria-modal="true" aria-labelledby="gt-wt-held-title" onClick={(event) => event.stopPropagation()}>
        <h2 className="gt-sheet-title" id="gt-wt-held-title">
          {ref_.name} is checked out in another worktree
        </h2>
        <p className="gt-sheet-summary">
          It is checked out in <span className="gt-mono">{entry.path}</span>.
        </p>
        <p className="gt-sheet-body">
          git keeps a branch in one worktree at a time, so it cannot be checked out here as well. Work on it in its worktree instead.
        </p>
        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="gt-button" onClick={() => onOpen('newWindow')}>
            Open in New Window
          </button>
          <button type="button" className="gt-button" data-variant="primary" autoFocus onClick={() => onOpen('gitTreeTab')}>
            Open Its Worktree
          </button>
        </div>
      </div>
    </div>
  );
}
