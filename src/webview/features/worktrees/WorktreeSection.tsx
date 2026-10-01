import { useMemo, useState } from 'react';
import type { WorktreeEntry, WorktreeOpenTarget, WorktreeSummary } from '@shared/model';
import { basename, changeCount, shortestUniquePaths } from '@shared/worktrees';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';
import { type TreeNode, buildTree } from '../sidebar/BranchTree';
import { highlightSegments, matchText } from '../sidebar/RefFilter';
import { SidebarSection } from '../sidebar/SidebarSection';
import { type WorktreeAction, colorMenu, colorVar, worktreeMenu } from './actions';
import type { WorktreesState } from './useWorktrees';
import './worktrees.css';

export interface WorktreeSectionProps {
  state: WorktreesState;
  summaries: ReadonlyMap<string, WorktreeSummary>;
  /** The sidebar filter's text; worktrees are matched by branch and folder name. */
  query: string;
  selectedPath?: string;
  /** Where a double-click or Enter opens a worktree. */
  defaultOpen: WorktreeOpenTarget;
  colorLabels: boolean;
  /** Local branches whose upstream is gone and that no worktree has checked out. */
  goneBranches: readonly string[];
  collapsed: boolean;
  onToggle: () => void;
  onAction: (action: WorktreeAction) => void;
}

type Menu = { x: number; y: number; items: ContextMenuItem[] };

/**
 * The sidebar's WORKTREES section: every working folder of this repository.
 *
 * The main worktree is pinned first; the rest are grouped by their branch's
 * folder (`feature/…`), exactly as BRANCHES groups branches. A click selects a
 * worktree and shows its details; a double-click opens it; right-click has
 * everything else, with unavailable actions disabled and explained.
 */
export function WorktreeSection({
  state,
  summaries,
  query,
  selectedPath,
  defaultOpen,
  colorLabels,
  goneBranches,
  collapsed,
  onToggle,
  onAction,
}: WorktreeSectionProps): React.JSX.Element | null {
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | undefined>();

  const worktrees = useMemo(() => state.list?.worktrees ?? [], [state.list]);
  const filtering = query.trim().length > 0;
  const windows = worktrees.some((entry) => /^[A-Za-z]:\//.test(entry.path));
  const shortPaths = useMemo(() => shortestUniquePaths(worktrees.map((entry) => entry.path), windows ? 'win32' : 'posix'), [worktrees, windows]);

  const matches = useMemo(() => {
    if (!filtering) return new Map<string, number[]>();
    const map = new Map<string, number[]>();
    for (const entry of worktrees) {
      const name = entry.branch ?? basename(entry.path);
      const byName = matchText(query, name);
      const byFolder = matchText(query, basename(entry.path));
      if (byName) map.set(entry.path, byName.positions);
      else if (byFolder) map.set(entry.path, []);
    }
    return map;
  }, [filtering, query, worktrees]);

  if (filtering && matches.size === 0) return null;

  const main = worktrees.find((entry) => entry.isMain || entry.bare);
  const linked = worktrees.filter((entry) => entry !== main);
  const tree = buildTree(linked, (entry) => entry.branch ?? basename(entry.path));

  const openMenu = (event: React.MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const rowMenu = (event: React.MouseEvent, entry: WorktreeEntry) => {
    const x = event.clientX;
    const y = event.clientY;
    openMenu(
      event,
      worktreeMenu(entry, onAction, {
        canMoveRemove: true,
        ...(colorLabels ? { onColorMenu: () => setMenu({ x, y, items: colorMenu(entry, onAction) }) } : {}),
      }),
    );
  };

  const headerItems: ContextMenuItem[] = [
    { label: 'New Worktree…', shortcut: 'W', run: () => onAction({ kind: 'create' }) },
    { label: 'Refresh', run: () => onAction({ kind: 'refresh' }) },
    { label: '', run: () => undefined, separator: true },
    { label: 'Prune Stale Worktrees…', run: () => onAction({ kind: 'prune' }), hint: 'Forget worktrees whose folders were deleted' },
    { label: 'Repair Worktree Links…', run: () => onAction({ kind: 'repair' }), hint: 'Reconnect worktrees moved by hand' },
    {
      label: 'Clean Up Gone Branches…',
      run: () => onAction({ kind: 'cleanupGone', branches: [...goneBranches] }),
      ...(goneBranches.length === 0
        ? { disabled: 'No local branch tracks a deleted remote branch. Fetch with Prune to refresh this.' }
        : { hint: `${goneBranches.length} branch${goneBranches.length === 1 ? '' : 'es'} whose remote branch is gone` }),
    },
    { label: '', run: () => undefined, separator: true },
    { label: 'Worktree Settings…', run: () => onAction({ kind: 'settings' }) },
  ];

  const row = (entry: WorktreeEntry, depth: number, label: string) => (
    <WorktreeRow
      key={entry.path}
      entry={entry}
      depth={depth}
      label={label}
      positions={matches.get(entry.path)}
      summary={summaries.get(entry.path)}
      shortPath={shortPaths.get(entry.path) ?? entry.path}
      selected={selectedPath === entry.path}
      colorLabels={colorLabels}
      onSelect={() => onAction({ kind: 'select', entry })}
      onOpen={() => onAction({ kind: 'open', entry, target: defaultOpen })}
      onContextMenu={(event) => rowMenu(event, entry)}
    />
  );

  const renderTree = (nodes: Array<TreeNode<WorktreeEntry>>, depth: number): React.ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'leaf') return row(node.item, depth, node.name);
      const key = `wt:${node.path}`;
      const isCollapsed = folders.has(key);
      return (
        <div key={key} role="none">
          <button
            type="button"
            className="gt-source-row gt-folder-row"
            style={{ paddingLeft: `calc(var(--gt-space-3) + ${depth * 12}px)` }}
            aria-expanded={!isCollapsed}
            onClick={() =>
              setFolders((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          >
            <span className="gt-disclosure" aria-hidden="true">
              {isCollapsed ? '▸' : '▾'}
            </span>
            <span className="gt-source-name" data-fit>
              {node.name}
            </span>
            <span className="gt-source-meta">{node.count}</span>
          </button>
          {!isCollapsed && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  const actions = (
    <>
      <button type="button" className="gt-icon-button" title="New worktree… (W)" aria-label="New worktree" onClick={() => onAction({ kind: 'create' })}>
        +
      </button>
      <button type="button" className="gt-icon-button" title="Refresh worktrees" aria-label="Refresh worktrees" onClick={() => onAction({ kind: 'refresh' })}>
        ⟳
      </button>
      <button
        type="button"
        className="gt-icon-button"
        title="More worktree actions"
        aria-label="More worktree actions"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ x: box.left, y: box.bottom + 2, items: headerItems });
        }}
      >
        ⋯
      </button>
    </>
  );

  return (
    <>
      <SidebarSection
        title="Worktrees"
        count={worktrees.length || undefined}
        collapsed={filtering ? false : collapsed}
        onToggle={onToggle}
        actions={actions}
        onHeaderContextMenu={(event) => openMenu(event, headerItems)}
      >
        {state.error && (
          <div className="gt-source-row gt-wt-error" title={state.error}>
            <span className="gt-source-name">Couldn’t list worktrees</span>
          </div>
        )}

        {filtering
          ? worktrees.filter((entry) => matches.has(entry.path)).map((entry) => row(entry, 0, entry.branch ?? basename(entry.path)))
          : (
            <>
              {main && row(main, 0, main.bare ? 'bare repository' : (main.branch ?? basename(main.path)))}
              {renderTree(tree, 0)}
              {state.list && linked.length === 0 && (
                <button type="button" className="gt-source-row gt-wt-ghost" onClick={() => onAction({ kind: 'create' })}>
                  <span className="gt-wt-ghost-plus" aria-hidden="true">
                    +
                  </span>
                  <span className="gt-source-name">New worktree…</span>
                </button>
              )}
            </>
          )}
      </SidebarSection>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
    </>
  );
}

function WorktreeRow({
  entry,
  depth,
  label,
  positions,
  summary,
  shortPath,
  selected,
  colorLabels,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  entry: WorktreeEntry;
  depth: number;
  label: string;
  positions?: number[] | undefined;
  summary?: WorktreeSummary | undefined;
  shortPath: string;
  selected: boolean;
  colorLabels: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  const changes = changeCount(summary);
  const segments = positions && positions.length > 0 ? highlightSegments(label, positions) : [{ text: label, matched: false }];
  const color = colorLabels ? entry.color : undefined;
  const tooltip = [
    entry.path,
    shortPath !== entry.path ? `(${shortPath})` : '',
    entry.branch ? `Branch: ${entry.branch}` : entry.detached ? `Detached at ${entry.head?.slice(0, 7) ?? '?'}` : '',
    entry.locked ? `Locked${entry.lockReason ? `: ${entry.lockReason}` : ''}` : '',
    entry.missing ? 'The folder is missing — Prune clears git’s record of it.' : '',
    summary?.error && !entry.missing ? summary.error : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selected}
      className="gt-source-row gt-wt-row"
      data-missing={entry.missing ? 'true' : undefined}
      style={{ paddingLeft: `calc(var(--gt-space-3) + ${depth * 12}px)` }}
      title={tooltip}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
        if (event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className="gt-wt-dot"
        data-color={color}
        data-hollow={!color && (entry.missing || entry.detached) ? 'true' : undefined}
        style={color ? { background: colorVar(color) } : undefined}
        aria-hidden="true"
      />
      <span className="gt-source-name" data-fit>
        {segments.map((segment, index) => (
          <span key={index} className={segment.matched ? 'gt-match' : undefined}>
            {segment.text}
          </span>
        ))}
      </span>
      {entry.isMain && <span className="gt-kind-badge gt-wt-badge" data-kind="main">main</span>}
      {entry.isCurrent && <span className="gt-kind-badge gt-wt-badge" data-kind="current">current</span>}
      {entry.locked && (
        <span className="gt-kind-badge gt-wt-badge" data-kind="locked" title={entry.lockReason ?? 'Locked'}>
          locked
        </span>
      )}
      {entry.missing && <span className="gt-kind-badge gt-wt-badge" data-kind="missing">missing</span>}
      {entry.detached && !entry.missing && <span className="gt-kind-badge gt-wt-badge" data-kind="detached">detached</span>}
      {changes > 0 && <span className="gt-source-meta" title={`${changes} uncommitted change${changes === 1 ? '' : 's'}`}>{changes}∆</span>}
      {summary && summary.ahead > 0 && <span className="gt-source-meta">{summary.ahead}↑</span>}
      {summary && summary.behind > 0 && <span className="gt-source-meta">{summary.behind}↓</span>}
    </div>
  );
}
