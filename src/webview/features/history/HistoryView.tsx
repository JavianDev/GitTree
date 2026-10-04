import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Commit, GraphRow, RefDecoration, RepoId } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';
import { GraphCanvas } from './GraphCanvas';
import { laneCenter, laneWidthFor, rowIndent } from './graphGeometry';
import { LogStream } from './logStream';

const ROW_HEIGHT = 24;
/**
 * Space between the list's left edge and the first lane, so the leftmost rail
 * never touches the selected row's accent bar.
 */
export const GRAPH_INSET = 5;
/** Rows rendered beyond the viewport, so fast scrolling does not show gaps. */
const OVERSCAN = 12;

/**
 * Commits requested per walk.
 *
 * Measured on a 20k-commit repository: an unbounded `--all` walk costs ~2.5s
 * before git has emitted anything useful, while a capped one returns in ~500ms.
 * Since the view shows roughly thirty rows at a time, the rest is speculative —
 * so the cap buys the first screen an order of magnitude of latency, and deeper
 * history loads on demand.
 */
const PAGE_LIMIT = 2000;

/**
 * How wide the graph may grow within a pane of `paneWidth`.
 *
 * A fixed ceiling let a busy graph take most of a narrow Git Tree pane and
 * leave the commit subjects a few pixels to show in. The graph gets at most
 * 40% of the pane — lanes compress to fit — and the list keeps the rest.
 */
export function gutterBudget(paneWidth: number): number {
  if (!(paneWidth > 0)) return 240;
  return Math.max(48, Math.min(240, Math.round(paneWidth * 0.4)));
}

const EMPTY_DATA: { commits: readonly Commit[]; rows: readonly GraphRow[] } = {
  commits: [],
  rows: [],
};

export interface HistoryViewProps {
  repoIds: RepoId[];
  revision: number;
  selectedHash?: string;
  onSelect: (commit: Commit | undefined) => void;
  onError: (error: string | undefined) => void;
  /** Term and scope from the context bar; re-runs the walk rather than filtering locally. */
  search?: { query: string; field: 'message' | 'author' | 'sha' };
  /** Commit-tree controls from the context bar. */
  options?: { scope: 'all' | 'current'; order: 'date' | 'topo' };
  /** Uncommitted changes in the active repo; drives the pinned pseudo-row. */
  pendingCount?: number;
  /** True when the pseudo-row rather than a commit is selected. */
  uncommittedSelected?: boolean;
  onSelectUncommitted?: () => void;
  /**
   * A commit to scroll to and select, once. Backs "click a branch, go to its
   * tip": the sidebar hands over the ref's oid and the graph goes there.
   */
  focusHash?: string;
  /** Double-click: check the commit's branch out. */
  onCommitActivate?: (commit: Commit, at: PointerSpot) => void;
  /** Right-click (or the context-menu key): the commit's details and actions. */
  onCommitMenu?: (commit: Commit, at: PointerSpot) => void;
  /** A click on the commit's node in the graph: its details alone. */
  onCommitDetails?: (commit: Commit, at: PointerSpot) => void;
}

/** Where, in the window, a popover for a row should open. */
export interface PointerSpot {
  x: number;
  y: number;
}

/** How long typing settles before the walk re-runs. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The commit graph.
 *
 * Rows are windowed rather than all mounted: at a fixed 28px height the visible
 * slice can be computed from `scrollTop` with no measurement pass, which is
 * what keeps scrolling smooth on a history of any size.
 */
export function HistoryView({
  repoIds,
  revision,
  selectedHash,
  onSelect,
  onError,
  search,
  options,
  pendingCount = 0,
  uncommittedSelected = false,
  onSelectUncommitted,
  focusHash,
  onCommitActivate,
  onCommitMenu,
  onCommitDetails,
}: Readonly<HistoryViewProps>): React.JSX.Element {
  /**
   * Commits and rows are published together behind a fresh wrapper object.
   *
   * The accumulator appends to arrays it owns and hands them over by reference,
   * so a batch costs nothing regardless of how much history has loaded. Copying
   * them per batch — the obvious alternative — is O(total) on every batch, which
   * on a large history is quadratic work for no benefit. The wrapper gives React
   * the new identity it needs to re-render.
   */
  const [data, setData] = useState<{ commits: readonly Commit[]; rows: readonly GraphRow[] }>(EMPTY_DATA);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  /** Width of the graph and list together; bounds how wide the graph may grow. */
  const [paneWidth, setPaneWidth] = useState(0);
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * The list element as state, so measuring re-attaches whenever it mounts.
   *
   * The first render is always the empty "Reading history…" state — the list
   * does not exist yet — so a measure-once-on-mount effect found nothing and
   * never ran again. The viewport then stayed at its 600px default for good,
   * and on any pane taller than that the graph stopped painting 600px down
   * and the rows below were never rendered: the history "cut off" part-way.
   */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setListElement(node);
  }, []);
  const commits = data.commits;
  const rows = data.rows;

  const query = search?.query.trim() ?? '';
  const field = search?.field ?? 'message';
  const scope = options?.scope ?? 'all';
  const order = options?.order ?? 'date';

  // Load history whenever the repository, its on-disk state, or the tree
  // controls change.
  useEffect(() => {
    if (repoIds.length === 0) {
      setData(EMPTY_DATA);
      return;
    }

    let cancelled = false;
    let stream: LogStream | undefined;

    setLoading(true);
    setData(EMPTY_DATA);

    const off = rpc.on('log/batch', (batch) => {
      if (cancelled || !stream?.accept(batch)) return;

      // Rows arrive already laid out, so the graph renders from the first batch
      // instead of only after the whole walk finishes.
      setData({ commits: stream.commits, rows: stream.rows });

      if (batch.done) setLoading(false);
    });

    /**
     * Searching re-walks rather than filtering what is loaded.
     *
     * The view holds at most a page of commits, so a local filter would search
     * that page while appearing to search the repository — finding nothing in a
     * history whose match sits ten thousand commits back, with no way to tell
     * that from a genuine absence.
     */
    const start = () => {
      // The id is minted before anything is sent. The host begins streaming the
      // moment it receives the request, so batches routinely arrive before the
      // response would have — on a small repository, all of them do.
      stream = new LogStream();

      void rpc
        .request('log/start', {
          streamId: stream.streamId,
          repoIds,
          limit: PAGE_LIMIT,
          ...(scope === 'current' ? { refs: ['HEAD'] } : {}),
          ...(query ? { search: query, searchField: field } : {}),
        })
        .catch((error) => {
          if (cancelled) return;
          setLoading(false);
          onError(error instanceof RpcRequestError ? error.displayText : String(error));
        });
    };

    // Typing settles before the walk runs; without it every keystroke starts and
    // abandons a full history walk.
    const timer = query ? window.setTimeout(start, SEARCH_DEBOUNCE_MS) : undefined;
    if (!query) start();

    return () => {
      cancelled = true;
      off();
      if (timer !== undefined) window.clearTimeout(timer);

      // `stream` is scoped to this effect run, so StrictMode's double invoke
      // cancels the stream it actually started rather than a later one. It is
      // undefined when the debounce was still pending, in which case nothing
      // was ever started.
      if (stream) {
        void rpc.request('log/cancel', { streamId: stream.streamId }).catch(() => undefined);
      }
    };
  }, [repoIds, revision, onError, query, field, scope, order]);

  // Track the viewport so the window size follows a resized panel.
  useLayoutEffect(() => {
    const element = listElement;
    if (!element) return;
    const pane = element.parentElement;

    // Only publish a genuinely new value. Calling setState on every
    // observation feeds a resize back into the same frame the observer is
    // delivering, which the browser reports as "ResizeObserver loop completed
    // with undelivered notifications" — a console error with no visible symptom.
    const measure = () => {
      const height = element.clientHeight;
      const width = pane?.clientWidth ?? 0;
      setViewport((current) => (current === height ? current : height));
      setPaneWidth((current) => (current === width ? current : width));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (pane) observer.observe(pane);
    measure();

    return () => observer.disconnect();
  }, [listElement]);

  /**
   * Rendered synchronously. The list scrolls natively, before any script runs,
   * but a scroll-driven state update is otherwise scheduled for a later task —
   * after the browser has painted the moved rows next to a graph still drawn
   * for the old position. Flushing here lets the canvas's layout effect repaint
   * in the same frame, so the rails never trail their commits mid-scroll.
   */
  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // The height is re-read here too, as a safety net under the observer: if a
    // resize notification is ever missed, the first scroll puts it right.
    const height = element.clientHeight;
    flushSync(() => {
      setScrollTop(element.scrollTop);
      setViewport((current) => (current === height ? current : height));
    });
  }, []);

  /**
   * The tip commit, selected for you when nothing else is.
   *
   * Only when the selection is genuinely absent — never on every refresh, which
   * would yank the reader off the commit they were on each time the watcher
   * ticked. A selection that is merely *not loaded yet* is left alone until the
   * walk finishes, because mid-stream a commit ten thousand rows down has not
   * arrived and is indistinguishable from one that is gone.
   */
  useEffect(() => {
    if (uncommittedSelected || commits.length === 0) return;
    if (selectedHash && (loading || commits.some((entry) => entry.hash === selectedHash))) return;

    const tip = commits[0];
    if (tip) onSelect(tip);
  }, [commits, selectedHash, uncommittedSelected, loading, onSelect]);

  /**
   * Jump to a commit the sidebar asked for.
   *
   * Declared after the auto-select above so that on the render where both would
   * fire, this one lands last and wins. The applied hash is remembered so a
   * later batch does not drag the view back to a branch tip the user has since
   * scrolled away from; it is forgotten when the walk restarts and the list
   * empties, so the same branch can be revisited after a repository change.
   */
  const appliedFocus = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (commits.length === 0) {
      appliedFocus.current = undefined;
      return;
    }

    if (!focusHash || focusHash === appliedFocus.current) return;

    const index = commits.findIndex((entry) => entry.hash === focusHash);
    // Not loaded yet: a later batch re-runs this effect with the same hash.
    if (index < 0) return;

    appliedFocus.current = focusHash;

    const element = scrollRef.current;
    if (element) element.scrollTop = Math.max(0, index * ROW_HEIGHT - viewport / 2);

    const target = commits[index];
    if (target) onSelect(target);
  }, [focusHash, commits, viewport, onSelect]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(commits.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const visible = commits.slice(start, end);

  // Only the visible window is searched: the selection is nearly always on
  // screen, and scanning the whole history on every scroll would undo the point
  // of virtualising the list.
  const selectedIndex = useMemo(() => {
    if (!selectedHash) return -1;
    for (let i = start; i < end && i < commits.length; i++) {
      if (commits[i]?.hash === selectedHash) return i;
    }
    return -1;
  }, [selectedHash, commits, start, end]);

  // Keyed on the row count as well as the array: the stream appends to the
  // same array in place, so keyed on identity alone this was computed from the
  // first batch only — lanes that appear further down history then drew past
  // the canvas edge, which read as the graph cutting off while scrolling.
  // Deliberately uncapped; `GraphCanvas` compresses lanes to fit instead.
  const gutterWidth = useMemo(() => {
    let max = 1;
    for (const row of rows) max = Math.max(max, row.width);
    return max;
  }, [rows, rows.length]);

  /**
   * The working tree, pinned above history as a row of its own.
   *
   * Uncommitted work is where the next commit comes from, so it belongs at the
   * head of the same list rather than behind a mode switch — and selecting it is
   * what puts the review pane into Changes, which is how the tree and the mode
   * stay in agreement.
   */
  const uncommittedRow = onSelectUncommitted ? (
    <div
      className="gt-commit-row gt-uncommitted-row"
      role="option"
      tabIndex={0}
      aria-selected={uncommittedSelected}
      style={{ height: ROW_HEIGHT }}
      onClick={onSelectUncommitted}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectUncommitted();
        }
      }}
    >
      <span className="gt-uncommitted-node" aria-hidden="true" />
      <span className="gt-commit-subject">
        {pendingCount > 0 ? 'Uncommitted changes' : 'Working tree clean'}
      </span>
      {pendingCount > 0 && <span className="gt-uncommitted-count">{pendingCount}</span>}
    </div>
  ) : null;

  if (commits.length === 0) {
    return (
      <div className="gt-history-empty">
        {uncommittedRow}
        <div className="gt-empty">
          <p className="gt-empty-title">
            {loading ? 'Reading history…' : query ? 'No matching commits' : 'No commits yet'}
          </p>
          {!loading && (
            <p className="gt-empty-detail">
              {query
                ? `Nothing in this repository matches “${query}”.`
                : 'This repository has no commits to show.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  const graphBudget = gutterBudget(paneWidth);
  const laneWidth = laneWidthFor(gutterWidth, graphBudget);

  return (
    /*
     * The pinned row sits above the scroll area, not inside it. Inside, it would
     * scroll away from the graph gutter it is supposed to head, and every rail
     * would be one row out of register with its commit.
     */
    <div className="gt-history-pane">
      {loading && <div className="gt-history-progress" role="progressbar" aria-label="Loading history" />}
      {uncommittedRow}

      {/*
        The graph is a transparent layer over the list rather than a column
        beside it, and each row indents its text by exactly its own rails —
        so a commit's message sits right next to its node, with no empty
        graph column in between on the rows that need only one lane.
      */}
      <div className="gt-history">
        <div
          className="gt-commit-list"
          ref={attachList}
          onScroll={onScroll}
          role="listbox"
          aria-label="Commits"
        >
          <div style={{ height: commits.length * ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {visible.map((commit, offset) => {
                const row = rows[start + offset];
                return (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    indent={rowIndent(row, laneWidth) + GRAPH_INSET}
                    rail={row?.color ?? 0}
                    selected={commit.hash === selectedHash}
                    nodeX={GRAPH_INSET + laneCenter(row?.lane ?? 0, laneWidth)}
                    nodeReach={Math.max(7, Math.min(laneWidth / 2, 9))}
                    onSelect={onSelect}
                    {...(onCommitActivate ? { onActivate: onCommitActivate } : {})}
                    {...(onCommitMenu ? { onMenu: onCommitMenu } : {})}
                    {...(onCommitDetails ? { onDetails: onCommitDetails } : {})}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="gt-graph-overlay" aria-hidden="true">
          <GraphCanvas
            rows={rows}
            start={start}
            end={end}
            scrollTop={scrollTop}
            rowHeight={ROW_HEIGHT}
            height={viewport}
            width={gutterWidth}
            rowCount={rows.length}
            maxWidth={graphBudget}
            {...(selectedIndex >= 0 ? { selectedRow: selectedIndex } : {})}
          />
        </div>
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  indent,
  rail,
  selected,
  nodeX,
  nodeReach,
  onSelect,
  onActivate,
  onMenu,
  onDetails,
}: {
  commit: Commit;
  /** Where the text starts: just past this row's own rails. */
  indent: number;
  /** Palette index of this commit's rail; tints its branch pills and merge badge. */
  rail: number;
  selected: boolean;
  /** The centre of this commit's node, from the row's left edge. */
  nodeX: number;
  /** How far either side of the centre a click still counts as on the node. */
  nodeReach: number;
  onSelect: (commit: Commit) => void;
  onActivate?: (commit: Commit, at: PointerSpot) => void;
  onMenu?: (commit: Commit, at: PointerSpot) => void;
  onDetails?: (commit: Commit, at: PointerSpot) => void;
}): React.JSX.Element {
  const isMerge = commit.parents.length > 1;

  /*
   * The graph is painted on a canvas laid over the list with pointer events
   * off, so a click on a node lands on its row. Measuring from the row's left
   * edge — the canvas's left edge too — tells a click on the node apart from a
   * click on the text.
   */
  const onNode = (event: React.MouseEvent<HTMLDivElement>) =>
    Math.abs(event.clientX - event.currentTarget.getBoundingClientRect().left - nodeX) <= nodeReach;

  return (
    <div
      className="gt-commit-row"
      role="option"
      tabIndex={0}
      aria-selected={selected}
      style={
        {
          height: ROW_HEIGHT,
          paddingLeft: indent,
          '--row-rail': `var(--gt-lane-${rail % 12})`,
        } as React.CSSProperties
      }
      onClick={(event) => {
        onSelect(commit);
        if (onDetails && onNode(event)) {
          const box = event.currentTarget.getBoundingClientRect();
          onDetails(commit, { x: box.left + nodeX + nodeReach + 4, y: box.bottom + 2 });
        }
      }}
      onDoubleClick={(event) => onActivate?.(commit, { x: event.clientX, y: event.clientY })}
      onContextMenu={(event) => {
        // Always, so the webview's own Cut / Copy / Paste menu never appears
        // over a commit — there is nothing on a row to cut or paste.
        event.preventDefault();
        onSelect(commit);
        onMenu?.(commit, { x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(commit);
        } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onSelect(commit);
          onMenu?.(commit, { x: box.left + indent, y: box.bottom });
        }
      }}
    >
      {commit.refs.map((ref) => (
        <RefPill key={`${ref.kind}:${ref.name}`} decoration={ref} />
      ))}

      {isMerge && (
        <span className="gt-merge-badge" title="Merge commit" aria-label="Merge commit">
          M
        </span>
      )}

      <span className="gt-commit-subject" title={commit.subject} data-fit>
        {commit.subject}
      </span>
      <span className="gt-commit-byline">
        <Avatar identity={commit.author} />
        <span className="gt-commit-author">{commit.author.name}</span>
      </span>
      <span className="gt-commit-date">{relativeDate(commit.commitDate)}</span>
      <span className="gt-commit-hash">{commit.shortHash}</span>
    </div>
  );
}

/**
 * A colour-coded initials chip for the author.
 *
 * No avatar images: fetching them would mean network access from a panel that
 * otherwise makes none, and a CSP that currently forbids remote origins. Initials
 * tinted by a hash of the email give the same thing an avatar is actually used
 * for while scrolling — telling at a glance whether a run of commits came from
 * one person or several — with nothing to load and nothing to leak.
 */
function Avatar({ identity }: { identity: { name: string; email: string } }): React.JSX.Element {
  const hue = hashHue(identity.email || identity.name);

  return (
    <span
      className="gt-avatar"
      style={{
        // Fixed saturation and lightness keep every generated colour within the
        // same tonal band, so the row reads as one design rather than confetti.
        background: `hsl(${hue} 62% 46%)`,
      }}
      title={`${identity.name} <${identity.email}>`}
      aria-hidden="true"
    >
      {initials(identity.name)}
    </span>
  );
}

/** Icon per ref kind, so the pills are distinguishable without reading them. */
const REF_GLYPH: Partial<Record<RefDecoration['kind'], string>> = {
  localBranch: '⑂',
  remoteBranch: '☁',
  tag: '🏷',
  stash: '⛁',
};

export function RefPill({ decoration }: { decoration: RefDecoration }): React.JSX.Element | null {
  if (decoration.kind === 'head') return null;

  // A remote branch shows only its branch name; the remote is in the glyph and
  // the tooltip, and repeating "origin/" on every pill wastes the row.
  const label =
    decoration.kind === 'remoteBranch' && decoration.remote
      ? decoration.name.slice(decoration.remote.length + 1)
      : decoration.name;

  return (
    <span
      className="gt-ref-pill"
      data-kind={decoration.kind}
      data-head={decoration.isHead}
      title={decoration.name}
    >
      <span className="gt-ref-glyph" aria-hidden="true">
        {REF_GLYPH[decoration.kind]}
      </span>
      {/* Its own element so it can ellipsize: a bare text node in a flex
          container only clips. */}
      <span className="gt-ref-label">{label}</span>
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/** Stable hue in [0, 360) from a string. FNV-1a: cheap and well distributed. */
function hashHue(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 360;
}

/** Compact relative date, falling back to the raw value if unparseable. */
function relativeDate(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;

  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo`;
  return `${Math.floor(seconds / 31_536_000)}y`;
}
