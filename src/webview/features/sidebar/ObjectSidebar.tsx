import { useEffect, useMemo, useState } from 'react';
import type { PullRequestEntry, RefEntry, StashEntry, WorktreeEntry } from '@shared/model';
import { basename } from '@shared/worktrees';
import { rpc } from '../../rpc/client';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';
import type { WorktreeAction } from '../worktrees/actions';
import { WorktreeSection } from '../worktrees/WorktreeSection';
import { useWorktreeConfig, useWorktreeSummaries, useWorktrees } from '../worktrees/useWorktrees';
import { type RefNode, buildRefTree, recentRefs } from './BranchTree';
import { PullRequestSection } from './PullRequestSection';
import { filterRefs, highlightSegments, matchText } from './RefFilter';
import { type StashActionId, StashSection } from './StashSection';

export interface ObjectSidebarProps {
  repoId: string;
  revision: number;
  selectedRef?: string;
  onSelect: (ref: RefEntry) => void;
  onCheckout: (ref: RefEntry) => void;
  /** Shows a stash's diff via the same commit-diff pipeline `HistoryView` uses. */
  onSelectStash: (stash: StashEntry) => void;
  /** Opens the review-before-run command sheet, pre-filled with `stashRef`. */
  onStashAction: (id: StashActionId, stashRef: string) => void;
  selectedPrId?: number;
  onSelectPr: (pr: PullRequestEntry) => void;
  onCreatePr: () => void;
  /** The worktree whose details are showing, by path. */
  selectedWorktree?: string;
  onWorktree: (action: WorktreeAction) => void;
}

type SectionId = 'branches' | 'remotes' | 'tags';

const SECTIONS: Record<SectionId, { title: string; kind: RefEntry['kind'] }> = {
  branches: { title: 'Branches', kind: 'localBranch' },
  remotes: { title: 'Remotes', kind: 'remoteBranch' },
  tags: { title: 'Tags', kind: 'tag' },
};

/**
 * The source list — repository objects only.
 *
 * View modes moved to the context bar, so this column is free to do the one job
 * a macOS source list is for: presenting the things you can select. That matters
 * at real scale; the workspace this was designed against has forty-seven
 * branches, which left no room for anything else when modes shared the space.
 */
export function ObjectSidebar({
  repoId,
  revision,
  selectedRef,
  onSelect,
  onCheckout,
  onSelectStash,
  onStashAction,
  selectedPrId,
  onSelectPr,
  onCreatePr,
  selectedWorktree,
  onWorktree,
}: ObjectSidebarProps): React.JSX.Element {
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['remotes', 'tags']));
  const [refMenu, setRefMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | undefined>();

  const worktrees = useWorktrees(repoId, revision);
  const { config: worktreeConfig } = useWorktreeConfig(repoId);
  const summaries = useWorktreeSummaries(repoId, worktrees.list?.worktrees, !collapsed.has('worktrees'), revision);

  /** Local branches checked out in a worktree other than the one this tab shows. */
  const heldBy = useMemo(() => {
    const map = new Map<string, WorktreeEntry>();
    for (const entry of worktrees.list?.worktrees ?? []) {
      if (entry.branch && !entry.isCurrent) map.set(entry.branch, entry);
    }
    return map;
  }, [worktrees.list]);

  useEffect(() => {
    let cancelled = false;

    void rpc
      .request('refs/list', { repoId })
      .then((result) => {
        if (!cancelled) setRefs(result.refs);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [repoId, revision]);

  const filtering = query.trim().length > 0;

  const matched = useMemo(() => {
    if (!filtering) return refs;
    return filterRefs(query, refs).map((match) => match.ref);
  }, [filtering, query, refs]);

  const positions = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!filtering) return map;
    for (const match of filterRefs(query, refs)) map.set(match.ref.fullName, match.positions);
    return map;
  }, [filtering, query, refs]);

  const current = refs.find((ref) => ref.isHead);
  const recent = useMemo(() => recentRefs(refs), [refs]);

  const worktreeMatches = useMemo(() => {
    if (!filtering) return 0;
    return (worktrees.list?.worktrees ?? []).filter(
      (entry) => matchText(query, entry.branch ?? basename(entry.path)) || matchText(query, basename(entry.path)),
    ).length;
  }, [filtering, query, worktrees.list]);

  const goneBranches = useMemo(
    () => refs.filter((ref) => ref.kind === 'localBranch' && ref.gone && !ref.isHead && !heldBy.has(ref.name)).map((ref) => ref.name),
    [refs, heldBy],
  );

  /**
   * Checking out a branch another worktree has checked out fails in git — a
   * branch lives in one worktree at a time — so that branch opens a sheet
   * offering its worktree instead of running a `switch` that cannot work.
   */
  const checkout = (ref: RefEntry) => {
    const holder = ref.kind === 'localBranch' ? heldBy.get(ref.name) : undefined;
    if (holder) onWorktree({ kind: 'branchHeld', ref, entry: holder });
    else onCheckout(ref);
  };

  const openRefMenu = (event: React.MouseEvent, ref: RefEntry) => {
    event.preventDefault();
    const holder = ref.kind === 'localBranch' ? heldBy.get(ref.name) : undefined;
    const items: ContextMenuItem[] = [];
    if (ref.kind === 'localBranch') {
      items.push({
        label: 'Check Out',
        default: true,
        shortcut: 'Enter',
        run: () => onCheckout(ref),
        ...(ref.isHead
          ? { disabled: 'Already checked out here.' }
          : holder
            ? { disabled: `Checked out in ${holder.path}. A branch can be checked out in one worktree at a time.` }
            : {}),
      });
    }
    items.push({
      label: ref.kind === 'tag' ? 'New Worktree at This Tag…' : 'New Worktree from This Branch…',
      run: () => onWorktree({ kind: 'create', mode: ref.kind === 'localBranch' && !holder && !ref.isHead ? 'existing' : 'new', base: ref }),
      hint: 'Check it out in a separate folder, without switching this one',
    });
    if (holder) {
      items.push({ label: 'Open Its Worktree', run: () => onWorktree({ kind: 'open', entry: holder, target: 'gitTreeTab' }) });
    }
    setRefMenu({ x: event.clientX, y: event.clientY, items });
  };

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (ref: RefEntry, depth: number) => (
    <RefRow
      key={ref.fullName}
      ref_={ref}
      depth={depth}
      selected={selectedRef === ref.fullName}
      positions={positions.get(ref.fullName)}
      heldBy={ref.kind === 'localBranch' ? heldBy.get(ref.name) : undefined}
      onSelect={onSelect}
      onCheckout={checkout}
      onContextMenu={openRefMenu}
    />
  );

  const refSection = (id: SectionId) => {
    const section = SECTIONS[id];
    const items = matched.filter((ref) => ref.kind === section.kind);
    if (items.length === 0) return null;

    return (
      <Section
        key={id}
        title={section.title}
        count={items.length}
        // While filtering, everything opens so results are never hidden
        // behind a collapsed folder; the previous state returns afterwards.
        collapsed={filtering ? false : collapsed.has(id)}
        onToggle={() => toggle(id)}
      >
        <RefTree nodes={buildRefTree(items)} depth={0} collapsed={collapsed} onToggle={toggle} row={row} />
      </Section>
    );
  };

  return (
    <nav className="gt-sidebar" aria-label="Repository objects">
      <div className="gt-filter">
        <input
          type="search"
          className="gt-filter-input"
          placeholder="Filter refs…"
          aria-label="Filter refs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
            // Enter checks out the single best match, which is the whole point
            // of typing a ticket number into the filter.
            if (event.key === 'Enter' && matched[0]) checkout(matched[0]);
          }}
        />
        {filtering && (
          <span className="gt-filter-count">
            {matched.length} of {refs.length}
          </span>
        )}
      </div>

      {/* Pinned above the tree: the branch you are on and the ones you were just
          on should never require scrolling past thirty others. */}
      {!filtering && current && (
        <Section title="Current" collapsed={false} onToggle={() => undefined}>
          {row(current, 0)}
        </Section>
      )}

      {!filtering && recent.length > 0 && (
        <Section
          title="Recent"
          collapsed={collapsed.has('recent')}
          onToggle={() => toggle('recent')}
          count={recent.length}
        >
          {recent.map((ref) => row(ref, 0))}
        </Section>
      )}

      {refSection('branches')}

      {/* Right after branches: a worktree is a branch checked out somewhere else. */}
      <WorktreeSection
        state={worktrees}
        summaries={summaries}
        query={query}
        {...(selectedWorktree !== undefined ? { selectedPath: selectedWorktree } : {})}
        defaultOpen={worktreeConfig?.effective.openBehavior === 'newWindow' || worktreeConfig?.effective.openBehavior === 'currentWindow' ? worktreeConfig.effective.openBehavior : 'gitTreeTab'}
        colorLabels={worktreeConfig?.effective.colorLabels ?? true}
        goneBranches={goneBranches}
        collapsed={collapsed.has('worktrees')}
        onToggle={() => toggle('worktrees')}
        onAction={(action) => {
          if (action.kind === 'refresh') worktrees.reload();
          onWorktree(action);
        }}
      />

      {refSection('remotes')}
      {refSection('tags')}

      {filtering && matched.length === 0 && worktreeMatches === 0 && (
        <p className="gt-empty-detail" style={{ padding: 'var(--gt-space-3)' }}>
          No refs match “{query}”.
        </p>
      )}

      {/* Structurally independent: presence depends on the remote URL, not on
          anything `refs/list` returns, and fetches over the network rather than
          reading local git state. */}
      <PullRequestSection
        repoId={repoId}
        revision={revision}
        {...(selectedPrId !== undefined ? { selectedId: selectedPrId } : {})}
        onSelect={onSelectPr}
        onCreate={onCreatePr}
      />

      {/* Stashes last: shelved work, reached for least often. They are not git
          refs in the sense the rest of this sidebar walks — `refs/list` only
          ever surfaces the tip via `refs/stash` — so this is a structurally
          independent, always-fetched section, unaffected by the filter box. */}
      <StashSection
        repoId={repoId}
        revision={revision}
        {...(selectedRef?.startsWith('stash@') ? { selectedRef } : {})}
        onSelect={onSelectStash}
        onAction={onStashAction}
      />

      {refMenu && <ContextMenu x={refMenu.x} y={refMenu.y} items={refMenu.items} onClose={() => setRefMenu(undefined)} />}
    </nav>
  );
}

function Section({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <button type="button" className="gt-section-header" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="gt-disclosure" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        {title}
        {count !== undefined && <span className="gt-group-count">{count}</span>}
      </button>
      {!collapsed && <div role="tree">{children}</div>}
    </section>
  );
}

function RefTree({
  nodes,
  depth,
  collapsed,
  onToggle,
  row,
}: {
  nodes: RefNode[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  row: (ref: RefEntry, depth: number) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'leaf') return row(node.ref, depth);

        const isCollapsed = collapsed.has(node.path);

        return (
          <div key={node.path} role="none">
            <button
              type="button"
              className="gt-source-row gt-folder-row"
              style={{ paddingLeft: `calc(var(--gt-space-3) + ${depth * 12}px)` }}
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(node.path)}
            >
              <span className="gt-disclosure" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span className="gt-source-name" data-fit>
                {node.name}
              </span>
              <span className="gt-source-meta">{node.count}</span>
            </button>

            {!isCollapsed && (
              <RefTree
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                row={row}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function RefRow({
  ref_,
  depth,
  selected,
  positions,
  heldBy,
  onSelect,
  onCheckout,
  onContextMenu,
}: {
  ref_: RefEntry;
  depth: number;
  selected: boolean;
  positions?: number[] | undefined;
  /** The worktree that has this branch checked out, when it is not this one. */
  heldBy?: WorktreeEntry | undefined;
  onSelect: (ref: RefEntry) => void;
  onCheckout: (ref: RefEntry) => void;
  onContextMenu: (event: React.MouseEvent, ref: RefEntry) => void;
}): React.JSX.Element {
  // While filtering the full path is shown, because the folder context that
  // would otherwise supply it is flattened away.
  const label = positions ? ref_.name : (ref_.name.split('/').pop() ?? ref_.name);
  const segments = positions ? highlightSegments(ref_.name, positions) : [{ text: label, matched: false }];

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selected}
      className="gt-source-row"
      style={{ paddingLeft: `calc(var(--gt-space-3) + ${depth * 12}px)` }}
      title={ref_.subject ? `${ref_.name}\n${ref_.subject}` : ref_.name}
      onClick={() => onSelect(ref_)}
      onDoubleClick={() => onCheckout(ref_)}
      onContextMenu={(event) => onContextMenu(event, ref_)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCheckout(ref_);
        if (event.key === ' ') {
          event.preventDefault();
          onSelect(ref_);
        }
      }}
    >
      <span className="gt-ref-dot" data-head={ref_.isHead} aria-hidden="true" />

      <span className="gt-source-name" data-fit>
        {segments.map((segment, index) => (
          <span key={index} className={segment.matched ? 'gt-match' : undefined}>
            {segment.text}
          </span>
        ))}
      </span>

      {heldBy && (
        <span className="gt-kind-badge gt-wt-marker" title={`Checked out in the worktree at ${heldBy.path}`}>
          wt
        </span>
      )}
      {ref_.gone && (
        <span className="gt-kind-badge" title="Upstream branch no longer exists">
          gone
        </span>
      )}
      {ref_.behind ? <span className="gt-source-meta">{ref_.behind}↓</span> : null}
      {ref_.ahead ? <span className="gt-source-meta">{ref_.ahead}↑</span> : null}
    </div>
  );
}
