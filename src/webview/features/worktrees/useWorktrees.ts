import { useEffect, useMemo, useState } from 'react';
import type { WorktreeConfig, WorktreeEntry, WorktreeList, WorktreeSummary } from '@shared/model';
import { RpcRequestError, rpc } from '../../rpc/client';

/** A counter that moves whenever worktree settings change, from here or from VS Code's settings. */
export function useConfigRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      rpc.on('config/changed', ({ scopes }) => {
        if (scopes.includes('worktrees') || scopes.includes('discovery')) setRevision((n) => n + 1);
      }),
    [],
  );
  return revision;
}

export interface WorktreesState {
  list?: WorktreeList;
  error?: string;
  loading: boolean;
}

/** Every worktree of the repository, reloaded on any change to it or its settings. */
export function useWorktrees(repoId: string, revision: number): WorktreesState & { reload: () => void } {
  const configRevision = useConfigRevision();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<WorktreesState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    rpc
      .request('worktrees/list', { repoId })
      .then((list) => {
        if (!cancelled) setState({ list, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ loading: false, error: error instanceof RpcRequestError ? error.displayText : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, revision, configRevision, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/**
 * Change counts and ahead/behind per worktree row — one `git status` in each
 * folder, so only read while someone can see the rows.
 */
export function useWorktreeSummaries(
  repoId: string,
  worktrees: readonly WorktreeEntry[] | undefined,
  enabled: boolean,
  revision: number,
): Map<string, WorktreeSummary> {
  const [summaries, setSummaries] = useState<Map<string, WorktreeSummary>>(new Map());
  const paths = useMemo(
    () => (worktrees ?? []).filter((entry) => !entry.bare && !entry.missing).map((entry) => entry.path),
    [worktrees],
  );
  const key = paths.join('\n');

  useEffect(() => {
    if (!enabled || paths.length === 0) return;
    let cancelled = false;
    rpc
      .request('worktrees/summary', { repoId, paths })
      .then((result) => {
        if (cancelled) return;
        setSummaries(new Map(result.summaries.map((summary) => [summary.path, summary])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `key` stands in for `paths`, which is a fresh array on every list load.
  }, [repoId, key, enabled, revision]);

  return summaries;
}

/** The repository's worktree settings: defaults, its override, and what they resolve to. */
export function useWorktreeConfig(repoId: string, revision = 0): {
  config?: WorktreeConfig;
  setConfig: (config: WorktreeConfig) => void;
} {
  const configRevision = useConfigRevision();
  const [config, setConfig] = useState<WorktreeConfig | undefined>();

  useEffect(() => {
    let cancelled = false;
    rpc
      .request('worktrees/config', { repoId })
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoId, revision, configRevision]);

  return { config, setConfig };
}
