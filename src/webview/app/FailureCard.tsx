import { useState } from 'react';
import { type FailureFix, type GitFailure, fixesFor, headlineFor } from './gitFailure';

const LABEL: Record<FailureFix, string> = {
  stashAndRetry: 'Stash & Retry',
  reviewChanges: 'Review Changes',
  pull: 'Pull…',
  pushSetUpstream: 'Push and Set Upstream…',
  openLog: 'Open Command Log',
};

const HINT: Record<FailureFix, string> = {
  stashAndRetry: 'Stash your changes (including untracked files), then run the same command again. Pop the stash later to get them back.',
  reviewChanges: 'Open Changes to commit, stash or discard what is in the way',
  pull: 'Bring in the remote’s commits first, then push again',
  pushSetUpstream: 'Push and remember the remote branch for future pulls and pushes',
  openLog: 'See every command that ran, with its full output',
};

export interface FailureCardProps {
  failure: GitFailure;
  onFix: (fix: FailureFix) => void;
  onCopy: (text: string) => void;
  onDismiss: () => void;
}

/**
 * A git failure as a card floating over the window, not a banner that pushes
 * every pane down. It leads with a plain headline and the fixes; git's own
 * words are one click away, and always copyable.
 */
export function FailureCard({ failure, onFix, onCopy, onDismiss }: FailureCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const fixes = fixesFor(failure);
  const primary = fixes.filter((fix) => fix !== 'openLog');

  return (
    <div className="gt-failure" role="alert">
      <div className="gt-failure-head">
        <span className="gt-failure-icon" aria-hidden="true">
          !
        </span>
        <strong className="gt-failure-title">{headlineFor(failure.text)}</strong>
        <button type="button" className="gt-failure-close" aria-label="Dismiss" title="Dismiss (Esc)" onClick={onDismiss}>
          ×
        </button>
      </div>

      <button type="button" className="gt-failure-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} What git said
      </button>
      {open && <pre className="gt-failure-text">{failure.text}</pre>}

      <div className="gt-failure-actions">
        {primary.map((fix, index) => (
          <button
            type="button"
            key={fix}
            className="gt-button"
            data-size="small"
            {...(index === 0 ? { 'data-variant': 'primary' } : {})}
            title={HINT[fix]}
            onClick={() => onFix(fix)}
          >
            {LABEL[fix]}
          </button>
        ))}
        <span className="gt-failure-spacer" />
        <button type="button" className="gt-button" data-size="small" title="Copy git's message" onClick={() => onCopy(failure.text)}>
          Copy
        </button>
        <button type="button" className="gt-button" data-size="small" title={HINT.openLog} onClick={() => onFix('openLog')}>
          Command Log
        </button>
      </div>
    </div>
  );
}
