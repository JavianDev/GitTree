import { useCallback, useEffect, useState } from 'react';
import type { PrProvider, PullRequestConnection, PullRequestEntry, PullRequestStatus } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';

export interface PullRequestSectionProps {
  repoId: string;
  revision: number;
  selectedId?: number;
  onSelect: (pr: PullRequestEntry) => void;
  onCreate: () => void;
}

const PROVIDER_LABEL: Record<PrProvider, string> = {
  github: 'GitHub',
  azureDevOps: 'Azure DevOps',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

const PROVIDER_SIGNIN_LABEL: Record<PrProvider, string> = {
  github: 'Sign in to GitHub',
  azureDevOps: 'Sign in to Microsoft',
  gitlab: 'Sign in to GitLab',
  bitbucket: 'Sign in to Bitbucket',
};

/** `#123` for GitHub and Bitbucket, `!123` for Azure DevOps and GitLab merge requests. */
function formatId(provider: PrProvider, id: number): string {
  return provider === 'github' || provider === 'bitbucket' ? `#${id}` : `!${id}`;
}

const VOTE_GLYPH: Record<string, string> = {
  approved: '✓',
  approvedWithSuggestions: '✓',
  rejected: '✗',
  waitingForAuthor: '⧗',
  noVote: '○',
};

const STATUS_OPTIONS: PullRequestStatus[] = ['active', 'completed', 'abandoned'];

/**
 * The sidebar's Pull Requests section.
 *
 * Structurally independent from the ref-derived `SECTIONS` in
 * `ObjectSidebar.tsx` — PRs are not git refs, and this section's presence
 * depends on the remote URL, not on anything `refs/list` returns. Renders
 * nothing at all when no supported remote is detected: no empty state, no
 * placeholder, no mention of the feature.
 */
export function PullRequestSection({
  repoId,
  revision,
  selectedId,
  onSelect,
  onCreate,
}: PullRequestSectionProps): React.JSX.Element | null {
  const [connection, setConnection] = useState<PullRequestConnection | undefined>();
  const [status, setStatus] = useState<PullRequestStatus>('active');
  const [pullRequests, setPullRequests] = useState<PullRequestEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [listError, setListError] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; pr: PullRequestEntry } | undefined
  >();

  // Silent only — never prompts. Runs on every repo change and every
  // revision bump, since a fetch/pull can change which remotes exist.
  useEffect(() => {
    let cancelled = false;
    setConnection(undefined);

    void rpc
      .request('pullRequests/connection', { repoId })
      .then((result) => {
        if (!cancelled) setConnection(result);
      })
      .catch(() => {
        if (!cancelled) setConnection({ detected: false, signedIn: false });
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, revision]);

  const loadList = useCallback(() => {
    if (!connection?.detected || !connection.signedIn) return;

    let cancelled = false;
    void rpc
      .request('pullRequests/list', { repoId, status })
      .then((result) => {
        if (cancelled) return;
        setPullRequests(result.pullRequests);
        setListError(undefined);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPullRequests([]);
        // Shown rather than swallowed: an empty list after a failure reads
        // exactly like "no pull requests", which is how a bad credential hid.
        setListError(error instanceof RpcRequestError ? error.displayText : String(error));
        // A rejected credential is forgotten host-side, so re-checking the
        // connection brings the sign-in row back instead of a dead list.
        void rpc
          .request('pullRequests/connection', { repoId })
          .then((result) => {
            if (!cancelled) setConnection(result);
          })
          .catch(() => undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, status, connection?.detected, connection?.signedIn]);

  useEffect(() => loadList(), [loadList, revision]);

  if (!connection || !connection.detected) return null;

  const providerLabel = connection.provider ? PROVIDER_LABEL[connection.provider] : '';

  const signIn = () => {
    setSigningIn(true);
    void rpc
      .request('pullRequests/signIn', { repoId })
      .then((result) => {
        setSigningIn(false);
        if (!result.signedIn) return;
        setListError(undefined);
        setConnection((current) => (current ? { ...current, signedIn: true } : current));
      })
      .catch(() => setSigningIn(false));
  };

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
        Pull Requests · {providerLabel}
        {connection.signedIn && <span className="gt-group-count">{pullRequests.length}</span>}
      </button>

      {!collapsed && (
        <div role="tree">
          {!connection.signedIn ? (
            <button
              type="button"
              className="gt-source-row gt-pr-signin"
              disabled={signingIn}
              onClick={signIn}
            >
              {signingIn ? 'Signing in…' : `${connection.provider ? PROVIDER_SIGNIN_LABEL[connection.provider] : 'Sign in'} →`}
            </button>
          ) : null}
          {!connection.signedIn && listError && (
            <p className="gt-empty-detail" role="alert" style={{ padding: 'var(--gt-space-3)' }}>
              {listError}
            </p>
          )}
          {connection.signedIn && (
            <>
              <div className="gt-pr-toolbar">
                <select
                  className="gt-pr-status"
                  aria-label="Pull request status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as PullRequestStatus)}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option[0]?.toUpperCase()}
                      {option.slice(1)}
                    </option>
                  ))}
                </select>
                <button type="button" className="gt-button" data-size="small" onClick={onCreate}>
                  + New
                </button>
              </div>

              {listError ? (
                <p className="gt-empty-detail" role="alert" style={{ padding: 'var(--gt-space-3)' }}>
                  {listError}
                </p>
              ) : pullRequests.length === 0 ? (
                <p className="gt-empty-detail" style={{ padding: 'var(--gt-space-3)' }}>
                  No {status} pull requests
                </p>
              ) : (
                pullRequests.map((pr) => (
                  <div
                    key={pr.id}
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={selectedId === pr.id}
                    className="gt-source-row"
                    style={{ paddingLeft: 'var(--gt-space-3)' }}
                    title={pr.title}
                    onClick={() => onSelect(pr)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ x: event.clientX, y: event.clientY, pr });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(pr);
                      }
                    }}
                  >
                    <span className="gt-source-meta gt-mono">{formatId(pr.provider, pr.id)}</span>
                    <span className="gt-source-name">{pr.title}</span>
                    {pr.isDraft && <span className="gt-kind-badge">draft</span>}
                    {pr.reviewers
                      .filter((reviewer) => reviewer.isRequired)
                      .map((reviewer) => (
                        <span
                          key={reviewer.identity.id}
                          className="gt-source-meta"
                          title={`${reviewer.identity.displayName}: ${reviewer.vote}`}
                        >
                          {VOTE_GLYPH[reviewer.vote] ?? '○'}
                        </span>
                      ))}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildPrMenu(contextMenu.pr, loadList)}
          onClose={() => setContextMenu(undefined)}
        />
      )}
    </section>
  );
}

function buildPrMenu(pr: PullRequestEntry, refresh: () => void): ContextMenuItem[] {
  return [
    { label: 'Open in Browser', run: () => void rpc.request('pullRequests/openExternal', { url: pr.webUrl }) },
    { label: 'Refresh', run: refresh },
  ];
}
