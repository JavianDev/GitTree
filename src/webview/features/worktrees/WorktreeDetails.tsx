import { useEffect, useState } from 'react';
import type { Commit, FileStatus, StatusResult, WorktreeEntry } from '@shared/model';
import type { DiffTarget } from '@shared/protocol';
import { basename } from '@shared/worktrees';
import { RpcRequestError, rpc } from '../../rpc/client';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';
import { FileIcon } from '../review/FileIcon';
import { type WorktreeAction, colorMenu, colorVar, worktreeMenu } from './actions';
import './worktrees.css';

/** What the Code pane shows for a worktree: one file's diff, or one outgoing commit. */
export type WorktreeSelection =
  | { kind: 'file'; target: DiffTarget; label: string }
  | { kind: 'commit'; hash: string; label: string };

export interface WorktreeDetailsProps {
  entry: WorktreeEntry;
  /** The worktree's own repository id: its status, diffs, and log are read there. */
  worktreeRepoId?: string;
  revision: number;
  colorLabels: boolean;
  selection?: WorktreeSelection;
  onSelect: (selection: WorktreeSelection | undefined) => void;
  onAction: (action: WorktreeAction) => void;
}

/**
 * One worktree at a glance, in the Files pane: where it is, what branch, how
 * far from its upstream, and what is uncommitted or unpushed there — the
 * "Worktree Details" of the Visual Studio extension, built from the same
 * status and outgoing-commit reads the rest of Git Tree uses.
 *
 * Staging works here (the checkbox stages in *that* worktree); anything more
 * is a reason to open it, so the actions are at the top.
 */
export function WorktreeDetails({
  entry,
  worktreeRepoId,
  revision,
  colorLabels,
  selection,
  onSelect,
  onAction,
}: WorktreeDetailsProps): React.JSX.Element {
  const [status, setStatus] = useState<StatusResult | undefined>();
  const [outgoing, setOutgoing] = useState<{ commits: Commit[]; hasUpstream: boolean } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | undefined>();

  useEffect(() => {
    if (!worktreeRepoId) return;
    let cancelled = false;
    setError(undefined);
    Promise.all([
      rpc.request('status/get', { repoId: worktreeRepoId }),
      rpc.request('log/outgoing', { repoId: worktreeRepoId }),
    ])
      .then(([nextStatus, nextOutgoing]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setOutgoing(nextOutgoing);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof RpcRequestError ? reason.displayText : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeRepoId, revision, nonce]);

  const files = status?.files ?? [];
  const staged = files.filter((file) => file.staged && !file.conflicted);
  const changed = files.filter((file) => file.unstaged && file.kind !== 'untracked' && !file.conflicted);
  const untracked = files.filter((file) => file.kind === 'untracked');
  const conflicted = files.filter((file) => file.conflicted);
  const branch = status?.branch;
  const changes = staged.length + changed.length + untracked.length + conflicted.length;

  const stage = (file: FileStatus, on: boolean) => {
    if (!worktreeRepoId) return;
    void rpc
      .request(on ? 'stage/files' : 'unstage/files', { repoId: worktreeRepoId, paths: [file.path] })
      .then(() => setNonce((n) => n + 1))
      .catch((reason: unknown) => setError(reason instanceof RpcRequestError ? reason.displayText : String(reason)));
  };

  const selectFile = (file: FileStatus, side: 'index' | 'worktree' | 'untracked') => {
    if (!worktreeRepoId) return;
    onSelect({ kind: 'file', target: { kind: side, repoId: worktreeRepoId, path: file.path }, label: file.path });
  };

  const isSelectedFile = (file: FileStatus, side: string) =>
    selection?.kind === 'file' && selection.target.kind === side && 'path' in selection.target && selection.target.path === file.path;

  const fileRow = (file: FileStatus, side: 'index' | 'worktree' | 'untracked') => (
    <div
      key={`${side}:${file.path}`}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelectedFile(file, side)}
      className="gt-review-row gt-wt-file"
      onClick={() => selectFile(file, side)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectFile(file, side);
        }
      }}
    >
      <input
        type="checkbox"
        className="gt-stage-check"
        checked={side === 'index'}
        title={side === 'index' ? 'Unstage in this worktree' : 'Stage in this worktree'}
        aria-label={side === 'index' ? `Unstage ${file.path}` : `Stage ${file.path}`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => stage(file, event.target.checked)}
      />
      <FileIcon path={file.path} />
      <span className="gt-review-name" data-kind={file.kind}>
        {basename(file.path)}
      </span>
      {file.path.includes('/') && <span className="gt-wt-file-dir">{file.path.slice(0, file.path.lastIndexOf('/'))}</span>}
      <span className="gt-review-spacer" />
      <span className="gt-wt-file-kind" data-kind={file.kind}>
        {kindLetter(file, side)}
      </span>
    </div>
  );

  const group = (title: string, items: FileStatus[], side: 'index' | 'worktree' | 'untracked') => (
    <section className="gt-wt-group" key={title}>
      <h3 className="gt-wt-group-title">
        {title} <span className="gt-wt-group-count">({items.length})</span>
      </h3>
      {items.length === 0 ? <p className="gt-wt-group-empty">None.</p> : <div role="tree">{items.map((file) => fileRow(file, side))}</div>}
    </section>
  );

  const openMenu = (event: React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left;
    const y = box.bottom + 2;
    setMenu({
      x,
      y,
      items: worktreeMenu(entry, onAction, {
        canMoveRemove: true,
        ...(colorLabels ? { onColorMenu: () => setMenu({ x, y, items: colorMenu(entry, onAction) }) } : {}),
      }),
    });
  };

  const color = colorLabels ? entry.color : undefined;

  return (
    <div className="gt-wt-details">
      <header className="gt-wt-details-header">
        <div className="gt-wt-details-title">
          <span className="gt-wt-dot" data-color={color} style={color ? { background: colorVar(color) } : undefined} aria-hidden="true" />
          <h2>{entry.branch ?? (entry.bare ? 'bare repository' : basename(entry.path))}</h2>
          {entry.isMain && <span className="gt-kind-badge gt-wt-badge" data-kind="main">main</span>}
          {entry.isCurrent && <span className="gt-kind-badge gt-wt-badge" data-kind="current">current</span>}
          {entry.locked && <span className="gt-kind-badge gt-wt-badge" data-kind="locked">locked</span>}
        </div>

        <div className="gt-wt-details-path">
          <span className="gt-mono" title={entry.path}>
            {entry.path}
          </span>
          <button type="button" className="gt-button" data-size="small" onClick={() => onAction({ kind: 'copyPath', entry })}>
            Copy
          </button>
        </div>

        {!entry.missing && branch && (
          <p className="gt-wt-details-status">
            <span>
              {changes} change{changes === 1 ? '' : 's'}
            </span>
            {branch.upstream ? (
              <>
                <span>
                  ↑{branch.ahead} ↓{branch.behind}
                </span>
                <span>tracks {branch.upstream}</span>
              </>
            ) : (
              <span>{entry.detached ? `HEAD detached at ${entry.head?.slice(0, 7) ?? '?'}` : 'No upstream'}</span>
            )}
          </p>
        )}

        <div className="gt-wt-details-actions">
          <button
            type="button"
            className="gt-button"
            data-variant="primary"
            data-size="small"
            disabled={entry.missing || entry.bare || entry.isCurrent}
            title={entry.isCurrent ? 'This tab is already showing it.' : 'Open it as a Git Tree tab'}
            onClick={() => onAction({ kind: 'open', entry, target: 'gitTreeTab' })}
          >
            Open in Tab
          </button>
          <button type="button" className="gt-button" data-size="small" disabled={entry.missing || entry.bare} onClick={() => onAction({ kind: 'open', entry, target: 'newWindow' })}>
            New Window
          </button>
          <button type="button" className="gt-button" data-size="small" disabled={entry.missing || entry.bare} onClick={() => onAction({ kind: 'terminal', entry })}>
            Terminal
          </button>
          <button type="button" className="gt-button" data-size="small" onClick={() => onAction({ kind: 'reveal', entry })}>
            Reveal
          </button>
          <button type="button" className="gt-icon-button" aria-label="More actions" title="More actions" onClick={openMenu}>
            ⋯
          </button>
        </div>
      </header>

      {entry.missing && (
        <div className="gt-wt-banner" data-tone="warning">
          <span>The folder is missing. Prune clears git’s record of it; Repair reconnects it if you moved it.</span>
          <button type="button" className="gt-button" data-size="small" onClick={() => onAction({ kind: 'prune' })}>
            Prune…
          </button>
        </div>
      )}
      {entry.locked && (
        <div className="gt-wt-banner">
          <span>Locked{entry.lockReason ? `: ${entry.lockReason}` : ''}. Prune skips it; removing it needs --force twice.</span>
          <button type="button" className="gt-button" data-size="small" onClick={() => onAction({ kind: 'unlock', entry })}>
            Unlock…
          </button>
        </div>
      )}

      {error && (
        <div className="gt-settings-error" role="alert">
          <pre>{error}</pre>
        </div>
      )}

      {!entry.missing && !entry.bare && (
        <div className="gt-wt-details-body">
          {conflicted.length > 0 && group('Conflicts', conflicted, 'worktree')}
          {group('Staged Changes', staged, 'index')}
          {group('Changes', changed, 'worktree')}
          {group('Untracked Files', untracked, 'untracked')}

          <section className="gt-wt-group">
            <h3 className="gt-wt-group-title">
              {outgoing?.hasUpstream === false ? 'Unpublished Commits' : 'Outgoing Commits'}{' '}
              <span className="gt-wt-group-count">({outgoing?.commits.length ?? 0})</span>
            </h3>
            {outgoing && outgoing.commits.length > 0 ? (
              <table className="gt-wt-commits">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Author</th>
                    <th>Date</th>
                    <th>Id</th>
                  </tr>
                </thead>
                <tbody>
                  {outgoing.commits.map((commit) => (
                    <tr
                      key={commit.hash}
                      tabIndex={0}
                      aria-selected={selection?.kind === 'commit' && selection.hash === commit.hash}
                      onClick={() => onSelect({ kind: 'commit', hash: commit.hash, label: commit.subject })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onSelect({ kind: 'commit', hash: commit.hash, label: commit.subject });
                      }}
                    >
                      <td className="gt-wt-commit-subject">↑ {commit.subject}</td>
                      <td>{commit.author.name}</td>
                      <td>{commit.commitDate.slice(0, 10)}</td>
                      <td className="gt-mono">{commit.shortHash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="gt-wt-group-empty">{outgoing ? 'Nothing to push.' : 'Reading…'}</p>
            )}
          </section>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
    </div>
  );
}

function kindLetter(file: FileStatus, side: string): string {
  if (side === 'untracked') return '??';
  if (file.conflicted) return '!';
  const letter = side === 'index' ? file.index : file.worktree;
  return letter && letter !== '.' ? letter : 'M';
}
