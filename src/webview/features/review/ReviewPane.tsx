import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DiffFile,
  FileChangeKind,
  FileDiffStatus,
  FileStats,
  FileStatus,
  RepoId,
  StatusLetter,
  StatusResult,
} from '@shared/model';
import type { DiffTarget } from '@shared/protocol';
import { RpcRequestError, rpc } from '../../rpc/client';
import { type DiffLayout, type DiffSide, DiffViewer } from './DiffViewer';
import {
  type FileGroupInput,
  type FileGroupView,
  type FileRow,
  FileTree,
  buildGroups,
  findRow,
  firstRow,
  groupKeys,
} from './FileTreeView';
import type { FileSortMode, ReviewFile } from './fileTree';
import { useFileSelection } from './useFileSelection';
import './review.css';

/**
 * The review pane — an Azure DevOps-style reading surface for a change.
 *
 * It replaces both halves of what came before: the status list with its commit
 * box, and the inspector that showed one file's diff in a 320px column. The two
 * were separate because the middle pane was modal; with the commit tree
 * permanently beside them, a change is a file list *and* its diff, together.
 *
 * The pane is the same in both modes and only its source differs: Changes reads
 * the working tree, History reads the commit selected in the tree.
 */

/** Below this, file list over diff rather than beside it. */
const WIDE_LAYOUT = 900;

const SORTS: ReadonlyArray<{ value: FileSortMode; label: string }> = [
  { value: 'tree', label: 'Tree' },
  { value: 'path', label: 'Path' },
  { value: 'status', label: 'Status' },
];

export interface ReviewPaneProps {
  repoId: RepoId;
  mode: 'changes' | 'history';
  /** The commit being reviewed in History mode. */
  commitHash?: string;
  /** Bumped by the shell to force a refetch. */
  revision: number;
  onError: (error: string | undefined) => void;
}

export function ReviewPane({
  repoId,
  mode,
  commitHash,
  revision,
  onError,
}: ReviewPaneProps): React.JSX.Element {
  const [status, setStatus] = useState<StatusResult | undefined>();
  const [stagedStats, setStagedStats] = useState<readonly FileStats[]>([]);
  const [unstagedStats, setUnstagedStats] = useState<readonly FileStats[]>([]);
  const [commitFiles, setCommitFiles] = useState<readonly DiffFile[]>([]);
  const [diff, setDiff] = useState<readonly DiffFile[]>([]);
  const [diffError, setDiffError] = useState<string | undefined>();
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FileSortMode>('tree');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [side, setSide] = useState<DiffSide>('unstaged');
  const [diffLayout, setDiffLayout] = useState<DiffLayout>('unified');
  const [wide, setWide] = useState(true);

  const [busy, setBusy] = useState(false);
  /** A refused drop. Not an error from git, so it does not go to `onError`. */
  const [notice, setNotice] = useState<string | undefined>();

  // Bumped after a mutation so the pane refetches without waiting for the
  // filesystem watcher to notice what we ourselves just did.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const containerRef = useRef<HTMLDivElement>(null);

  /* -- Loading ----------------------------------------------------------- */

  useEffect(() => {
    if (mode !== 'changes') return;
    let cancelled = false;

    void rpc
      .request('status/get', { repoId })
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        onError(undefined);
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(describeError(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, mode, revision, nonce, onError]);

  useEffect(() => {
    if (mode !== 'changes') return;
    let cancelled = false;

    // Counts are a second, slower invocation than status — it diffs every
    // changed file — so they land separately and the list paints without them.
    // A failure here is swallowed on purpose: rows lose their weight, which is
    // not worth an error banner over an otherwise working view.
    const load = (staged: boolean): void => {
      void rpc
        .request('stats/get', { repoId, staged })
        .then((result) => {
          if (cancelled) return;
          if (staged) setStagedStats(result.stats);
          else setUnstagedStats(result.stats);
        })
        .catch(() => undefined);
    };

    load(true);
    load(false);

    return () => {
      cancelled = true;
    };
  }, [repoId, mode, revision, nonce]);

  useEffect(() => {
    if (mode !== 'history' || commitHash === undefined) {
      setCommitFiles([]);
      setLoadingDiff(false);
      return;
    }

    let cancelled = false;
    setDiffError(undefined);
    setLoadingDiff(true);

    // One request for the whole commit: it carries every file *and* every
    // patch, so selecting a file in the tree costs no further round trip.
    void rpc
      .request('diff/get', { kind: 'commit', repoId, hash: commitHash })
      .then((files) => {
        if (!cancelled) setCommitFiles(files);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setCommitFiles([]);
        setDiffError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, mode, commitHash, revision]);

  /* -- Grouping ---------------------------------------------------------- */

  const groups = useMemo<FileGroupView[]>(() => {
    const needle = query.trim().toLowerCase();
    const keep = (files: readonly ReviewFile[]): ReviewFile[] =>
      needle === '' ? [...files] : files.filter((file) => file.path.toLowerCase().includes(needle));

    if (mode === 'history') {
      return buildGroups(
        [{ id: 'commit', title: 'Files', files: keep(commitFiles.map(asReviewFile)) }],
        sort,
      );
    }

    const all = status?.files ?? [];
    const conflicted = keep(all.filter((file) => file.conflicted));
    const inputs: FileGroupInput[] = [];

    // Conflicts come first and stay their own group: nothing else can be
    // committed until they are resolved, and they belong to neither side.
    if (conflicted.length > 0) inputs.push({ id: 'conflicted', title: 'Conflicts', files: conflicted });

    inputs.push({
      id: 'staged',
      title: 'Staged',
      files: keep(withStats(all.filter((file) => file.staged && !file.conflicted), stagedStats)),
    });
    inputs.push({
      id: 'unstaged',
      title: 'Unstaged',
      files: keep(withStats(all.filter((file) => file.unstaged && !file.conflicted), unstagedStats)),
    });

    return buildGroups(inputs, sort);
  }, [mode, commitFiles, status, stagedStats, unstagedStats, query, sort]);

  const orderedKeys = useMemo(() => groupKeys(groups), [groups]);
  const selection = useFileSelection(orderedKeys);
  const activeRow = useMemo(() => findRow(groups, activeKey), [groups, activeKey]);
  const activePath = activeRow?.file.path;

  const activate = useCallback((row: FileRow) => {
    setActiveKey(row.key);
    // The group that was clicked decides which side opens first; the segmented
    // control then switches between them for a file that is in both.
    setSide(row.group === 'staged' ? 'staged' : 'unstaged');
  }, []);

  useEffect(() => {
    // Something is always selected, so the diff half is never blank next to a
    // populated list. Also clears a key left pointing at a committed-away file.
    if (activeRow) return;
    const first = firstRow(groups);
    setActiveKey(first?.key);
    if (first) setSide(first.group === 'staged' ? 'staged' : 'unstaged');
  }, [activeRow, groups]);

  /* -- The selected file's diff ------------------------------------------ */

  useEffect(() => {
    if (mode !== 'changes') return;

    if (activePath === undefined || activeRow === undefined) {
      setDiff([]);
      setLoadingDiff(false);
      return;
    }

    // An untracked file is not in the index, so there is nothing for git to
    // diff it against. Asking anyway returns an empty patch and reads as a bug.
    if (activeRow.file.kind === 'untracked') {
      setDiff([]);
      setDiffError(undefined);
      setLoadingDiff(false);
      return;
    }

    const target: DiffTarget =
      side === 'staged'
        ? { kind: 'index', repoId, path: activePath }
        : { kind: 'worktree', repoId, path: activePath };

    let cancelled = false;
    setDiffError(undefined);
    setLoadingDiff(true);

    void rpc
      .request('diff/get', target)
      .then((files) => {
        if (!cancelled) setDiff(files);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDiff([]);
        setDiffError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    return () => {
      cancelled = true;
    };
    // Keyed on the path rather than the row: the row object is rebuilt on every
    // refresh and on every keystroke in the filter, and refetching the same
    // diff each time would make typing flicker.
  }, [mode, repoId, activePath, activeRow?.file.kind, side, revision, nonce]);

  /* -- Mutations --------------------------------------------------------- */

  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        onError(undefined);
        reload();
      } catch (error) {
        onError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [onError, reload],
  );

  const stage = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('stage/files', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  const unstage = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('unstage/files', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  /* -- Responsive -------------------------------------------------------- */

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;

      // Only ever publish a *changed* value. A ResizeObserver callback that
      // sets state on every frame re-enters layout, and the browser reports it
      // as "ResizeObserver loop completed with undelivered notifications".
      const next = width >= WIDE_LAYOUT;
      setWide((current) => (current === next ? current : next));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* -- Derived ----------------------------------------------------------- */

  const total = groups.reduce((count, group) => count + group.files.length, 0);
  const additions = groups.reduce((sum, group) => sum + group.additions, 0);
  const deletions = groups.reduce((sum, group) => sum + group.deletions, 0);
  const viewedCount = orderedKeys.filter((key) => viewed.has(key)).length;

  // Counted from status, never from the filtered groups: a filter narrows what
  // you are reading, not what the next commit would contain.
  const stagedCount = (status?.files ?? []).filter((file) => file.staged && !file.conflicted).length;

  const shown = useMemo<readonly DiffFile[]>(() => {
    if (mode !== 'history') return diff;
    if (activePath === undefined) return commitFiles;
    return commitFiles.filter((file) => file.path === activePath);
  }, [mode, diff, commitFiles, activePath]);

  const bothSides =
    mode === 'changes' &&
    activeRow !== undefined &&
    activeRow.file.staged &&
    activeRow.file.unstaged &&
    !activeRow.file.conflicted;

  return (
    <div className="gt-review" ref={containerRef} data-layout={wide ? 'split' : 'stacked'}>
      <header className="gt-review-header">
        <div className="gt-review-summary">
          <strong>{total === 1 ? '1 file' : `${total} files`}</strong>
          {(additions > 0 || deletions > 0) && (
            <span className="gt-review-counts">
              <span className="gt-review-add">+{additions}</span>
              <span className="gt-review-del">−{deletions}</span>
            </span>
          )}
          <span className="gt-review-spacer" />
          <span className="gt-review-progress">
            {viewedCount} of {total} viewed
          </span>
        </div>

        <div className="gt-review-controls">
          <input
            type="search"
            className="gt-filter-input"
            placeholder="Filter files…"
            aria-label="Filter files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />

          <select
            className="gt-context-select"
            aria-label="Sort files"
            value={sort}
            onChange={(event) => setSort(asSort(event.target.value))}
          >
            {SORTS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {notice && (
        <div className="gt-review-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="gt-button"
            data-size="small"
            onClick={() => setNotice(undefined)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="gt-review-body">
        <div className="gt-review-list">
          <FileTree
            groups={groups}
            selection={selection}
            activeKey={activeKey}
            collapsed={collapsed}
            onToggleFolder={(key) => setCollapsed((current) => toggleKey(current, key))}
            viewed={viewed}
            onToggleViewed={(key) => setViewed((current) => toggleKey(current, key))}
            onActivate={activate}
            onStage={stage}
            onUnstage={unstage}
            onRefuse={setNotice}
            busy={busy}
          />
        </div>

        <div className="gt-review-diff">
          <DiffViewer
            files={shown}
            layout={wide ? diffLayout : 'unified'}
            // Side by side in a stacked pane is two columns of forty characters,
            // so the choice is withdrawn rather than offered and ignored.
            onLayout={wide ? setDiffLayout : undefined}
            sides={bothSides ? (['staged', 'unstaged'] as const) : undefined}
            side={side}
            onSide={setSide}
            loading={loadingDiff}
            error={diffError}
            empty={emptyDiffText(mode, commitHash, activeRow)}
          />
        </div>
      </div>

      {mode === 'changes' && (
        <CommitBox
          repoId={repoId}
          head={status?.branch.oid}
          stagedCount={stagedCount}
          busy={busy}
          onBusy={setBusy}
          onCommitted={reload}
          onError={onError}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Commit box                                                               */
/* ------------------------------------------------------------------------ */

function CommitBox({
  repoId,
  head,
  stagedCount,
  busy,
  onBusy,
  onCommitted,
  onError,
}: {
  repoId: RepoId;
  /** HEAD's oid, for loading the message an amend would otherwise replace. */
  head?: string;
  stagedCount: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onCommitted: () => void;
  onError: (error: string | undefined) => void;
}): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy;

  const commit = (): void => {
    onBusy(true);
    setError(undefined);

    void rpc
      .request('commit/create', { repoId, message, amend, signoff })
      .then(() => {
        setMessage('');
        setAmend(false);
        onError(undefined);
        onCommitted();
      })
      .catch((cause: unknown) => {
        // A rejected commit is almost always a hook, and the hook's stderr is
        // the entire diagnostic. It belongs verbatim beside the message box
        // that provoked it rather than in the shell's banner three panes away.
        setError(describeError(cause));
      })
      .finally(() => onBusy(false));
  };

  const toggleAmend = (next: boolean): void => {
    setAmend(next);
    if (!next || head === undefined || message.trim().length > 0) return;

    // Amending replaces the message as well as the tree. Without loading the
    // previous one, ticking the box to add a forgotten file and committing
    // silently rewrites the subject to whatever happens to be in the box.
    void rpc
      .request('commit/get', { repoId, hash: head })
      .then((entry) => setMessage(entry.body ? `${entry.subject}\n\n${entry.body}` : entry.subject))
      .catch(() => undefined);
  };

  return (
    <div className="gt-commit-box">
      {error && (
        <div className="gt-error" role="alert">
          <strong>The commit was refused</strong>
          <pre>{error}</pre>
        </div>
      )}

      <textarea
        className="gt-commit-input"
        placeholder={amend ? 'Amend the last commit…' : 'Commit message'}
        aria-label="Commit message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
            event.preventDefault();
            commit();
          }
        }}
      />

      <div className="gt-commit-actions">
        <label className="gt-checkbox">
          <input
            type="checkbox"
            checked={amend}
            onChange={(event) => toggleAmend(event.target.checked)}
          />
          Amend
        </label>
        <label className="gt-checkbox">
          <input
            type="checkbox"
            checked={signoff}
            onChange={(event) => setSignoff(event.target.checked)}
          />
          Sign off
        </label>

        <span className="gt-review-spacer" />

        <span className="gt-source-meta">{stagedCount} staged</span>
        <button
          type="button"
          className="gt-button"
          data-variant="primary"
          disabled={!canCommit}
          onClick={commit}
        >
          {amend ? 'Amend Commit' : 'Commit'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Adapters                                                                 */
/* ------------------------------------------------------------------------ */

/** Merges `git diff --numstat` counts onto the status entries by path. */
function withStats(files: readonly FileStatus[], stats: readonly FileStats[]): ReviewFile[] {
  const byPath = new Map(stats.map((entry) => [entry.path, entry]));

  return files.map((file) => {
    const entry = byPath.get(file.path);
    // A binary file reports 0/0 with `binary` set, which the row renders as no
    // counts at all rather than as a change of nothing.
    return entry ? { ...file, additions: entry.added, deletions: entry.deleted } : file;
  });
}

const DIFF_KIND: Record<FileDiffStatus, FileChangeKind> = {
  added: 'added',
  copied: 'copied',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  typechange: 'typechange',
};

const DIFF_LETTER: Record<FileDiffStatus, StatusLetter> = {
  added: 'A',
  copied: 'C',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  typechange: 'T',
};

/**
 * Presents a commit's file as a review row.
 *
 * `staged` and `unstaged` are both false because neither is true of a committed
 * change — it is in history, not in either side of the working tree — and the
 * `commit` group is the one where the state pill is not rendered at all.
 */
function asReviewFile(file: DiffFile): ReviewFile {
  return {
    path: file.path,
    ...(file.oldPath !== file.path ? { origPath: file.oldPath } : {}),
    index: DIFF_LETTER[file.status],
    worktree: '.',
    kind: DIFF_KIND[file.status],
    staged: false,
    unstaged: false,
    conflicted: false,
    additions: file.additions,
    deletions: file.deletions,
  };
}

/** Adds or removes one row key, leaving the previous set untouched. */
function toggleKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (!next.delete(key)) next.add(key);
  return next;
}

function asSort(value: string): FileSortMode {
  const match = SORTS.find((entry) => entry.value === value);
  return match?.value ?? 'tree';
}

/** Says why there is no diff, which is more use than saying that there is none. */
function emptyDiffText(
  mode: 'changes' | 'history',
  commitHash: string | undefined,
  row: FileRow | undefined,
): string {
  if (mode === 'history' && commitHash === undefined) {
    return 'Select a commit in the tree to see what it changed.';
  }
  if (!row) return 'Select a file to read its diff.';
  if (row.file.kind === 'untracked') {
    return 'Untracked — git has nothing to compare this file against until it is staged.';
  }
  return 'No textual changes on this side.';
}

function describeError(error: unknown): string {
  return error instanceof RpcRequestError ? error.displayText : String(error);
}
