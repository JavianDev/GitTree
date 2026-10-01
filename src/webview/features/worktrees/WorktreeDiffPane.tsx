import { useEffect, useState } from 'react';
import type { DiffFile } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';
import { type DiffLayout, DiffViewer } from '../review/DiffViewer';
import type { WorktreeSelection } from './WorktreeDetails';

/** The Code pane for a worktree: the selected file's diff, or the selected outgoing commit. */
export function WorktreeDiffPane({
  worktreeRepoId,
  selection,
}: {
  worktreeRepoId?: string;
  selection?: WorktreeSelection;
}): React.JSX.Element {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [layout, setLayout] = useState<DiffLayout>('unified');

  useEffect(() => {
    if (!worktreeRepoId || !selection) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const target = selection.kind === 'file' ? selection.target : ({ kind: 'commit', repoId: worktreeRepoId, hash: selection.hash } as const);
    rpc
      .request('diff/get', target)
      .then((result) => {
        if (!cancelled) setFiles(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof RpcRequestError ? reason.displayText : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeRepoId, selection]);

  if (!selection) {
    return (
      <div className="gt-empty">
        <p className="gt-empty-title">Select a file or a commit</p>
        <p className="gt-empty-detail">Its diff, from this worktree, appears here.</p>
      </div>
    );
  }

  return (
    <DiffViewer
      files={files}
      layout={layout}
      onLayout={setLayout}
      loading={loading}
      {...(error ? { error } : {})}
      empty="No textual changes."
    />
  );
}
