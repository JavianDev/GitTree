import { useEffect, useState } from 'react';
import type { CommandContext, CommandId } from '@shared/commands';
import type { RefEntry, WorktreeConfig, WorktreeList, WorktreeLocationSettings, WorktreeRepoOverride } from '@shared/model';
import { suggestWorktreePath } from '@shared/worktrees';
import { RpcRequestError, rpc } from '../../rpc/client';
import { colorVar } from './actions';
import { ChipsEditor } from './ChipsEditor';
import { useWorktreeConfig } from './useWorktrees';
import './worktrees.css';

type Scope = 'repo' | 'all';
type LocationKind = 'sibling' | 'subfolder' | 'custom';

const describe = (error: unknown) => (error instanceof RpcRequestError ? error.displayText : String(error));

function locationKind(location: WorktreeLocationSettings): LocationKind {
  if (location.subfolder.trim()) return 'subfolder';
  if (location.directory.trim()) return 'custom';
  return 'sibling';
}

/**
 * Settings ▸ Worktrees: where this repository's worktrees go, what happens when
 * one is created, opened, or removed, and the worktrees it has now.
 *
 * Two scopes, chosen at the top. "This repository" is stored by Git Tree for
 * the repository and every worktree of it; "All repositories" writes the
 * `gitTree.worktrees.*` VS Code settings, which every repository falls back on.
 */
export function WorktreeSettings({
  repoId,
  onRunCommand,
  onCreate,
}: {
  repoId: string;
  onRunCommand: (id: CommandId, context?: Partial<CommandContext>) => void;
  onCreate: () => void;
}): React.JSX.Element {
  const { config, setConfig } = useWorktreeConfig(repoId);
  const [list, setList] = useState<WorktreeList | undefined>();
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [scope, setScope] = useState<Scope>('repo');
  const [draft, setDraft] = useState<WorktreeLocationSettings | undefined>();
  const [kind, setKind] = useState<LocationKind>('sibling');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([rpc.request('worktrees/list', { repoId }), rpc.request('refs/list', { repoId })])
      .then(([nextList, nextRefs]) => {
        if (cancelled) return;
        setList(nextList);
        setRefs(nextRefs.refs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  // The location fields show the chosen scope's values.
  useEffect(() => {
    if (!config) return;
    const source = scope === 'repo' ? config.effective : config.defaults;
    const location = { directory: source.directory, subfolder: source.subfolder, preserveBranchHierarchy: source.preserveBranchHierarchy };
    setDraft(location);
    setKind(locationKind(location));
  }, [config, scope]);

  if (!config || !draft) {
    return (
      <section className="gt-settings-section">
        <h3 className="gt-settings-heading">Worktrees</h3>
        <p className="gt-settings-note">Reading this repository’s worktrees…</p>
      </section>
    );
  }

  const repoHasOverride = Object.keys(config.override).length > 0;
  const location: WorktreeLocationSettings = {
    directory: kind === 'custom' ? draft.directory : '',
    subfolder: kind === 'subfolder' ? draft.subfolder || '.worktrees' : '',
    preserveBranchHierarchy: draft.preserveBranchHierarchy,
  };
  const preview = suggestWorktreePath('feature/login', location, config.vars, config.platform);
  const source = scope === 'repo' ? config.effective : config.defaults;
  const locationChanged =
    location.directory !== source.directory ||
    location.subfolder !== source.subfolder ||
    location.preserveBranchHierarchy !== source.preserveBranchHierarchy;

  const write = (work: Promise<unknown>) => {
    setError(undefined);
    work
      .then(() => rpc.request('worktrees/config', { repoId }))
      .then(setConfig)
      .catch((reason: unknown) => setError(describe(reason)));
  };

  /** One setting, at the chosen scope where the setting is per-repository, else for all. */
  const setRepoOrAll = (patch: WorktreeRepoOverride) => {
    if (scope === 'repo') {
      write(rpc.request('worktrees/setOverride', { repoId, override: { ...config.override, ...patch } }));
    } else {
      write(
        Promise.all(
          Object.entries(patch).map(([key, value]) => rpc.request('config/update', { key: `worktrees.${key}`, value })),
        ),
      );
    }
  };

  const setGlobal = (key: string, value: unknown) => write(rpc.request('config/update', { key, value }));

  const saveLocation = () => {
    setRepoOrAll({ directory: location.directory, subfolder: location.subfolder, preserveBranchHierarchy: location.preserveBranchHierarchy });
    if (scope === 'repo' && location.subfolder) {
      void rpc.request('worktrees/excludeFolder', { repoId, folder: location.subfolder }).catch(() => undefined);
    }
  };

  const browse = async (): Promise<string | undefined> => {
    const result = await rpc.request('dialog/pickFolder', { title: 'Folder for worktrees', defaultPath: config.vars.repoParent });
    return result.path;
  };

  const heldBranches = new Set((list?.worktrees ?? []).map((entry) => entry.branch).filter(Boolean));
  const gone = refs.filter((ref) => ref.kind === 'localBranch' && ref.gone && !ref.isHead && !heldBranches.has(ref.name)).map((ref) => ref.name);
  const effective = config.effective;

  return (
    <section className="gt-settings-section gt-wt-settings">
      <div className="gt-wt-settings-head">
        <h3 className="gt-settings-heading">Worktrees</h3>
        <div className="gt-segmented" role="tablist" aria-label="Apply settings to">
          <button type="button" role="tab" className="gt-segment" aria-selected={scope === 'repo'} onClick={() => setScope('repo')}>
            This repository
          </button>
          <button type="button" role="tab" className="gt-segment" aria-selected={scope === 'all'} onClick={() => setScope('all')}>
            All repositories
          </button>
        </div>
      </div>

      {error && (
        <div className="gt-settings-error" role="alert">
          <pre>{error}</pre>
        </div>
      )}

      <h4 className="gt-wt-settings-sub">Location</h4>
      <div className="gt-wt-radios gt-wt-radios-column" role="radiogroup" aria-label="Where new worktrees go">
        <label className="gt-checkbox">
          <input type="radio" name="gt-wt-location" checked={kind === 'sibling'} onChange={() => setKind('sibling')} />
          Next to the repository <span className="gt-mono gt-wt-dim">{config.vars.repoParent}/{config.vars.repoName}.worktrees/…</span> (default)
        </label>
        <label className="gt-checkbox">
          <input type="radio" name="gt-wt-location" checked={kind === 'subfolder'} onChange={() => setKind('subfolder')} />
          In a folder inside it
          <input
            type="text"
            className="gt-text-input gt-wt-inline-input"
            value={draft.subfolder || '.worktrees'}
            disabled={kind !== 'subfolder'}
            onChange={(event) => setDraft({ ...draft, subfolder: event.target.value })}
          />
          <span className="gt-wt-dim">(added to .git/info/exclude)</span>
        </label>
        <label className="gt-checkbox">
          <input type="radio" name="gt-wt-location" checked={kind === 'custom'} onChange={() => setKind('custom')} />
          A folder of your choice
        </label>
        {kind === 'custom' && (
          <div className="gt-wt-row-inline">
            <input
              type="text"
              className="gt-text-input gt-mono"
              placeholder="${userHome}/worktrees/${repoName}"
              value={draft.directory}
              onChange={(event) => setDraft({ ...draft, directory: event.target.value })}
            />
            <button
              type="button"
              className="gt-button"
              data-size="small"
              onClick={() => {
                void browse().then((picked) => {
                  if (picked) setDraft({ ...draft, directory: picked });
                });
              }}
            >
              Browse…
            </button>
          </div>
        )}
        <label className="gt-checkbox">
          <input type="checkbox" checked={draft.preserveBranchHierarchy} onChange={(event) => setDraft({ ...draft, preserveBranchHierarchy: event.target.checked })} />
          Keep branch folders <span className="gt-wt-dim">(feature/login → feature/login; off: feature-login)</span>
        </label>
      </div>
      <p className="gt-wt-preview">
        <span className="gt-wt-dim">Preview</span> feature/login → <span className="gt-mono">{preview.path ?? preview.error}</span>
      </p>
      {preview.warnings.map((warning) => (
        <p key={warning} className="gt-wt-hint" data-tone="warning">
          {warning}
        </p>
      ))}
      <div className="gt-wt-row-inline">
        <button type="button" className="gt-button" data-variant="primary" data-size="small" disabled={!locationChanged || Boolean(preview.error)} onClick={saveLocation}>
          Save location
        </button>
        {scope === 'repo' && repoHasOverride && (
          <button type="button" className="gt-button" data-size="small" onClick={() => write(rpc.request('worktrees/setOverride', { repoId, override: null }))}>
            Use the default for this repository
          </button>
        )}
        <span className="gt-wt-dim">
          {scope === 'repo'
            ? repoHasOverride
              ? 'This repository has its own settings.'
              : 'This repository uses the default.'
            : 'Saved to your VS Code settings (gitTree.worktrees.*).'}
        </span>
      </div>

      <h4 className="gt-wt-settings-sub">
        This repository’s worktrees ({list?.worktrees.length ?? 0})
        <span className="gt-review-spacer" />
        <button type="button" className="gt-button" data-size="small" onClick={onCreate}>
          + New worktree
        </button>
        <button type="button" className="gt-button" data-size="small" onClick={() => onRunCommand('worktree.prune', { verbose: true })}>
          Prune…
        </button>
      </h4>
      <ul className="gt-wt-settings-list">
        {(list?.worktrees ?? []).map((entry) => (
          <li key={entry.path}>
            <span className="gt-wt-dot" style={entry.color ? { background: colorVar(entry.color) } : undefined} aria-hidden="true" />
            <span className="gt-wt-settings-branch">{entry.branch ?? (entry.bare ? 'bare' : 'detached')}</span>
            <span className="gt-mono gt-wt-settings-path" title={entry.path}>
              {entry.path}
            </span>
            {entry.isMain && <span className="gt-kind-badge gt-wt-badge" data-kind="main">main</span>}
            {entry.isCurrent && <span className="gt-kind-badge gt-wt-badge" data-kind="current">current</span>}
            {entry.locked && <span className="gt-kind-badge gt-wt-badge" data-kind="locked">locked</span>}
            {entry.missing && <span className="gt-kind-badge gt-wt-badge" data-kind="missing">missing</span>}
            <button type="button" className="gt-button" data-size="small" onClick={() => void rpc.request('worktrees/reveal', { repoId, path: entry.path }).catch(() => undefined)}>
              Reveal
            </button>
          </li>
        ))}
      </ul>

      <h4 className="gt-wt-settings-sub">When creating</h4>
      <div className="gt-wt-radios">
        <label className="gt-wt-field-inline">
          Open in
          <select className="gt-settings-select" value={effective.openBehavior} onChange={(event) => setGlobal('worktrees.openBehavior', event.target.value)}>
            <option value="gitTreeTab">a Git Tree tab</option>
            <option value="newWindow">a new VS Code window</option>
            <option value="currentWindow">this VS Code window</option>
            <option value="none">don’t open</option>
          </select>
        </label>
        <label className="gt-checkbox">
          <input type="checkbox" checked={effective.autoPull} onChange={(event) => setGlobal('worktrees.autoPull', event.target.checked)} />
          Pull (fast-forward only)
        </label>
        <label className="gt-checkbox">
          <input type="checkbox" checked={effective.autoPush} onChange={(event) => setGlobal('worktrees.autoPush', event.target.checked)} />
          Push a new branch
        </label>
      </div>
      <div className="gt-wt-field">
        <span className="gt-wt-label">Copy these untracked files into new worktrees{scope === 'repo' ? ' (this repository)' : ''}</span>
        <ChipsEditor
          values={scope === 'repo' ? effective.copyInclude : config.defaults.copyInclude}
          onChange={(next) => setRepoOrAll({ copyInclude: next })}
          placeholder=".env, .env.*, .venv"
          label="Copy include patterns"
        />
        <span className="gt-wt-label">Except</span>
        <ChipsEditor
          values={scope === 'repo' ? effective.copyExclude : config.defaults.copyExclude}
          onChange={(next) => setRepoOrAll({ copyExclude: next })}
          placeholder="**/node_modules"
          label="Copy exclude patterns"
        />
      </div>

      <h4 className="gt-wt-settings-sub">When opening in a window</h4>
      <div className="gt-wt-radios">
        <label className="gt-checkbox">
          <input type="checkbox" checked={effective.preserveSubfolder} onChange={(event) => setGlobal('worktrees.preserveSubfolder', event.target.checked)} />
          Open the same sub-folder
        </label>
        <label className="gt-checkbox">
          <input type="checkbox" checked={effective.colorLabels} onChange={(event) => setGlobal('worktrees.colorLabels', event.target.checked)} />
          Colour labels
        </label>
        <label className="gt-wt-field-inline">
          Title bar tint
          <select className="gt-settings-select" value={effective.titleBarTint} onChange={(event) => setGlobal('worktrees.titleBarTint', event.target.value)}>
            <option value="off">Off</option>
            <option value="workspaceFile">From the colour label</option>
          </select>
        </label>
      </div>

      <h4 className="gt-wt-settings-sub">When removing</h4>
      <div className="gt-wt-radios">
        <label className="gt-checkbox">
          <input
            type="checkbox"
            checked={effective.deleteGoneBranchOnRemove}
            onChange={(event) => setGlobal('worktrees.deleteGoneBranchOnRemove', event.target.checked)}
          />
          Also delete the branch when its remote branch is gone
        </label>
        <button
          type="button"
          className="gt-button"
          data-size="small"
          disabled={gone.length === 0}
          title={gone.length === 0 ? 'No local branch tracks a deleted remote branch.' : gone.join(', ')}
          onClick={() => onRunCommand('branch.deleteGone', { branches: gone })}
        >
          Clean up gone branches{gone.length > 0 ? ` (${gone.length})` : ''}…
        </button>
      </div>

      <h4 className="gt-wt-settings-sub">Discovery</h4>
      <div className="gt-wt-field">
        <span className="gt-wt-label">Extra folders to scan for repositories and worktrees</span>
        <ChipsEditor
          values={config.defaults.extraPaths}
          onChange={(next) => setGlobal('discovery.extraPaths', next)}
          placeholder="~/worktrees"
          label="Extra folders"
          onBrowse={browse}
        />
      </div>
    </section>
  );
}

export type { WorktreeConfig };
