import { useEffect, useState } from 'react';
import { COMMANDS, type CommandSpec, renderArgv } from '@shared/commands';
import type { RefEntry, WorktreeEntry, WorktreeSummary } from '@shared/model';
import { changeCount, requiredForce } from '@shared/worktrees';
import { rpc } from '../../rpc/client';
import { type PlanStep, PlanList, usePlanRunner } from './PlanRunner';
import './worktrees.css';

export interface RemoveWorktreeSheetProps {
  repoId: string;
  entry: WorktreeEntry;
  onExplain: (spec: CommandSpec) => void;
  onClose: () => void;
  onRemoved: () => void;
}

/**
 * Remove Worktree.
 *
 * git refuses to remove a worktree with uncommitted changes unless told
 * `--force`, and a locked one unless told twice. Rather than offering one
 * "force" switch, the sheet reads the worktree's state and asks for exactly
 * the level it needs, saying why, before Apply is enabled.
 */
export function RemoveWorktreeSheet({ repoId, entry, onExplain, onClose, onRemoved }: RemoveWorktreeSheetProps): React.JSX.Element {
  const [summary, setSummary] = useState<WorktreeSummary | undefined>();
  const [branchRef, setBranchRef] = useState<RefEntry | undefined>();
  const [deleteGoneDefault, setDeleteGoneDefault] = useState(false);
  const [force, setForce] = useState(false);
  const [forceLocked, setForceLocked] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const runner = usePlanRunner();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.request('worktrees/summary', { repoId, paths: [entry.path], force: true }),
      rpc.request('refs/list', { repoId }),
      rpc.request('worktrees/config', { repoId }),
    ])
      .then(([summaries, refs, config]) => {
        if (cancelled) return;
        setSummary(summaries.summaries[0]);
        const ref = refs.refs.find((candidate) => candidate.kind === 'localBranch' && candidate.name === entry.branch);
        setBranchRef(ref);
        setDeleteGoneDefault(config.effective.deleteGoneBranchOnRemove);
        if (ref?.gone && config.effective.deleteGoneBranchOnRemove) setDeleteBranch(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoId, entry.path, entry.branch]);

  const required = requiredForce(entry, summary);
  const level = forceLocked ? 2 : force ? 1 : 0;
  const changes = changeCount(summary);

  const removeArgv = COMMANDS['worktree.remove'].build({ worktreePath: entry.path, force, forceLocked });
  const deleteArgv = entry.branch ? COMMANDS['branch.delete'].build({ branch: entry.branch, forceDelete }) : undefined;

  const run = async (argv: string[]) => {
    const result = await rpc.request('commands/run', { repoId, argv });
    return { ok: result.exitCode === 0, output: (result.stderr || result.stdout).trim() };
  };

  const steps: PlanStep[] = [{ id: 'remove', label: 'Remove the worktree', command: renderArgv(removeArgv), run: () => run(removeArgv) }];
  if (deleteBranch && deleteArgv) steps.push({ id: 'branch', label: 'Delete its branch', command: renderArgv(deleteArgv), run: () => run(deleteArgv) });

  const blocker =
    level < required
      ? required === 2
        ? 'It is locked: tick “Force, even though it is locked” (passes --force twice).'
        : `It has ${changes} uncommitted change${changes === 1 ? '' : 's'}: tick “Force” to discard them.`
      : !confirmed
        ? 'Confirm below to remove it.'
        : undefined;

  const apply = async () => {
    const ok = await runner.run(steps);
    onRemoved();
    if (ok) onClose();
  };

  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={runner.running ? undefined : onClose}>
      <div className="gt-sheet gt-wt-sheet" role="dialog" aria-modal="true" aria-labelledby="gt-wt-remove-title" onClick={(event) => event.stopPropagation()}>
        <h2 className="gt-sheet-title" id="gt-wt-remove-title">
          Remove Worktree
        </h2>
        <p className="gt-sheet-summary">
          Deletes the folder <span className="gt-mono">{entry.path}</span> and git’s record of it.
          {entry.branch ? ` The branch ${entry.branch} is kept unless you delete it too.` : ''}
        </p>
        <p className="gt-sheet-body">
          {summary
            ? changes > 0
              ? `It has ${changes} uncommitted change${changes === 1 ? '' : 's'}, which removing it would lose.`
              : 'It has no uncommitted changes.'
            : 'Reading its state…'}{' '}
          {entry.locked ? `It is locked${entry.lockReason ? `: ${entry.lockReason}` : ''}.` : ''} Git Tree’s terminal for it is closed first.
        </p>

        <div className="gt-cmd-options">
          <label className="gt-checkbox" title="--force: discard uncommitted changes">
            <input type="checkbox" checked={force || forceLocked} disabled={forceLocked} onChange={(event) => setForce(event.target.checked)} />
            Force{changes > 0 ? ` (discard ${changes} change${changes === 1 ? '' : 's'})` : ''}
          </label>
          {entry.locked && (
            <label className="gt-checkbox" title="--force --force">
              <input type="checkbox" checked={forceLocked} onChange={(event) => setForceLocked(event.target.checked)} />
              Force, even though it is locked
            </label>
          )}
          {entry.branch && (
            <label className="gt-checkbox" title={branchRef?.gone ? 'Its remote branch is gone' : undefined}>
              <input type="checkbox" checked={deleteBranch} onChange={(event) => setDeleteBranch(event.target.checked)} />
              Also delete the branch {entry.branch}
              {branchRef?.gone ? ' (its remote branch is gone)' : ''}
            </label>
          )}
          {deleteBranch && (
            <label className="gt-checkbox" title="-D: delete even with unmerged commits">
              <input type="checkbox" checked={forceDelete} onChange={(event) => setForceDelete(event.target.checked)} />
              Even if unmerged (-D)
            </label>
          )}
        </div>
        {!deleteGoneDefault && branchRef?.gone && !deleteBranch && (
          <p className="gt-wt-hint">Settings ▸ Worktrees can pre-tick this whenever the remote branch is gone.</p>
        )}

        <PlanList steps={steps} states={runner.states} outputs={runner.outputs} />

        <label className="gt-checkbox gt-sheet-warning">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Untracked files in that folder are deleted too. Remove it anyway.
        </label>

        {blocker && confirmed && <p className="gt-wt-hint" data-tone="error">{blocker}</p>}

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" onClick={() => onExplain(COMMANDS['worktree.remove'])} style={{ marginRight: 'auto' }}>
            Why this command?
          </button>
          <button type="button" className="gt-button" disabled={runner.running} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="gt-button" data-variant="destructive" disabled={runner.running || blocker !== undefined} title={blocker} onClick={() => void apply()}>
            {runner.running ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
