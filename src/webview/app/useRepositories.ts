import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoId, RepoNode, RepoState } from '@shared/model';
import { rpc } from '../rpc/client';

export interface RepositoriesModel {
  nodes: RepoNode[];
  byId: Map<RepoId, RepoNode>;
  states: Map<RepoId, RepoState>;
  activeId?: RepoId;
  active?: RepoNode;
  roots: RepoNode[];
  childrenOf: (id: RepoId) => RepoNode[];
  activate: (id: RepoId) => void;
  /** Forces the open views to refetch — used after a command mutates the repo. */
  refresh: () => void;
  /** Bumped whenever a watcher reports the active repository changed. */
  revision: number;
}

/**
 * Subscribes to the repository tree and per-repository state.
 *
 * The host is the single source of truth: the view never derives repository
 * identity or containment locally, so a rescan cannot leave the two out of
 * step.
 */
export function useRepositories(): RepositoriesModel {
  const [nodes, setNodes] = useState<RepoNode[]>([]);
  const [states, setStates] = useState<Map<RepoId, RepoState>>(new Map());
  const [activeId, setActiveId] = useState<RepoId | undefined>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const offRepos = rpc.on('repos/changed', ({ nodes: next, activeId: nextActive }) => {
      setNodes(next);
      setActiveId((current) => nextActive ?? current);
    });

    const offState = rpc.on('repos/stateChanged', ({ state }) => {
      setStates((current) => new Map(current).set(state.id, state));
    });

    const offStatus = rpc.on('status/changed', () => setRevision((n) => n + 1));

    rpc.ready();
    void rpc
      .request('repos/list', undefined)
      .then(({ nodes: next, activeId: nextActive }) => {
        setNodes(next);
        setActiveId((current) => current ?? nextActive);
      })
      // The host reports a missing or unusable git binary through its own
      // notification; without this catch the same failure also surfaces as an
      // unhandled rejection in the webview console, which is noise, not news.
      .catch(() => undefined);

    return () => {
      offRepos();
      offState();
      offStatus();
    };
  }, []);

  // Load state for the active repository on selection and on every watcher tick.
  useEffect(() => {
    if (!activeId) return;
    void rpc.request('repos/state', { repoId: activeId }).catch(() => undefined);
  }, [activeId, revision]);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const roots = useMemo(() => nodes.filter((node) => !node.parentId), [nodes]);

  const childrenOf = useCallback(
    (id: RepoId) => {
      const node = byId.get(id);
      if (!node) return [];
      return node.children
        .map((childId) => byId.get(childId))
        .filter((child): child is RepoNode => child !== undefined);
    },
    [byId],
  );

  const activate = useCallback((id: RepoId) => {
    setActiveId(id);
    void rpc.request('repos/activate', { repoId: id }).catch(() => undefined);
  }, []);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  return {
    nodes,
    byId,
    states,
    activeId,
    active: activeId ? byId.get(activeId) : undefined,
    roots,
    childrenOf,
    activate,
    refresh,
    revision,
  };
}
