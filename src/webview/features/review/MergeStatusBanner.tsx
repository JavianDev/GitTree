import type { CommandId } from '@shared/commands';
import type { MergeOperation, MergeOperationKind } from '@shared/model';

export interface MergeStatusBannerProps {
  operation: MergeOperation;
  conflictedCount: number;
  /** See `ReviewPane.tsx`'s `mineTheirsLabels` — correct even though the
   * meaning reverses during a rebase. */
  mineLabel?: string;
  theirsLabel?: string;
  /** Opens the review-before-run command sheet for a flat, single-argv action. */
  onRunCommand: (id: CommandId) => void;
}

const OPERATION_LABEL: Record<MergeOperationKind, string> = {
  merge: 'Merging',
  rebase: 'Rebasing',
  cherryPick: 'Cherry-picking',
  revert: 'Reverting',
};

/** No entry for `merge`: completing one is an ordinary commit, not a `--continue`. */
const CONTINUE_ID: Partial<Record<MergeOperationKind, CommandId>> = {
  rebase: 'rebase.continue',
  cherryPick: 'cherryPick.continue',
  revert: 'revert.continue',
};

const ABORT_ID: Record<MergeOperationKind, CommandId> = {
  merge: 'merge.abort',
  rebase: 'rebase.abort',
  cherryPick: 'cherryPick.abort',
  revert: 'revert.abort',
};

/**
 * The persistent explanation the user asked for — not a tooltip, always
 * visible while a conflict is unresolved. A rebase reverses what "ours"/
 * "theirs" mean (git replays your commits on top of the target, so the
 * target becomes "ours" mid-conflict), which is exactly the kind of thing
 * worth saying outright rather than assuming it will be inferred correctly.
 */
function explainer(operation: MergeOperation, mineLabel: string | undefined, theirsLabel: string | undefined): string {
  const mine = mineLabel ?? 'your current branch';
  const theirs = theirsLabel ?? 'the incoming side';

  if (operation.kind === 'rebase') {
    return `Mine = ${mine} (the branch you're rebasing onto — git calls this "ours" during a rebase, which can feel backwards). Theirs = ${theirs} (your own commit being replayed).`;
  }

  return `Mine = ${mine} (your current branch). Theirs = ${theirs}.`;
}

export function MergeStatusBanner({
  operation,
  conflictedCount,
  mineLabel,
  theirsLabel,
  onRunCommand,
}: MergeStatusBannerProps): React.JSX.Element {
  const continueId = CONTINUE_ID[operation.kind];
  const canContinue = conflictedCount === 0;

  const title =
    OPERATION_LABEL[operation.kind] +
    (operation.incomingRef ? ` ${operation.incomingRef}` : '') +
    (operation.kind === 'rebase' && operation.ontoRef ? ` onto ${operation.ontoRef}` : '');

  return (
    <div className="gt-merge-banner" role="status">
      <div className="gt-merge-banner-head">
        <span className="gt-merge-banner-title">{title}</span>
        {conflictedCount > 0 && (
          <span className="gt-merge-banner-count">
            {conflictedCount} conflict{conflictedCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <p className="gt-merge-banner-explain">{explainer(operation, mineLabel, theirsLabel)}</p>

      <div className="gt-merge-banner-actions">
        {continueId ? (
          <button
            type="button"
            className="gt-button"
            data-variant="primary"
            disabled={!canContinue}
            title={canContinue ? undefined : 'Resolve every conflict first.'}
            onClick={() => onRunCommand(continueId)}
          >
            Continue
          </button>
        ) : (
          <span className="gt-merge-banner-hint">
            {canContinue ? 'Commit below to complete the merge.' : 'Resolve every conflict, then commit below.'}
          </span>
        )}

        <button type="button" className="gt-button" data-variant="destructive" onClick={() => onRunCommand(ABORT_ID[operation.kind])}>
          Abort
        </button>
      </div>
    </div>
  );
}
