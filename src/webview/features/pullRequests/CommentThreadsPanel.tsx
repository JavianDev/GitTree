import { useState } from 'react';
import type { PullRequestCommentThread } from '@shared/model';
import { rpc } from '../../rpc/client';

export interface CommentThreadsPanelProps {
  repoId: string;
  prId: number;
  threads: PullRequestCommentThread[];
  onPosted: () => void;
}

/**
 * A flat, chronological thread list with per-thread and new-general-thread
 * composers. File/line-anchored comment *authoring* from inside `DiffViewer`
 * is out of scope here — `DiffViewer` owns no mutation today, and giving it
 * one would be new scope beyond reusing the existing diff pipeline.
 */
export function CommentThreadsPanel({ repoId, prId, threads, onPosted }: CommentThreadsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [posting, setPosting] = useState(false);

  const postGeneral = () => {
    if (!draft.trim() || posting) return;
    setPosting(true);
    void rpc
      .request('pullRequests/addComment', { repoId, id: prId, content: draft })
      .then(() => {
        setDraft('');
        onPosted();
      })
      .finally(() => setPosting(false));
  };

  const postReply = (threadId: number) => {
    const content = replyDrafts[threadId];
    if (!content?.trim() || posting) return;
    setPosting(true);
    void rpc
      .request('pullRequests/addComment', { repoId, id: prId, threadId, content })
      .then(() => {
        setReplyDrafts((current) => ({ ...current, [threadId]: '' }));
        onPosted();
      })
      .finally(() => setPosting(false));
  };

  return (
    <div className="gt-pr-threads">
      {threads.length === 0 && <p className="gt-empty-detail">No comments yet.</p>}

      {threads.map((thread) => (
        <div key={thread.id} className="gt-pr-thread" data-status={thread.status}>
          {thread.context?.filePath && (
            <div className="gt-pr-thread-context gt-mono">
              {thread.context.filePath}
              {thread.context.rightFileLine ? `:${thread.context.rightFileLine}` : ''}
            </div>
          )}

          {thread.comments.map((comment) => (
            <div key={comment.id} className="gt-pr-comment">
              <span className="gt-pr-comment-author">{comment.author.displayName}</span>
              <span className="gt-pr-comment-date">{comment.publishedAt.slice(0, 10)}</span>
              <p className="gt-pr-comment-body">{comment.content}</p>
            </div>
          ))}

          <div className="gt-pr-reply">
            <input
              type="text"
              className="gt-text-input"
              placeholder="Reply…"
              value={replyDrafts[thread.id] ?? ''}
              onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') postReply(thread.id);
              }}
            />
            <button type="button" className="gt-button" data-size="small" onClick={() => postReply(thread.id)}>
              Reply
            </button>
          </div>
        </div>
      ))}

      <div className="gt-pr-new-thread">
        <textarea
          className="gt-text-input"
          placeholder="Start a new discussion…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
        />
        <button type="button" className="gt-button" data-variant="primary" disabled={posting} onClick={postGeneral}>
          Comment
        </button>
      </div>
    </div>
  );
}
