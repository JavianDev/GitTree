import { useEffect, useState } from 'react';
import type { StashEntry } from '@shared/model';
import { rpc } from '../../rpc/client';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';

export type StashActionId = 'stash.apply' | 'stash.pop' | 'stash.drop';

export interface StashSectionProps {
  repoId: string;
  revision: number;
  selectedRef?: string;
  /** Shows the stash's diff via the same commit-diff pipeline `HistoryView` uses. */
  onSelect: (stash: StashEntry) => void;
  /** Opens the review-before-run command sheet, pre-filled with `stashRef`. */
  onAction: (id: StashActionId, stashRef: string) => void;
}

/**
 * The sidebar's Stashes section — every stash, not just the tip that
 * `refs/list` surfaces via `refs/stash`.
 *
 * A click previews the stash's diff (non-destructive, mirrors clicking a
 * commit). Apply/Pop/Drop are reachable only from the right-click menu —
 * there is deliberately no double-click default, since neither apply-vs-pop
 * is safe to guess and drop is destructive.
 */
export function StashSection({
  repoId,
  revision,
  selectedRef,
  onSelect,
  onAction,
}: StashSectionProps): React.JSX.Element | null {
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; stash: StashEntry } | undefined
  >();

  useEffect(() => {
    let cancelled = false;

    void rpc
      .request('stash/list', { repoId })
      .then((result) => {
        if (!cancelled) setStashes(result.stashes);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [repoId, revision]);

  // No section at all when there are no stashes — matches the rest of the
  // sidebar, where an empty ref kind renders nothing rather than a placeholder.
  if (stashes.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        className="gt-section-header"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span className="gt-disclosure" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        Stashes
        <span className="gt-group-count">{stashes.length}</span>
      </button>

      {!collapsed && (
        <div role="tree">
          {stashes.map((stash) => (
            <div
              key={stash.ref}
              role="treeitem"
              tabIndex={0}
              aria-selected={selectedRef === stash.ref}
              className="gt-source-row"
              style={{ paddingLeft: 'var(--gt-space-3)' }}
              title={stash.branch ? `${stash.message}\non ${stash.branch}` : stash.message}
              onClick={() => onSelect(stash)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, stash });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(stash);
                }
              }}
            >
              <span className="gt-ref-dot" data-kind="stash" aria-hidden="true" />
              <span className="gt-source-name">{stash.message}</span>
              {stash.branch && <span className="gt-kind-badge">{stash.branch}</span>}
              <span className="gt-source-meta">{relativeDate(stash.createdAt)}</span>
              <span className="gt-source-meta gt-mono">{stash.shortOid}</span>
            </div>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildStashMenu(contextMenu.stash, onAction)}
          onClose={() => setContextMenu(undefined)}
        />
      )}
    </section>
  );
}

function buildStashMenu(stash: StashEntry, onAction: StashSectionProps['onAction']): ContextMenuItem[] {
  return [
    { label: 'Apply', run: () => onAction('stash.apply', stash.ref) },
    { label: 'Pop', run: () => onAction('stash.pop', stash.ref) },
    { label: '', run: () => undefined, separator: true },
    { label: 'Drop…', destructive: true, run: () => onAction('stash.drop', stash.ref) },
  ];
}

/** Same scale as `HistoryView.tsx`'s `relativeDate` — kept local, one caller each. */
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
