import { useEffect, useMemo, useState } from 'react';
import type { RefEntry } from '@shared/model';
import { rpc } from '../../rpc/client';
import { type RefNode, buildRefTree, folderPaths, recentRefs } from './BranchTree';
import { filterRefs, highlightSegments } from './RefFilter';

export interface ObjectSidebarProps {
  repoId: string;
  revision: number;
  selectedRef?: string;
  onSelect: (ref: RefEntry) => void;
  onCheckout: (ref: RefEntry) => void;
}

type SectionId = 'branches' | 'remotes' | 'tags' | 'stashes';

const SECTIONS: Array<{ id: SectionId; title: string; kind: RefEntry['kind'] }> = [
  { id: 'branches', title: 'Branches', kind: 'localBranch' },
  { id: 'remotes', title: 'Remotes', kind: 'remoteBranch' },
  { id: 'tags', title: 'Tags', kind: 'tag' },
  { id: 'stashes', title: 'Stashes', kind: 'stash' },
];

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
}: ObjectSidebarProps): React.JSX.Element {
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['remotes', 'tags', 'stashes']));

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
      onSelect={onSelect}
      onCheckout={onCheckout}
    />
  );

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
            if (event.key === 'Enter' && matched[0]) onCheckout(matched[0]);
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

      {SECTIONS.map((section) => {
        const items = matched.filter((ref) => ref.kind === section.kind);
        if (items.length === 0) return null;

        return (
          <Section
            key={section.id}
            title={section.title}
            count={items.length}
            // While filtering, everything opens so results are never hidden
            // behind a collapsed folder; the previous state returns afterwards.
            collapsed={filtering ? false : collapsed.has(section.id)}
            onToggle={() => toggle(section.id)}
          >
            <RefTree nodes={buildRefTree(items)} depth={0} collapsed={collapsed} onToggle={toggle} row={row} />
          </Section>
        );
      })}

      {filtering && matched.length === 0 && (
        <p className="gt-empty-detail" style={{ padding: 'var(--gt-space-3)' }}>
          No refs match “{query}”.
        </p>
      )}
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
              <span className="gt-source-name">{node.name}</span>
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
  onSelect,
  onCheckout,
}: {
  ref_: RefEntry;
  depth: number;
  selected: boolean;
  positions?: number[];
  onSelect: (ref: RefEntry) => void;
  onCheckout: (ref: RefEntry) => void;
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
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCheckout(ref_);
        if (event.key === ' ') {
          event.preventDefault();
          onSelect(ref_);
        }
      }}
    >
      <span className="gt-ref-dot" data-head={ref_.isHead} aria-hidden="true" />

      <span className="gt-source-name">
        {segments.map((segment, index) => (
          <span key={index} className={segment.matched ? 'gt-match' : undefined}>
            {segment.text}
          </span>
        ))}
      </span>

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
