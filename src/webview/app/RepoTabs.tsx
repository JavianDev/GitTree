import type { RepoKind, RepoNode, RepoState } from '@shared/model';
import type { RepositoriesModel } from './useRepositories';

/** Short marker per kind. A root repo needs none — that is the default case. */
const KIND_MARK: Record<RepoKind, string> = {
  root: '',
  nested: 'nested',
  submodule: 'sub',
  worktree: 'wt',
};

const KIND_TITLE: Record<RepoKind, string> = {
  root: 'Repository',
  nested: 'A separate repository inside another checkout',
  submodule: 'Submodule tracked by its parent repository',
  worktree: 'Linked worktree sharing another repository’s objects',
};

export interface RepoTabsProps {
  model: RepositoriesModel;
  openIds: string[];
  onClose: (repoId: string) => void;
  onAdd: () => void;
}

/**
 * The repository tab strip.
 *
 * One webview holds every repository, so switching tabs is a state change rather
 * than a reload — which is what makes a workspace of a dozen checkouts feel like
 * one application instead of a dozen slow ones.
 */
export function RepoTabs({ model, openIds, onClose, onAdd }: RepoTabsProps): React.JSX.Element {
  const open = openIds
    .map((id) => model.byId.get(id))
    .filter((node): node is RepoNode => node !== undefined);

  return (
    <div className="gt-tabs" role="tablist" aria-label="Open repositories">
      {open.map((node) => (
        <RepoTab
          key={node.id}
          node={node}
          state={model.states.get(node.id)}
          selected={model.activeId === node.id}
          closable={open.length > 1}
          onSelect={() => model.activate(node.id)}
          onClose={() => onClose(node.id)}
        />
      ))}

      <button type="button" className="gt-tab-add" onClick={onAdd} title="Open another repository">
        +
      </button>
    </div>
  );
}

function RepoTab({
  node,
  state,
  selected,
  closable,
  onSelect,
  onClose,
}: {
  node: RepoNode;
  state: RepoState | undefined;
  selected: boolean;
  closable: boolean;
  onSelect: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const ahead = state?.branch.ahead ?? 0;
  const behind = state?.branch.behind ?? 0;
  const dirty =
    (state?.counts.staged ?? 0) + (state?.counts.unstaged ?? 0) + (state?.counts.untracked ?? 0);

  return (
    <div
      role="tab"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      className="gt-tab"
      title={`${node.root}\n${KIND_TITLE[node.kind]}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onAuxClick={(event) => {
        // Middle-click closes, as it does everywhere else with tabs.
        if (event.button === 1 && closable) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <span className="gt-tab-name">{node.name}</span>

      {KIND_MARK[node.kind] && (
        <span className="gt-tab-kind" aria-label={KIND_TITLE[node.kind]}>
          {KIND_MARK[node.kind]}
        </span>
      )}

      {/* A dot rather than a count: the exact number of dirty files is in the
          sidebar, and a tab only needs to say "there is work here". */}
      {dirty > 0 && <span className="gt-tab-dirty" aria-label={`${dirty} uncommitted changes`} />}

      {behind > 0 && (
        <span className="gt-tab-count" aria-label={`${behind} behind`}>
          {behind}↓
        </span>
      )}
      {ahead > 0 && (
        <span className="gt-tab-count" aria-label={`${ahead} ahead`}>
          {ahead}↑
        </span>
      )}

      {closable && (
        <button
          type="button"
          className="gt-tab-close"
          aria-label={`Close ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
