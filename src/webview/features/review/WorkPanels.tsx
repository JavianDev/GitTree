import type { BranchInfo, Commit, StashEntry } from '@shared/model';

/** "3h", "2d" — the same compact age the commit tree shows. */
function age(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds < 86_400 * 365) return `${Math.floor(seconds / (86_400 * 30))}mo`;
  return `${Math.floor(seconds / (86_400 * 365))}y`;
}

export interface PushPanelProps {
  commits: readonly Commit[];
  hasUpstream: boolean;
  branch?: BranchInfo;
  onPush: () => void;
  onPull: () => void;
}

/** What a push would send, and the push itself — one tab away from the commit box. */
export function PushPanel({ commits, hasUpstream, branch, onPush, onPull }: PushPanelProps): React.JSX.Element {
  const target = hasUpstream ? branch?.upstream ?? 'its upstream' : `origin/${branch?.head ?? 'HEAD'} (new)`;
  const behind = branch?.behind ?? 0;

  const summary =
    branch?.detached === true
      ? 'HEAD is detached — check out a branch to push.'
      : commits.length === 0
        ? hasUpstream
          ? `Everything is pushed — up to date with ${target}.`
          : 'Nothing to push yet.'
        : `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'} to push to ${target}`;

  return (
    <div className="gt-work-panel">
      <div className="gt-work-summary">
        <span className="gt-work-summary-text">{summary}</span>
        <span className="gt-review-spacer" />
        {behind > 0 && (
          <button type="button" className="gt-button" data-size="small" onClick={onPull}>
            ↓ Pull {behind}
          </button>
        )}
        <button
          type="button"
          className="gt-button"
          data-variant="primary"
          data-size="small"
          disabled={branch?.detached === true || (commits.length === 0 && hasUpstream)}
          onClick={onPush}
        >
          ↑ Push
        </button>
      </div>

      {commits.length > 0 && (
        <ul className="gt-work-list">
          {commits.map((commit) => (
            <li key={commit.hash} className="gt-work-row" title={commit.subject}>
              <span className="gt-work-hash">{commit.shortHash}</span>
              <span className="gt-work-subject">{commit.subject}</span>
              <span className="gt-work-meta">{age(commit.commitDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface StashPanelProps {
  stashes: readonly StashEntry[];
  canStash: boolean;
  onStash: () => void;
  onApply: (ref: string) => void;
  onPop: (ref: string) => void;
  onDrop: (ref: string) => void;
}

/** Every stash, with its actions on the row — the sidebar's stash list, where the work is. */
export function StashPanel({ stashes, canStash, onStash, onApply, onPop, onDrop }: StashPanelProps): React.JSX.Element {
  return (
    <div className="gt-work-panel">
      <div className="gt-work-summary">
        <span className="gt-work-summary-text">
          {stashes.length === 0 ? 'No stashes.' : `${stashes.length} ${stashes.length === 1 ? 'stash' : 'stashes'}`}
        </span>
        <span className="gt-review-spacer" />
        <button
          type="button"
          className="gt-button"
          data-variant="primary"
          data-size="small"
          disabled={!canStash}
          title={canStash ? 'Stash your uncommitted changes' : 'Nothing to stash'}
          onClick={onStash}
        >
          Stash changes…
        </button>
      </div>

      {stashes.length > 0 && (
        <ul className="gt-work-list">
          {stashes.map((stash) => (
            <li key={stash.ref} className="gt-work-row" title={`${stash.ref}: ${stash.message}`}>
              <span className="gt-work-hash">{stash.ref.replace(/^stash/, '')}</span>
              <span className="gt-work-subject">{stash.message || '(no message)'}</span>
              <span className="gt-work-meta">
                {stash.branch ? `${stash.branch} · ` : ''}
                {age(stash.createdAt)}
              </span>
              <span className="gt-work-actions">
                <button type="button" className="gt-button" data-size="small" onClick={() => onApply(stash.ref)}>
                  Apply
                </button>
                <button type="button" className="gt-button" data-size="small" onClick={() => onPop(stash.ref)}>
                  Pop
                </button>
                <button
                  type="button"
                  className="gt-button"
                  data-size="small"
                  data-variant="destructive"
                  onClick={() => onDrop(stash.ref)}
                >
                  Drop
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
