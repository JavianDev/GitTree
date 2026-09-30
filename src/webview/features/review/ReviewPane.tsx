import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMMANDS, type CommandContext, type CommandId } from '@shared/commands';
import type {
  BranchInfo,
  Commit,
  DiffFile,
  FileChangeKind,
  FileDiffStatus,
  FileStats,
  FileStatus,
  MergeOperation,
  RepoId,
  StatusLetter,
  StashEntry,
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
  folderKeys,
  firstRow,
  groupKeys,
  rowPath,
} from './FileTreeView';
import type { FileSortMode, ReviewFile } from './fileTree';
import { MergeStatusBanner } from './MergeStatusBanner';
import { PushPanel, StashPanel } from './WorkPanels';
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

/** In its own Code pane, the diff alone needs far less width to go side by side. */
const WIDE_CODE_PANE = 640;

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
  /** Called whenever the file selection changes. */
  onSelectionChange?: (paths: readonly string[]) => void;
  /** Opens the review-before-run command sheet — powers the merge-status banner's Continue/Abort. */
  onRunCommand?: (id: CommandId, context?: Partial<CommandContext>) => void;
  /** A file row was clicked (or Enter'd) in Changes — the shell widens the diff. */
  onFileActivated?: () => void;
  /** Present while focus-diff mode has folded the other panes away. */
  onRestorePanels?: () => void;
  /**
   * The shell's Code pane. When given, the diff is rendered there and this pane
   * becomes just the file list; `null` means the pane exists but has not
   * mounted yet. Left out, list and diff share this pane as before.
   *
   * A portal rather than two components: the list and the diff share every
   * piece of state here — selection, the active side, the fetched diff — and
   * splitting that across a component boundary would mean lifting all of it.
   */
  codeContainer?: HTMLElement | null;
}

export function ReviewPane({
  repoId,
  mode,
  commitHash,
  revision,
  onError,
  onSelectionChange,
  onRunCommand,
  onFileActivated,
  onRestorePanels,
  codeContainer,
}: ReviewPaneProps): React.JSX.Element {
  const splitOut = codeContainer !== undefined;
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
  const [listWidth, setListWidth] = useState<number | undefined>(undefined);

  const [busy, setBusy] = useState(false);
  /** Changes view only: what the Files pane is showing. */
  const [tab, setTab] = useState<'commit' | 'push' | 'stash'>('commit');
  const [outgoing, setOutgoing] = useState<{ commits: Commit[]; hasUpstream: boolean }>({
    commits: [],
    hasUpstream: true,
  });
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  /** A refused drop. Not an error from git, so it does not go to `onError`. */
  const [notice, setNotice] = useState<string | undefined>();

  // Bumped after a mutation so the pane refetches without waiting for the
  // filesystem watcher to notice what we ourselves just did.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // The Push and Stash tabs' contents — loaded with the rest of the working
  // tree so their counts are right on the tabs before either is opened.
  useEffect(() => {
    if (mode !== 'changes') return;
    let cancelled = false;

    void rpc
      .request('log/outgoing', { repoId })
      .then((result) => {
        if (!cancelled) setOutgoing(result);
      })
      .catch(() => undefined);
    void rpc
      .request('stash/list', { repoId })
      .then((result) => {
        if (!cancelled) setStashes(result.stashes);
      })
      .catch(() => undefined);

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
      title: 'Staged Changes',
      files: keep(withStats(all.filter((file) => file.staged && !file.conflicted), stagedStats)),
    });
    inputs.push({
      id: 'unstaged',
      title: 'Changes',
      files: keep(
        withStats(
          all.filter((file) => file.unstaged && !file.conflicted && file.kind !== 'untracked'),
          unstagedStats,
        ),
      ),
    });
    // New files apart from edits, as in VS Code's own source control view:
    // staging one is adding a file to the repository, not recording a change.
    const untracked = keep(all.filter((file) => file.kind === 'untracked'));
    if (untracked.length > 0) inputs.push({ id: 'untracked', title: 'Untracked Changes', files: untracked });

    return buildGroups(inputs, sort);
  }, [mode, commitFiles, status, stagedStats, unstagedStats, query, sort]);

  const orderedKeys = useMemo(() => groupKeys(groups), [groups]);
  const selection = useFileSelection(orderedKeys);
  const activeRow = useMemo(() => findRow(groups, activeKey), [groups, activeKey]);
  const activePath = activeRow?.file.path;

  const activate = useCallback(
    (row: FileRow) => {
      setActiveKey(row.key);
      // The group that was clicked decides which side opens first; the segmented
      // control then switches between them for a file that is in both.
      setSide(row.group === 'staged' ? 'staged' : 'unstaged');
      onFileActivated?.();
    },
    [onFileActivated],
  );

  useEffect(() => {
    // Lift the selection up to the parent so the toolbar can react to it.
    if (!onSelectionChange) return;
    const paths = [...selection.selected].map(rowPath);
    onSelectionChange(paths);
  }, [selection.selected, onSelectionChange]);

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

    // A conflicted file is worse than empty: `git diff` against an unmerged
    // path produces combined-diff output (`@@@ ... @@@` headers, multi-char
    // line prefixes), which the ordinary unified-diff parser was never built
    // to read — asking anyway renders something garbled rather than nothing.
    // Resolution happens via the context menu or the native editor, not here.
    if (activeRow.file.kind === 'conflicted') {
      setDiff([]);
      setDiffError(undefined);
      setLoadingDiff(false);
      return;
    }

    // Git has nothing to diff an untracked file against, so the host reads
    // it and shows the whole content as added lines.
    const target: DiffTarget =
      activeRow.file.kind === 'untracked'
        ? { kind: 'untracked', repoId, path: activePath }
        : side === 'staged'
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

  const discard = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('discard/files', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  const remove = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('files/remove', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  const stopTracking = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('files/stopTracking', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  const ignore = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('files/ignore', { repoId, paths: [...paths] }));
    },
    [mutate, repoId],
  );

  const reveal = useCallback(
    (path: string) => {
      void rpc.request('files/reveal', { repoId, path });
    },
    [repoId],
  );

  /** Every change to tracked files, back to the last commit. Untracked files are left alone. */
  const discardAll = useCallback(() => {
    const paths = (status?.files ?? [])
      .filter((file) => file.unstaged && !file.conflicted && file.kind !== 'untracked')
      .map((file) => file.path);
    if (paths.length === 0) return;
    const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`;
    if (!window.confirm(`Discard all changes to ${what}? This cannot be undone. Untracked files are kept.`)) return;
    discard(paths);
  }, [status, discard]);

  const resolveOurs = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('conflicts/resolve', { repoId, paths: [...paths], resolution: 'ours' }));
    },
    [mutate, repoId],
  );

  const resolveTheirs = useCallback(
    (paths: readonly string[]) => {
      void mutate(() => rpc.request('conflicts/resolve', { repoId, paths: [...paths], resolution: 'theirs' }));
    },
    [mutate, repoId],
  );

  /** Not a mutation — opens a normal editor tab, where VS Code's own built-in
   * conflict-marker CodeLens takes over. No reload needed. */
  const openEditor = useCallback(
    (path: string) => {
      void rpc.request('editor/open', { repoId, path });
    },
    [repoId],
  );

  /* -- Responsive & Draggable ------------------------------------------- */

  useEffect(() => {
    // Side by side is a property of the space the *diff* has: this pane when it
    // holds both halves, the Code pane when the diff lives there.
    const node = splitOut ? codeContainer : containerRef.current;
    if (!node) return;
    const threshold = splitOut ? WIDE_CODE_PANE : WIDE_LAYOUT;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;

      // Only ever publish a *changed* value. A ResizeObserver callback that
      // sets state on every frame re-enters layout, and the browser reports it
      // as "ResizeObserver loop completed with undelivered notifications".
      const next = width >= threshold;
      setWide((current) => (current === next ? current : next));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [splitOut, codeContainer]);

  /* -- Divider dragging -------------------------------------------------- */

  useEffect(() => {
    const handle = listRef.current?.querySelector('.gt-review-list-handle') as HTMLElement | null;
    if (!handle) return;

    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (event: Event) => {
      const e = event as MouseEvent;
      startX = e.clientX;
      startWidth = listRef.current?.offsetWidth ?? 0;
      document.addEventListener('mousemove', onMouseMove as EventListener);
      document.addEventListener('mouseup', onMouseUp as EventListener);
      handle.style.background = 'var(--gt-accent)';
    };

    const onMouseMove = (event: Event) => {
      const e = event as MouseEvent;
      if (!listRef.current || !containerRef.current) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(startWidth + delta, containerRef.current.offsetWidth - 260));
      listRef.current.style.flex = `0 0 ${newWidth}px`;
      setListWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove as EventListener);
      document.removeEventListener('mouseup', onMouseUp as EventListener);
      handle.style.background = '';
      // Persist width
      if (listWidth) {
        try {
          localStorage.setItem('gitTree.reviewListWidth', String(listWidth));
        } catch {
          // Silently ignore storage errors
        }
      }
    };

    handle.addEventListener('mousedown', onMouseDown as EventListener);
    return () => {
      handle.removeEventListener('mousedown', onMouseDown as EventListener);
    };
  }, [listWidth]);

  /* -- Load persisted width ---------------------------------------------- */

  useEffect(() => {
    if (listWidth !== undefined) return;
    try {
      const stored = localStorage.getItem('gitTree.reviewListWidth');
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          setListWidth(parsed);
        }
      }
    } catch {
      // Silently ignore storage errors
    }
  }, [listWidth]);

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

  const { mineLabel, theirsLabel } = useMemo(
    () => mineTheirsLabels(status?.mergeOperation, status?.branch.head),
    [status?.mergeOperation, status?.branch.head],
  );

  const diffView = (
    <div className="gt-review-diff">
      <DiffViewer
        files={shown}
        layout={wide ? diffLayout : 'unified'}
        // Side by side in a narrow pane is two columns of forty characters,
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
  );

  const changedCount = (status?.files ?? []).filter((file) => file.kind !== 'ignored').length;
  const discardable = (status?.files ?? []).some(
    (file) => file.unstaged && !file.conflicted && file.kind !== 'untracked',
  );
  const showing = mode === 'changes' ? tab : 'commit';

  return (
    <div
      className="gt-review"
      ref={containerRef}
      data-layout={splitOut ? 'files' : wide ? 'split' : 'stacked'}
    >
      {mode === 'changes' && (
        <nav className="gt-review-tabs" role="tablist" aria-label="Working tree">
          {(
            [
              ['commit', 'Commit', changedCount],
              ['push', 'Push', outgoing.commits.length],
              ['stash', 'Stash', stashes.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="gt-review-tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
              <span className="gt-review-tab-count">({count})</span>
            </button>
          ))}
          <span className="gt-review-spacer" />
          {onRestorePanels && (
            <button
              type="button"
              className="gt-button"
              data-size="small"
              title="Bring back the Branches and Git Tree panels"
              onClick={onRestorePanels}
            >
              ⇤ Restore panels
            </button>
          )}
        </nav>
      )}

      {showing === 'push' && (
        <PushPanel
          commits={outgoing.commits}
          hasUpstream={outgoing.hasUpstream}
          {...(status?.branch ? { branch: status.branch } : {})}
          onPush={() => onRunCommand?.('push')}
          onPull={() => onRunCommand?.('pull')}
        />
      )}

      {showing === 'stash' && (
        <StashPanel
          stashes={stashes}
          canStash={changedCount > 0}
          onStash={() => onRunCommand?.('stash.push')}
          onApply={(ref) => onRunCommand?.('stash.apply', { stashRef: ref })}
          onPop={(ref) => onRunCommand?.('stash.pop', { stashRef: ref })}
          onDrop={(ref) => onRunCommand?.('stash.drop', { stashRef: ref })}
        />
      )}

      {showing === 'commit' && (
        <>
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
              {mode === 'changes' && (
                <div className="gt-review-toolbar" role="toolbar" aria-label="Changes">
                  <button
                    type="button"
                    className="gt-icon-button"
                    title="Discard all changes to tracked files"
                    aria-label="Discard all changes to tracked files"
                    disabled={busy || !discardable}
                    onClick={discardAll}
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className="gt-icon-button"
                    title="Expand all folders"
                    aria-label="Expand all folders"
                    onClick={() => setCollapsed(new Set())}
                  >
                    ⊞
                  </button>
                  <button
                    type="button"
                    className="gt-icon-button"
                    title="Collapse all folders"
                    aria-label="Collapse all folders"
                    onClick={() => setCollapsed(new Set(folderKeys(groups)))}
                  >
                    ⊟
                  </button>
                  <button type="button" className="gt-icon-button" title="Refresh" aria-label="Refresh" onClick={reload}>
                    ⟳
                  </button>
                </div>
              )}
              {mode === 'history' && onRestorePanels && (
                <button
                  type="button"
                  className="gt-button"
                  data-size="small"
                  title="Bring back the Branches and Git Tree panels"
                  onClick={onRestorePanels}
                >
                  ⇤ Restore panels
                </button>
              )}
              {mode === 'history' && (
                <span className="gt-review-progress">
                  {viewedCount} of {total} viewed
                </span>
              )}
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

          {mode === 'changes' && status?.mergeOperation && onRunCommand && (
            <MergeStatusBanner
              operation={status.mergeOperation}
              conflictedCount={(status.files ?? []).filter((file) => file.conflicted).length}
              {...(mineLabel ? { mineLabel } : {})}
              {...(theirsLabel ? { theirsLabel } : {})}
              onRunCommand={onRunCommand}
            />
          )}

          <div className="gt-review-body">
            <div
              className="gt-review-list"
              ref={listRef}
              style={!splitOut && listWidth ? { flex: `0 0 ${listWidth}px` } : undefined}
            >
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
                onDiscard={discard}
                onRemove={remove}
                onStopTracking={stopTracking}
                onIgnore={ignore}
                onReveal={reveal}
                onResolveOurs={resolveOurs}
                onResolveTheirs={resolveTheirs}
                onOpenEditor={openEditor}
                {...(mineLabel ? { mineLabel } : {})}
                {...(theirsLabel ? { theirsLabel } : {})}
                busy={busy}
              />
              {!splitOut && <div className="gt-review-list-handle" title="Drag to resize" />}
            </div>

            {!splitOut && diffView}
          </div>

          {mode === 'changes' && (
            <CommitBox
              repoId={repoId}
              head={status?.branch.oid}
              {...(status?.branch ? { branch: status.branch } : {})}
              stagedCount={stagedCount}
              busy={busy}
              onBusy={setBusy}
              onCommitted={reload}
              onError={onError}
              {...(status?.mergeOperation?.kind === 'merge'
                ? { mergeMessage: status.mergeOperation.mergeMessage }
                : {})}
            />
          )}
        </>
      )}

      {codeContainer && createPortal(diffView, codeContainer)}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Commit box                                                               */
/* ------------------------------------------------------------------------ */

function CommitBox({
  repoId,
  head,
  branch,
  stagedCount,
  busy,
  onBusy,
  onCommitted,
  onError,
  mergeMessage,
}: {
  repoId: RepoId;
  /** HEAD's oid, for loading the message an amend would otherwise replace. */
  head?: string;
  /** The checked-out branch, for Commit & Push. */
  branch?: BranchInfo;
  stagedCount: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onCommitted: () => void;
  onError: (error: string | undefined) => void;
  /** `MERGE_MSG`'s content, while a merge is in progress and unresolved. */
  mergeMessage?: string;
}): React.JSX.Element {
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [runHooks, setRunHooks] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | undefined>();

  const fill = (text: string): void => {
    const [first = '', ...rest] = text.trim().split(/\r?\n/);
    setSummary(first.trim());
    setDescription(rest.join('\n').trim());
  };

  // Completing a merge has no `--continue` of its own — it is just an
  // ordinary commit, so it gets the message plain `git commit` would use.
  // Guarded on an empty box, matching `toggleAmend` below, so this only ever
  // fills a message in for you once and never overwrites what you typed.
  useEffect(() => {
    if (mergeMessage && summary.trim().length === 0 && description.trim().length === 0) fill(mergeMessage);
    // Deliberately omits the fields: this should run once when a merge message
    // first appears, not on every keystroke that would otherwise re-trigger it.
  }, [mergeMessage]);

  const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
  const canCommit = summary.trim().length > 0 && (stagedCount > 0 || amend) && !busy;
  const canPush = canCommit && branch?.head !== undefined && !branch.detached;

  const commit = (thenPush: boolean): void => {
    onBusy(true);
    setError(undefined);

    void rpc
      .request('commit/create', { repoId, message, amend, signoff, ...(runHooks ? {} : { noVerify: true }) })
      .then(async () => {
        setSummary('');
        setDescription('');
        setAmend(false);
        setDraftNote(undefined);
        onError(undefined);

        if (thenPush && branch?.head) {
          // The same argv the toolbar's Push previews, so what runs here is
          // exactly what that sheet would have shown.
          const argv = COMMANDS.push.build({ remote: 'origin', branch: branch.head, setUpstream: !branch.upstream });
          const result = await rpc.request('commands/run', { repoId, argv });
          if (result.exitCode !== 0) {
            setError(`Committed, but the push failed:\n${(result.stderr || result.stdout).trim()}`);
          }
        }
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

  const draft = (): void => {
    setDrafting(true);
    setDraftNote(undefined);
    void rpc
      .request('commit/suggest', { repoId })
      .then((suggestion) => {
        if (suggestion.summary) {
          setSummary(suggestion.summary);
          setDescription(suggestion.description);
        }
        setDraftNote(
          suggestion.source === 'model'
            ? `Drafted by ${suggestion.model ?? 'AI'} — review before committing.`
            : suggestion.note ?? 'Drafted from the changed files.',
        );
      })
      .catch((cause: unknown) => setDraftNote(describeError(cause)))
      .finally(() => setDrafting(false));
  };

  const toggleAmend = (next: boolean): void => {
    setAmend(next);
    if (!next || head === undefined || summary.trim().length > 0 || description.trim().length > 0) return;

    // Amending replaces the message as well as the tree. Without loading the
    // previous one, ticking the box to add a forgotten file and committing
    // silently rewrites the subject to whatever happens to be in the box.
    void rpc
      .request('commit/get', { repoId, hash: head })
      .then((entry) => {
        setSummary(entry.subject);
        setDescription(entry.body);
      })
      .catch(() => undefined);
  };

  const shortcut = (event: React.KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (event.shiftKey ? !canPush : !canCommit) return;
    event.preventDefault();
    commit(event.shiftKey);
  };

  return (
    <div className="gt-commit-box">
      {error && (
        <div className="gt-error" role="alert">
          <strong>{error.startsWith('Committed,') ? 'The push was refused' : 'The commit was refused'}</strong>
          <pre>{error}</pre>
        </div>
      )}

      <div className="gt-commit-tools">
        <button
          type="button"
          className="gt-icon-button gt-commit-draft"
          title="Draft a commit message with AI (uses the AI model you have in VS Code, such as GitHub Copilot)"
          aria-label="Draft a commit message with AI"
          disabled={drafting || busy}
          onClick={draft}
        >
          {drafting ? '…' : '✨'}
        </button>
        <span className="gt-commit-note" role="status" title={draftNote}>
          {drafting ? 'Drafting a message…' : draftNote}
        </span>
        <span className="gt-review-spacer" />
        <span className="gt-source-meta">{stagedCount} staged</span>
      </div>

      <input
        type="text"
        className="gt-commit-summary"
        placeholder={amend ? 'Summary of the amended commit' : 'Summary'}
        title="The commit's first line, e.g. fix: resolve login issue"
        aria-label="Commit summary"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={shortcut}
      />
      <textarea
        className="gt-commit-description"
        placeholder="Detailed description…"
        aria-label="Commit description"
        rows={3}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={shortcut}
      />

      <div className="gt-commit-options">
        <label className="gt-checkbox">
          <input type="checkbox" checked={amend} onChange={(event) => toggleAmend(event.target.checked)} />
          Amend
        </label>
        <label className="gt-checkbox">
          <input type="checkbox" checked={signoff} onChange={(event) => setSignoff(event.target.checked)} />
          Sign off
        </label>
        <label className="gt-checkbox" title="Unticked, the commit skips pre-commit and commit-msg hooks (--no-verify)">
          <input type="checkbox" checked={runHooks} onChange={(event) => setRunHooks(event.target.checked)} />
          Run git hooks
        </label>
      </div>

      <div className="gt-commit-actions">
        <button
          type="button"
          className="gt-button"
          disabled={!canPush}
          title="Commit, then push to origin (Ctrl+Shift+Enter)"
          onClick={() => commit(true)}
        >
          {amend ? 'Amend & Push' : 'Commit & Push'}
        </button>
        <button
          type="button"
          className="gt-button"
          data-variant="primary"
          disabled={!canCommit}
          title="Commit (Ctrl+Enter)"
          onClick={() => commit(false)}
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

/**
 * Names "mine"/"theirs" correctly for whatever operation is in progress.
 *
 * A rebase reverses what these words mean: git replays your commits on top
 * of the target, so mid-conflict the target becomes "ours" and your own
 * commit becomes "theirs" — backwards from every other operation, where
 * "mine" is simply the current branch. Getting this wrong here would be
 * worse than not labeling the buttons at all, so the mapping lives in one
 * place rather than being re-derived wherever it's needed.
 */
function mineTheirsLabels(
  operation: MergeOperation | undefined,
  currentBranch: string | undefined,
): { mineLabel?: string; theirsLabel?: string } {
  if (!operation) return {};

  if (operation.kind === 'rebase') {
    return {
      ...(operation.ontoRef ? { mineLabel: operation.ontoRef } : {}),
      ...(operation.incomingRef ? { theirsLabel: operation.incomingRef } : {}),
    };
  }

  return {
    ...(currentBranch ? { mineLabel: currentBranch } : {}),
    ...(operation.incomingRef ? { theirsLabel: operation.incomingRef } : {}),
  };
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
  if (row.file.kind === 'untracked') return 'This new file is empty, or is a folder.';
  if (row.file.kind === 'conflicted') {
    return 'This file has unresolved conflicts. Right-click it to Resolve Using Mine/Theirs, or Open to Resolve Manually.';
  }
  return 'No textual changes on this side.';
}

function describeError(error: unknown): string {
  return error instanceof RpcRequestError ? error.displayText : String(error);
}
