import type { RepoState } from '@shared/model';

export interface BottomRibbonProps {
  state?: RepoState;
  logOpen: boolean;
  onToggleLog: () => void;
  onTerminal: () => void;
  busyLabel?: string;
}

/**
 * The status ribbon along the bottom.
 *
 * Two jobs at once: the repository's state at a glance — branch, divergence,
 * pending work — and the controls that belong at the edge of the window rather
 * than in the action toolbar. Progress lands here too, so a long fetch reports
 * itself somewhere permanent instead of in a notification that disappears.
 */
export function BottomRibbon({
  state,
  logOpen,
  onToggleLog,
  onTerminal,
  busyLabel,
}: BottomRibbonProps): React.JSX.Element {
  const branch = state?.branch;
  const counts = state?.counts;
  const pending = (counts?.staged ?? 0) + (counts?.unstaged ?? 0) + (counts?.untracked ?? 0);

  return (
    <footer className="gt-ribbon" aria-label="Repository status">
      <span className="gt-ribbon-branch" title="Current branch">
        <span aria-hidden="true">⑂</span>
        {branch?.detached ? 'detached HEAD' : (branch?.head ?? '—')}
      </span>

      {branch && branch.ahead > 0 && (
        <span className="gt-ribbon-item" title={`${branch.ahead} commits to push`}>
          ↑{branch.ahead}
        </span>
      )}
      {branch && branch.behind > 0 && (
        <span className="gt-ribbon-item" title={`${branch.behind} commits to pull`}>
          ↓{branch.behind}
        </span>
      )}

      {pending > 0 && (
        <span className="gt-ribbon-item" title="Uncommitted changes">
          {pending}∆
        </span>
      )}

      {counts && counts.conflicted > 0 && (
        <span className="gt-ribbon-item" data-alert="true" title="Conflicted files">
          {counts.conflicted} conflicts
        </span>
      )}

      <span className="gt-toolbar-spacer" />

      {/* An aria-live region: a long-running fetch should announce itself rather
          than only being visible. */}
      <span className="gt-ribbon-busy" role="status" aria-live="polite">
        {busyLabel ?? (state?.busy ? 'Working…' : '')}
      </span>

      <button type="button" className="gt-ribbon-button" onClick={onTerminal} title="Open a terminal here">
        Terminal
      </button>

      <button
        type="button"
        className="gt-ribbon-button"
        onClick={onToggleLog}
        aria-expanded={logOpen}
        title="Every git command GitTree has run"
      >
        <span aria-hidden="true">{logOpen ? '▾' : '▴'}</span> Command Log
      </button>
    </footer>
  );
}
