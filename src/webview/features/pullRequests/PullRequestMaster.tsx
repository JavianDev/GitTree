import { useCallback, useEffect, useState } from 'react';
import type { PullRequestCommentThread, PullRequestDetail } from '@shared/model';
import { rpc } from '../../rpc/client';
import { CommentThreadsPanel } from './CommentThreadsPanel';
import { type PrActionKind, PrActionSheet } from './PrActionSheet';
import './pullRequests.css';

export interface PullRequestMasterProps {
  repoId: string;
  prId: number;
  /** `undefined` means the pinned "Overall diff" row is selected. */
  selectedCommit?: string;
  onSelectCommit: (hash: string | undefined) => void;
  onChanged: () => void;
}

/**
 * The PR detail view's middle-pane content: header, action bar, commit list
 * with a pinned "Overall diff" row, and a collapsible comments panel.
 */
export function PullRequestMaster({
  repoId,
  prId,
  selectedCommit,
  onSelectCommit,
  onChanged,
}: PullRequestMasterProps): React.JSX.Element {
  const [pr, setPr] = useState<PullRequestDetail | undefined>();
  const [threads, setThreads] = useState<PullRequestCommentThread[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [action, setAction] = useState<PrActionKind | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(() => {
    void rpc
      .request('pullRequests/get', { repoId, id: prId })
      .then(setPr)
      .catch((caught) => setError(String(caught)));
  }, [repoId, prId]);

  useEffect(load, [load]);

  const loadThreads = useCallback(() => {
    void rpc
      .request('pullRequests/commentThreads', { repoId, id: prId })
      .then((result) => setThreads(result.threads))
      .catch(() => setThreads([]));
  }, [repoId, prId]);

  useEffect(() => {
    if (commentsOpen) loadThreads();
  }, [commentsOpen, loadThreads]);

  const applied = () => {
    load();
    onChanged();
  };

  if (error) {
    return (
      <div className="gt-empty">
        <p className="gt-empty-title">Could not load this pull request</p>
        <p className="gt-empty-detail">{error}</p>
      </div>
    );
  }

  if (!pr) return <div className="gt-empty" />;

  return (
    <div className="gt-pr-master">
      <header className="gt-pr-header">
        <h2 className="gt-pr-title">{pr.title}</h2>
        <div className="gt-pr-badges">
          <span className="gt-kind-badge">{pr.status}</span>
          {pr.isDraft && <span className="gt-kind-badge">draft</span>}
        </div>
        <p className="gt-pr-meta">
          {pr.sourceBranch} → {pr.targetBranch} · opened by {pr.author.displayName}
        </p>

        {pr.description && (
          <>
            <button type="button" className="gt-button" data-size="small" onClick={() => setDescriptionOpen((v) => !v)}>
              {descriptionOpen ? 'Hide description' : 'Show description'}
            </button>
            {descriptionOpen && <p className="gt-pr-description">{pr.description}</p>}
          </>
        )}

        {pr.reviewers.length > 0 && (
          <div className="gt-pr-reviewers">
            {pr.reviewers.map((reviewer) => (
              <span key={reviewer.identity.id} className="gt-kind-badge" title={reviewer.vote}>
                {reviewer.identity.displayName}
                {reviewer.isRequired ? ' *' : ''}
              </span>
            ))}
          </div>
        )}

        {pr.policies.length > 0 && (
          <div className="gt-pr-policies">
            {pr.policies.map((policy) => (
              <span key={policy.policyId} className="gt-kind-badge" data-status={policy.status}>
                {policy.displayName}: {policy.status}
              </span>
            ))}
          </div>
        )}

        {pr.workItems.length > 0 && (
          <div className="gt-pr-work-items">
            {pr.workItems.map((item) => (
              <a
                key={item.id}
                href="#"
                className="gt-kind-badge"
                onClick={(event) => {
                  event.preventDefault();
                  void rpc.request('pullRequests/openExternal', { url: item.webUrl });
                }}
              >
                #{item.id} {item.title ?? ''}
              </a>
            ))}
          </div>
        )}

        {pr.status === 'active' && (
          <div className="gt-pr-actions">
            <button type="button" className="gt-button" onClick={() => setAction({ kind: 'vote', vote: 'approved' })}>
              Approve
            </button>
            <button
              type="button"
              className="gt-button"
              onClick={() => setAction({ kind: 'vote', vote: 'approvedWithSuggestions' })}
            >
              Approve w/ Suggestions
            </button>
            {pr.capabilities.waitingForAuthorVote && (
              <button type="button" className="gt-button" onClick={() => setAction({ kind: 'vote', vote: 'waitingForAuthor' })}>
                Wait
              </button>
            )}
            <button type="button" className="gt-button" onClick={() => setAction({ kind: 'vote', vote: 'rejected' })}>
              Reject
            </button>
            <span className="gt-toolbar-spacer" />
            <button type="button" className="gt-button" data-variant="primary" onClick={() => setAction({ kind: 'complete' })}>
              Complete
            </button>
            <button type="button" className="gt-button" data-variant="destructive" onClick={() => setAction({ kind: 'abandon' })}>
              Abandon
            </button>
          </div>
        )}
      </header>

      <div className="gt-pr-commits" role="tree" aria-label="Pull request commits">
        <div
          role="treeitem"
          tabIndex={0}
          aria-selected={selectedCommit === undefined}
          className="gt-source-row"
          onClick={() => onSelectCommit(undefined)}
        >
          <span className="gt-source-name">Overall diff</span>
        </div>

        {pr.commits.map((commit) => (
          <div
            key={commit.commitId}
            role="treeitem"
            tabIndex={0}
            aria-selected={selectedCommit === commit.commitId}
            className="gt-source-row"
            title={commit.comment}
            onClick={() => onSelectCommit(commit.commitId)}
          >
            <span className="gt-source-meta gt-mono">{commit.commitId.slice(0, 7)}</span>
            <span className="gt-source-name">{commit.comment.split('\n')[0]}</span>
          </div>
        ))}
      </div>

      <button type="button" className="gt-section-header" onClick={() => setCommentsOpen((v) => !v)} aria-expanded={commentsOpen}>
        <span className="gt-disclosure" aria-hidden="true">
          {commentsOpen ? '▾' : '▸'}
        </span>
        Comments
      </button>

      {commentsOpen && (
        <CommentThreadsPanel repoId={repoId} prId={prId} threads={threads} onPosted={loadThreads} />
      )}

      {action && (
        <PrActionSheet repoId={repoId} pr={pr} action={action} onClose={() => setAction(undefined)} onApplied={applied} />
      )}
    </div>
  );
}
