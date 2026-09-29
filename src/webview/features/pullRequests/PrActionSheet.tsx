import { useState } from 'react';
import type { PullRequestDetail, PullRequestVote } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';

export type PrActionKind =
  | { kind: 'vote'; vote: PullRequestVote }
  | { kind: 'complete' }
  | { kind: 'abandon' };

export interface PrActionSheetProps {
  repoId: string;
  pr: PullRequestDetail;
  action: PrActionKind;
  onClose: () => void;
  onApplied: () => void;
}

const VOTE_TITLE: Record<PullRequestVote, string> = {
  approved: 'Approve',
  approvedWithSuggestions: 'Approve with Suggestions',
  rejected: 'Reject',
  waitingForAuthor: 'Wait for Author',
  noVote: 'Reset Vote',
};

/**
 * The review-before-run surface for PR actions — visually consistent with
 * `CommandSheet` (same sheet/backdrop CSS) but not literally
 * `CommandSpec.build()`-driven, since these are HTTP calls, not git argv.
 */
export function PrActionSheet({ repoId, pr, action, onClose, onApplied }: PrActionSheetProps): React.JSX.Element {
  const [squashMerge, setSquashMerge] = useState(pr.completionOptions?.squashMerge ?? false);
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(pr.completionOptions?.deleteSourceBranch ?? true);
  const [bypassPolicy, setBypassPolicy] = useState(false);
  const [bypassReason, setBypassReason] = useState('');
  // Starts unchecked whenever a confirmation could ever be required — voting
  // never needs one, so it starts true there and the row never renders.
  const [confirmed, setConfirmed] = useState(action.kind === 'vote');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const title =
    action.kind === 'vote' ? VOTE_TITLE[action.vote] : action.kind === 'complete' ? 'Complete Pull Request' : 'Abandon Pull Request';

  const destructive = action.kind === 'abandon' || (action.kind === 'vote' && action.vote === 'rejected');
  const needsConfirm = action.kind === 'abandon' || (action.kind === 'complete' && bypassPolicy);

  const apply = async () => {
    if (running || (needsConfirm && !confirmed)) return;
    setRunning(true);
    setError(undefined);

    try {
      if (action.kind === 'vote') {
        await rpc.request('pullRequests/vote', { repoId, id: pr.id, vote: action.vote });
      } else if (action.kind === 'complete') {
        await rpc.request('pullRequests/complete', {
          repoId,
          id: pr.id,
          squashMerge,
          deleteSourceBranch,
          bypassPolicy,
          ...(bypassPolicy && bypassReason ? { mergeCommitMessage: bypassReason } : {}),
        });
      } else {
        await rpc.request('pullRequests/abandon', { repoId, id: pr.id });
      }
      onApplied();
      onClose();
    } catch (caught) {
      setError(caught instanceof RpcRequestError ? caught.displayText : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="gt-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="gt-sheet-title">{title}</h2>
        <p className="gt-sheet-summary">
          {pr.title} ({pr.sourceBranch} → {pr.targetBranch})
        </p>

        {action.kind === 'complete' && (
          <div className="gt-cmd-options">
            <label className="gt-checkbox">
              <input type="checkbox" checked={squashMerge} onChange={(event) => setSquashMerge(event.target.checked)} />
              Squash merge
            </label>
            <label className="gt-checkbox">
              <input
                type="checkbox"
                checked={deleteSourceBranch}
                onChange={(event) => setDeleteSourceBranch(event.target.checked)}
              />
              Delete source branch
            </label>
            {pr.capabilities.bypassPolicy && (
              <label className="gt-checkbox">
                <input type="checkbox" checked={bypassPolicy} onChange={(event) => setBypassPolicy(event.target.checked)} />
                Bypass policy
              </label>
            )}
          </div>
        )}

        {action.kind === 'complete' && bypassPolicy && (
          <label className="gt-cmd-option-text">
            <span>Reason</span>
            <input
              type="text"
              className="gt-text-input"
              value={bypassReason}
              onChange={(event) => setBypassReason(event.target.value)}
              placeholder="Required to bypass branch policy"
            />
          </label>
        )}

        {needsConfirm && (
          <label className="gt-checkbox gt-sheet-warning">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {action.kind === 'abandon'
              ? 'This closes the pull request without merging it. Continue anyway.'
              : 'This bypasses required branch policy. Continue anyway.'}
          </label>
        )}

        {error && (
          <div className="gt-cmd-result" data-failed="true">
            <pre>{error}</pre>
          </div>
        )}

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gt-button"
            data-variant={destructive ? 'destructive' : 'primary'}
            disabled={running || (needsConfirm && !confirmed)}
            onClick={() => void apply()}
          >
            {running ? 'Running…' : title}
          </button>
        </div>
      </div>
    </div>
  );
}
