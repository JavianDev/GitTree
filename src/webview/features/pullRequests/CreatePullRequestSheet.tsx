import { useEffect, useState } from 'react';
import type { RefEntry } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';

export interface CreatePullRequestSheetProps {
  repoId: string;
  currentBranch?: string;
  onClose: () => void;
  onCreated: (id: number) => void;
}

const DEFAULT_TARGETS = ['main', 'master'];

/** Source/target branch pickers, title, description, draft — the create form. */
export function CreatePullRequestSheet({
  repoId,
  currentBranch,
  onClose,
  onCreated,
}: CreatePullRequestSheetProps): React.JSX.Element {
  const [branches, setBranches] = useState<RefEntry[]>([]);
  const [sourceBranch, setSourceBranch] = useState(currentBranch ?? '');
  const [targetBranch, setTargetBranch] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pushFirst, setPushFirst] = useState(true);

  /*
   * A pull request is opened between two branches *on the host*. A branch that
   * exists only here — or whose newest commits are only here — makes the host
   * refuse ("head invalid") or open a PR without them, so it is pushed first.
   */
  const sourceRef = branches.find((ref) => ref.name === sourceBranch);
  const remote = sourceRef?.upstream && !sourceRef.gone ? sourceRef.upstream.split('/')[0]! : 'origin';
  const unpublished = sourceRef !== undefined && (!sourceRef.upstream || sourceRef.gone === true);
  const unpushed = sourceRef !== undefined && !unpublished ? (sourceRef.ahead ?? 0) : 0;
  const needsPush = unpublished || unpushed > 0;
  const pushArgv = ['push', ...(unpublished ? ['--set-upstream'] : []), remote, sourceBranch];

  useEffect(() => {
    void rpc
      .request('refs/list', { repoId })
      .then((result) => {
        const local = result.refs.filter((ref) => ref.kind === 'localBranch');
        setBranches(local);

        if (!targetBranch) {
          const fallback = DEFAULT_TARGETS.find((name) => local.some((ref) => ref.name === name));
          if (fallback) setTargetBranch(fallback);
        }
      })
      .catch(() => undefined);
    // Only on mount / repo change — re-running on every keystroke of the form
    // would refetch branches for no reason.
  }, [repoId]);

  const create = async () => {
    if (!sourceBranch || !targetBranch || !title.trim() || running) return;
    setRunning(true);
    setError(undefined);

    try {
      if (needsPush && pushFirst) {
        const pushed = await rpc.request('commands/run', { repoId, argv: pushArgv });
        if (pushed.exitCode !== 0) {
          setError(`Pushing ${sourceBranch} failed, so the pull request was not created:

${(pushed.stderr || pushed.stdout).trim()}`);
          return;
        }
      }
      const result = await rpc.request('pullRequests/create', {
        repoId,
        title,
        description,
        sourceBranch,
        targetBranch,
        isDraft,
      });
      onCreated(result.id);
      onClose();
    } catch (caught) {
      const text = caught instanceof RpcRequestError ? caught.displayText : String(caught);
      // GitHub's 422 for a head it cannot find, said plainly.
      setError(
        /"field"\s*:\s*"head"/.test(text)
          ? `${remote} has no branch named ${sourceBranch}, so there is nothing to open a pull request from. Push the branch, then try again.

${text}`
          : text,
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="gt-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="gt-sheet-title">New Pull Request</h2>

        <div className="gt-pr-branch-pickers">
          <select className="gt-settings-select" value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)}>
            <option value="" disabled>
              Source branch…
            </option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
          <span aria-hidden="true">→</span>
          <select className="gt-settings-select" value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)}>
            <option value="" disabled>
              Target branch…
            </option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        {needsPush && (
          <label className="gt-checkbox gt-pr-push-first">
            <input type="checkbox" checked={pushFirst} onChange={(event) => setPushFirst(event.target.checked)} />
            <span>
              {unpublished
                ? `Push ${sourceBranch} to ${remote} first — it isn’t there yet`
                : `Push ${unpushed} new ${unpushed === 1 ? 'commit' : 'commits'} on ${sourceBranch} first`}
              <code className="gt-pr-push-command">git {pushArgv.join(' ')}</code>
            </span>
          </label>
        )}

        <input
          type="text"
          className="gt-text-input"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />

        <textarea
          className="gt-text-input"
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
        />

        <label className="gt-checkbox">
          <input type="checkbox" checked={isDraft} onChange={(event) => setIsDraft(event.target.checked)} />
          Draft
        </label>

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
            data-variant="primary"
            disabled={running || !sourceBranch || !targetBranch || !title.trim() || sourceBranch === targetBranch}
            onClick={() => void create()}
          >
            {running ? 'Creating…' : needsPush && pushFirst ? 'Push & Create' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
