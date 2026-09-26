import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileChangeKind, FileStatus, RepoId, StatusResult } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';

/** Single-character glyph per change kind. */
const GLYPH: Record<FileChangeKind, string> = {
  added: 'A',
  copied: 'C',
  conflicted: '!',
  deleted: 'D',
  ignored: 'I',
  modified: 'M',
  renamed: 'R',
  typechange: 'T',
  untracked: '?',
};

export interface StatusViewProps {
  repoId: RepoId;
  revision: number;
  selectedPath?: string;
  onSelect: (file: FileStatus | undefined) => void;
  onError: (error: string | undefined) => void;
}

export function StatusView({
  repoId,
  revision,
  selectedPath,
  onSelect,
  onError,
}: StatusViewProps): React.JSX.Element {
  const [status, setStatus] = useState<StatusResult | undefined>();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await rpc.request('status/get', { repoId }));
      onError(undefined);
    } catch (error) {
      onError(error instanceof RpcRequestError ? error.displayText : String(error));
    }
  }, [repoId, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const groups = useMemo(() => {
    const files = status?.files ?? [];
    return {
      conflicted: files.filter((file) => file.conflicted),
      staged: files.filter((file) => file.staged && !file.conflicted),
      unstaged: files.filter((file) => file.unstaged && !file.staged && !file.conflicted),
      both: files.filter((file) => file.staged && file.unstaged && !file.conflicted),
    };
  }, [status]);

  /** Runs a mutation, then refreshes. Errors surface verbatim. */
  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        onError(undefined);
        await refresh();
      } catch (error) {
        onError(error instanceof RpcRequestError ? error.displayText : String(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh, onError],
  );

  const stage = (paths: string[]) => mutate(() => rpc.request('stage/files', { repoId, paths }));
  const unstage = (paths: string[]) => mutate(() => rpc.request('unstage/files', { repoId, paths }));

  const commit = () =>
    mutate(async () => {
      await rpc.request('commit/create', { repoId, message, amend, signoff });
      setMessage('');
      setAmend(false);
    });

  const stagedCount = groups.staged.length + groups.both.length;
  const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy;

  return (
    <>
      <div className="gt-scroll">
        {groups.conflicted.length > 0 && (
          <FileGroup
            title="Conflicts"
            files={groups.conflicted}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        )}

        <FileGroup
          title="Staged"
          files={[...groups.staged, ...groups.both]}
          selectedPath={selectedPath}
          onSelect={onSelect}
          action={{
            label: 'Unstage All',
            disabled: busy || stagedCount === 0,
            onClick: () => void unstage([...groups.staged, ...groups.both].map((file) => file.path)),
          }}
          rowAction={{ label: 'Unstage', onClick: (file) => void unstage([file.path]) }}
        />

        <FileGroup
          title="Changes"
          files={[...groups.unstaged, ...groups.both]}
          selectedPath={selectedPath}
          onSelect={onSelect}
          action={{
            label: 'Stage All',
            disabled: busy || groups.unstaged.length + groups.both.length === 0,
            onClick: () =>
              void stage([...groups.unstaged, ...groups.both].map((file) => file.path)),
          }}
          rowAction={{
            label: 'Stage',
            onClick: (file) => void stage([file.path]),
            // Staging a nested repository would commit an empty gitlink rather
            // than its contents, so the action is refused outright.
            disabledFor: (file) => file.nestedRepoId !== undefined,
            disabledTitle: 'This is a separate repository. Add it as a submodule instead.',
          }}
        />

        {(status?.files.length ?? 0) === 0 && (
          <div className="gt-empty">
            <p className="gt-empty-title">Nothing to commit</p>
            <p className="gt-empty-detail">The working tree is clean.</p>
          </div>
        )}
      </div>

      <div className="gt-commit-box">
        <textarea
          className="gt-commit-input"
          placeholder={amend ? 'Amend the last commit…' : 'Commit message'}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-label="Commit message"
        />

        <div className="gt-commit-actions">
          <label className="gt-checkbox">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            Amend
          </label>
          <label className="gt-checkbox">
            <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
            Sign off
          </label>

          <span style={{ flex: 1 }} />

          <span className="gt-source-meta">
            {stagedCount} staged
          </span>
          <button
            type="button"
            className="gt-button"
            data-variant="primary"
            disabled={!canCommit}
            onClick={() => void commit()}
          >
            {amend ? 'Amend Commit' : 'Commit'}
          </button>
        </div>
      </div>
    </>
  );
}

interface RowAction {
  label: string;
  onClick: (file: FileStatus) => void;
  disabledFor?: (file: FileStatus) => boolean;
  disabledTitle?: string;
}

function FileGroup({
  title,
  files,
  selectedPath,
  onSelect,
  action,
  rowAction,
}: {
  title: string;
  files: FileStatus[];
  selectedPath?: string;
  onSelect: (file: FileStatus | undefined) => void;
  action?: { label: string; disabled?: boolean; onClick: () => void };
  rowAction?: RowAction;
}): React.JSX.Element | null {
  if (files.length === 0 && !action) return null;

  return (
    <section>
      <header className="gt-group-header">
        <span>{title}</span>
        <span className="gt-group-count">{files.length}</span>
        <span style={{ flex: 1 }} />
        {action && (
          <button
            type="button"
            className="gt-button"
            data-size="small"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </header>

      {files.map((file) => {
        const blocked = rowAction?.disabledFor?.(file) ?? false;

        return (
          <div
            key={`${title}:${file.path}`}
            className="gt-file-row"
            role="option"
            tabIndex={0}
            aria-selected={selectedPath === file.path}
            onClick={() => onSelect(file)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(file);
              }
            }}
          >
            <span className="gt-status-glyph" data-kind={file.kind} title={file.kind}>
              {GLYPH[file.kind]}
            </span>

            <span className="gt-file-path" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
              {file.path}
            </span>

            {rowAction && (
              <button
                type="button"
                className="gt-button"
                data-size="small"
                disabled={blocked}
                title={blocked ? rowAction.disabledTitle : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  rowAction.onClick(file);
                }}
              >
                {rowAction.label}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
