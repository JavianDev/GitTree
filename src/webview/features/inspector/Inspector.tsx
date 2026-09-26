import { useEffect, useState } from 'react';
import type { Commit, DiffFile, FileStatus, RepoId } from '@shared/model';
import type { DiffTarget } from '@shared/protocol';
import { RpcRequestError, rpc } from '../../rpc/client';

export interface InspectorProps {
  repoId?: RepoId;
  file?: FileStatus;
  commit?: Commit;
}

/**
 * Detail pane for whatever is selected.
 *
 * Mirrors the macOS inspector: metadata at the top, content below, and never a
 * separate window. Diffs are fetched lazily on selection rather than kept
 * alongside the list, which keeps a large status list cheap.
 */
export function Inspector({ repoId, file, commit }: InspectorProps): React.JSX.Element {
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!repoId) {
      setDiff([]);
      return;
    }

    const target: DiffTarget | undefined = file
      ? // A staged-only change has nothing in the worktree to diff, so the
        // index is the right side to show.
        file.staged && !file.unstaged
        ? { kind: 'index', repoId, path: file.path }
        : { kind: 'worktree', repoId, path: file.path }
      : commit
        ? { kind: 'commit', repoId, hash: commit.hash }
        : undefined;

    if (!target) {
      setDiff([]);
      return;
    }

    let cancelled = false;
    setError(undefined);

    void rpc
      .request('diff/get', target)
      .then((files) => {
        if (!cancelled) setDiff(files);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof RpcRequestError ? cause.displayText : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, file, commit]);

  if (!file && !commit) {
    return (
      <aside className="gt-inspector">
        <p className="gt-empty-detail">Select a file or a commit to see its details.</p>
      </aside>
    );
  }

  return (
    <aside className="gt-inspector" aria-label="Details">
      {commit && <CommitDetails commit={commit} />}

      {file && (
        <>
          <h2 className="gt-inspector-title">{basename(file.path)}</h2>
          <dl>
            <Field label="Path" value={file.path} mono />
            {file.origPath && <Field label="Renamed" value={`from ${file.origPath}`} mono />}
            <Field label="Change" value={file.kind} />
            <Field
              label="State"
              value={[file.staged && 'staged', file.unstaged && 'unstaged'].filter(Boolean).join(', ') || '—'}
            />
            {file.conflict && <Field label="Conflict" value={file.conflict.code} mono />}
          </dl>

          {repoId && (
            <p style={{ marginTop: 'var(--gt-space-3)' }}>
              <button
                type="button"
                className="gt-button"
                data-size="small"
                onClick={() => void rpc.request('editor/open', { repoId, path: file.path })}
              >
                Open in Editor
              </button>
            </p>
          )}
        </>
      )}

      {error && (
        <div className="gt-error">
          <strong>Could not load the diff</strong>
          <pre>{error}</pre>
        </div>
      )}

      {diff.map((entry) => (
        <DiffPanel key={entry.path} file={entry} />
      ))}
    </aside>
  );
}

function CommitDetails({ commit }: { commit: Commit }): React.JSX.Element {
  return (
    <>
      <h2 className="gt-inspector-title">{commit.subject}</h2>
      <dl>
        <Field label="Commit" value={commit.hash} mono />
        <Field label="Author" value={`${commit.author.name} <${commit.author.email}>`} />
        <Field label="Authored" value={formatDate(commit.authorDate)} />
        {commit.committer.email !== commit.author.email && (
          <Field label="Committer" value={`${commit.committer.name} <${commit.committer.email}>`} />
        )}
        <Field label="Committed" value={formatDate(commit.commitDate)} />
        <Field label="Parents" value={commit.parents.length === 0 ? 'root commit' : String(commit.parents.length)} />
        {commit.signature !== 'none' && <Field label="Signature" value={commit.signature} />}
      </dl>

      {commit.body && (
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--gt-space-3)', fontSize: 'var(--gt-text-callout)' }}>
          {commit.body}
        </p>
      )}
    </>
  );
}

function DiffPanel({ file }: { file: DiffFile }): React.JSX.Element {
  return (
    <section style={{ marginTop: 'var(--gt-space-4)' }}>
      <header className="gt-group-header">
        <span>{basename(file.path)}</span>
        <span className="gt-group-count">
          +{file.additions} −{file.deletions}
        </span>
      </header>

      {file.binary ? (
        <p className="gt-empty-detail" style={{ padding: 'var(--gt-space-3)' }}>
          Binary file — no textual diff.
        </p>
      ) : (
        <div className="gt-diff">
          {file.hunks.map((hunk, index) => (
            <div key={`${hunk.oldStart}:${index}`}>
              <div className="gt-diff-hunk-header">{hunk.header}</div>
              {hunk.lines.map((diffLine, lineIndex) => (
                <div key={lineIndex} className="gt-diff-line" data-kind={diffLine.kind}>
                  <span className="gt-diff-lineno">{diffLine.oldNo ?? ''}</span>
                  <span className="gt-diff-lineno">{diffLine.newNo ?? ''}</span>
                  <span className="gt-diff-text">
                    {diffLine.kind === 'add' ? '+' : diffLine.kind === 'delete' ? '−' : ' '}
                    {diffLine.text}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="gt-field">
      <dt>{label}</dt>
      <dd className={mono ? 'gt-mono' : undefined}>{value}</dd>
    </div>
  );
}

function basename(value: string): string {
  const index = value.lastIndexOf('/');
  return index === -1 ? value : value.slice(index + 1);
}

function formatDate(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;
  return new Date(timestamp).toLocaleString();
}
