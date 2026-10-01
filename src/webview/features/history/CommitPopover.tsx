import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Commit, Identity, SignatureStatus } from '@shared/model';
import { rpc } from '../../rpc/client';
import { type ContextMenuItem, MenuItems } from '../../shared/ContextMenu';
import { RefPill } from './HistoryView';
import './commitPopover.css';

export interface CommitPopoverProps {
  repoId: string;
  /** The commit as the list has it; the full record is fetched for the fields the list leaves out. */
  commit: Commit;
  /** Where it was asked for: the pointer for a right-click, beside the node for a click on it. */
  x: number;
  y: number;
  /** The actions, for a right-click. Absent when only the details were asked for. */
  items?: readonly ContextMenuItem[];
  onClose: () => void;
  /** Select a parent in the graph. */
  onJump: (hash: string) => void;
  onCopy: (text: string, label: string) => void;
}

/** Below this width the actions and the details sit one above the other. */
const SIDE_BY_SIDE_MIN = 700;

const SIGNATURE: Record<SignatureStatus, string> = {
  good: 'Good signature',
  bad: 'Bad signature',
  'unknown-validity': 'Signed, validity unknown',
  expired: 'Signed with an expired signature',
  'expired-key': 'Signed with an expired key',
  'revoked-key': 'Signed with a revoked key',
  'cannot-check': 'Signed, but the signature could not be checked',
  none: '',
};

/**
 * A commit's details, with its actions beside them on a right-click.
 *
 * The history list loads only what a row shows. The committer, commit date,
 * full message and signature come from `commit/get` when the panel opens, so a
 * walk of twenty thousand commits does not carry them for every row. Until they
 * arrive the panel shows what the list already knows.
 */
export function CommitPopover({ repoId, commit, x, y, items, onClose, onJump, onCopy }: CommitPopoverProps): React.JSX.Element {
  const [detail, setDetail] = useState<Commit | undefined>();
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | undefined>();
  const panelRef = useRef<HTMLDivElement>(null);
  const stacked = items !== undefined && window.innerWidth < SIDE_BY_SIDE_MIN;

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setFailed(false);
    rpc
      .request('commit/get', { repoId, hash: commit.hash })
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, commit.hash]);

  // Measured before paint, then pulled inside the window: it opens at the
  // pointer when it fits, and as near to it as it can when it does not.
  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
    setPosition((current) => (current && current.left === left && current.top === top ? current : { left, top }));
  }, [x, y, detail, failed, items, stacked]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });

    const outside = (event: Event) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    // Deferred a tick, like the context menu: the press that opened it must
    // not also close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', outside), 0);
    // It is placed against the row it came from; once the list scrolls, that
    // row is somewhere else.
    document.addEventListener('wheel', outside, { passive: true });
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('wheel', outside);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const full = detail ?? commit;
  const loading = detail === undefined && !failed;
  const signature = detail ? SIGNATURE[detail.signature] : '';
  const refs = commit.refs.filter((ref) => ref.kind !== 'head');

  return createPortal(
    <div
      ref={panelRef}
      className="gt-commit-pop"
      data-layout={stacked ? 'stacked' : 'side'}
      role="dialog"
      aria-label={`Commit ${commit.shortHash}`}
      tabIndex={-1}
      style={{
        left: `${position?.left ?? x}px`,
        top: `${position?.top ?? y}px`,
        visibility: position ? 'visible' : 'hidden',
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items && (
        <div className="gt-commit-pop-menu" role="menu" aria-label="Commit actions">
          <MenuItems items={items} onClose={onClose} />
        </div>
      )}

      <section className="gt-commit-card" aria-label="Commit details">
        <p className="gt-commit-card-subject">{full.subject}</p>
        {full.body && <pre className="gt-commit-card-body">{full.body}</pre>}

        {refs.length > 0 && (
          <div className="gt-commit-card-refs">
            {refs.map((ref) => (
              <RefPill key={`${ref.kind}:${ref.name}`} decoration={ref} />
            ))}
          </div>
        )}

        <dl className="gt-commit-card-fields">
          <dt>Commit</dt>
          <dd className="gt-commit-card-sha">
            <code>{commit.hash}</code>
            <button
              type="button"
              className="gt-commit-card-link"
              onClick={() => onCopy(commit.hash, `Copied ${commit.shortHash}`)}
              title="Copy the full SHA"
            >
              Copy
            </button>
          </dd>

          <dt>{commit.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
          <dd>
            {commit.parents.length === 0 ? (
              <span className="gt-commit-card-muted">None — the first commit</span>
            ) : (
              commit.parents.map((parent) => (
                <button
                  type="button"
                  key={parent}
                  className="gt-commit-card-link gt-mono"
                  title={`Go to ${parent}`}
                  onClick={() => {
                    onJump(parent);
                    onClose();
                  }}
                >
                  {parent.slice(0, commit.shortHash.length || 7)}
                </button>
              ))
            )}
          </dd>

          <dt>Author</dt>
          <dd>
            <Person identity={full.author} />
          </dd>
          <dt>Date</dt>
          <dd>
            <When iso={full.authorDate} />
          </dd>

          <dt>Committer</dt>
          <dd>{loading ? <Pending /> : <Person identity={full.committer} />}</dd>
          <dt>Commit date</dt>
          <dd>{loading ? <Pending /> : <When iso={full.commitDate} />}</dd>

          {signature && (
            <>
              <dt>Signature</dt>
              <dd>{signature}</dd>
            </>
          )}
        </dl>

        {failed && <p className="gt-commit-card-muted">Could not read the rest of this commit.</p>}
      </section>
    </div>,
    document.body,
  );
}

function Person({ identity }: { identity: Identity }): React.JSX.Element {
  return (
    <>
      {identity.name}
      {identity.email && <span className="gt-commit-card-muted"> &lt;{identity.email}&gt;</span>}
    </>
  );
}

function When({ iso }: { iso: string }): React.JSX.Element {
  return (
    <>
      <time dateTime={iso}>{formatDate(iso)}</time>
      <span className="gt-commit-card-muted"> · {timeAgo(iso)}</span>
    </>
  );
}

function Pending(): React.JSX.Element {
  return <span className="gt-commit-card-muted">Loading…</span>;
}

/** The date in the reader's own locale and time zone. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "3 days ago" — the long form of the list's "3d". */
export function timeAgo(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, (now - time) / 1000);
  const span = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return span(Math.floor(seconds / 60), 'minute');
  if (seconds < 86_400) return span(Math.floor(seconds / 3600), 'hour');
  if (seconds < 2_592_000) return span(Math.floor(seconds / 86_400), 'day');
  if (seconds < 31_536_000) return span(Math.floor(seconds / 2_592_000), 'month');
  return span(Math.floor(seconds / 31_536_000), 'year');
}
