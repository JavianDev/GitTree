import type { RepoId, RepoKind, RepoNode, RepoState } from '@shared/model';
import type { RepositoriesModel } from '../../app/useRepositories';

/**
 * Short marker per repository kind.
 *
 * Worth the pixels: a submodule, a nested checkout, and a linked worktree
 * behave differently enough that mistaking one for another loses work, and the
 * folder name alone never says which is which.
 */
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

export function RepoSidebar({ model }: { model: RepositoriesModel }): React.JSX.Element {
  return (
    <nav className="gt-sidebar" aria-label="Repositories">
      <div className="gt-section-header" id="gt-repos-header">
        Repositories
      </div>

      {model.nodes.length === 0 ? (
        <p className="gt-source-row" style={{ color: 'var(--gt-label-tertiary)' }}>
          None found
        </p>
      ) : (
        <ul className="gt-source-list" role="tree" aria-labelledby="gt-repos-header">
          {model.roots.map((node) => (
            <RepoBranch key={node.id} node={node} model={model} depth={0} />
          ))}
        </ul>
      )}
    </nav>
  );
}

function RepoBranch({
  node,
  model,
  depth,
}: {
  node: RepoNode;
  model: RepositoriesModel;
  depth: number;
}): React.JSX.Element {
  const children = model.childrenOf(node.id);
  const selected = model.activeId === node.id;
  const state = model.states.get(node.id);

  return (
    <li role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={selected}
        aria-level={depth + 1}
        aria-expanded={children.length > 0 ? true : undefined}
        className="gt-source-row"
        style={{ paddingLeft: `calc(var(--gt-space-3) + ${depth * 14}px)` }}
        title={`${node.root}\n${KIND_TITLE[node.kind]}`}
        onClick={() => model.activate(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            model.activate(node.id);
          }
        }}
      >
        <span className="gt-disclosure" aria-hidden="true">
          {children.length > 0 ? '▾' : ''}
        </span>
        <span className="gt-source-name">{node.name}</span>
        {KIND_MARK[node.kind] && (
          <span className="gt-kind-badge" aria-label={KIND_TITLE[node.kind]}>
            {KIND_MARK[node.kind]}
          </span>
        )}
        <span className="gt-source-meta">{summarize(state)}</span>
      </div>

      {children.length > 0 && (
        <ul className="gt-source-list" role="group">
          {children.map((child) => (
            <RepoBranch key={child.id} node={child} model={model} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Divergence and pending-change counts, in the least space that stays legible. */
function summarize(state: RepoState | undefined): string {
  if (!state) return '';

  const parts: string[] = [];
  if (state.branch.ahead > 0) parts.push(`↑${state.branch.ahead}`);
  if (state.branch.behind > 0) parts.push(`↓${state.branch.behind}`);

  const pending = state.counts.staged + state.counts.unstaged + state.counts.untracked;
  if (pending > 0) parts.push(String(pending));
  if (state.counts.conflicted > 0) parts.push('!');

  return parts.join(' ');
}

export type { RepoId };
