import { useEffect, useState } from 'react';
import type { DiffFile } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';
import { DiffViewer, type DiffLayout } from '../review/DiffViewer';

export interface PullRequestDiffPaneProps {
  repoId: string;
  prId: number;
  /** `undefined` selects the overall diff (merge-base..source); set, one commit's diff. */
  commitHash?: string;
}

/**
 * Reuses `diff/get` and `DiffViewer` verbatim — a PR diff is satisfied by
 * feeding the existing pipeline the right commit hashes, never by adding a
 * provider-specific diff endpoint. `ensureFetched` runs once per PR (not per
 * commit) since it is what makes every commit's hash resolvable locally.
 */
export function PullRequestDiffPane({ repoId, prId, commitHash }: PullRequestDiffPaneProps): React.JSX.Element {
  const [fetched, setFetched] = useState<{ sourceOid: string; mergeBaseOid: string } | undefined>();
  const [fetchError, setFetchError] = useState<string | undefined>();
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [diffError, setDiffError] = useState<string | undefined>();
  const [layout, setLayout] = useState<DiffLayout>('unified');

  useEffect(() => {
    let cancelled = false;
    setFetched(undefined);
    setFetchError(undefined);

    void rpc
      .request('pullRequests/ensureFetched', { repoId, id: prId })
      .then((result) => {
        if (!cancelled) setFetched(result);
      })
      .catch((error) => {
        if (!cancelled) setFetchError(error instanceof RpcRequestError ? error.displayText : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, prId]);

  useEffect(() => {
    if (!fetched) return;

    let cancelled = false;
    setLoading(true);
    setDiffError(undefined);

    const target = commitHash
      ? ({ kind: 'commit', repoId, hash: commitHash } as const)
      : ({ kind: 'range', repoId, from: fetched.mergeBaseOid, to: fetched.sourceOid } as const);

    void rpc
      .request('diff/get', target)
      .then((result) => {
        if (!cancelled) setFiles(result);
      })
      .catch((error) => {
        if (!cancelled) setDiffError(error instanceof RpcRequestError ? error.displayText : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, commitHash, fetched]);

  if (fetchError) {
    return (
      <div className="gt-empty">
        <p className="gt-empty-title">This pull request's commits are no longer available</p>
        <p className="gt-empty-detail">{fetchError}</p>
      </div>
    );
  }

  return (
    <DiffViewer
      files={files}
      layout={layout}
      onLayout={setLayout}
      loading={!fetched || loading}
      {...(diffError ? { error: diffError } : {})}
      empty="This change is empty."
    />
  );
}
