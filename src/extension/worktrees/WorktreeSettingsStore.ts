import * as vscode from 'vscode';
import type { WorktreeColor, WorktreeDefaults, WorktreeRepoOverride } from '@shared/model';
import { WORKTREE_COLORS } from '@shared/model';
import { pathKey, repoId } from '../repo/identity';

interface StoredRepo {
  v: 1;
  commonDir: string;
  override?: WorktreeRepoOverride;
  /** Colour label per worktree folder, keyed by `pathKey`. */
  colors?: Record<string, WorktreeColor>;
}

/**
 * Settings the webview may write, and the type each must have. Anything else
 * is refused: the settings sheet is not a general-purpose settings editor.
 */
const WRITABLE: Record<string, 'string' | 'boolean' | 'string[]' | readonly string[]> = {
  'worktrees.directory': 'string',
  'worktrees.subfolder': 'string',
  'worktrees.preserveBranchHierarchy': 'boolean',
  'worktrees.openBehavior': ['gitTreeTab', 'newWindow', 'currentWindow', 'none'],
  'worktrees.preserveSubfolder': 'boolean',
  'worktrees.autoPull': 'boolean',
  'worktrees.autoPush': 'boolean',
  'worktrees.deleteGoneBranchOnRemove': 'boolean',
  'worktrees.copyInclude': 'string[]',
  'worktrees.copyExclude': 'string[]',
  'worktrees.colorLabels': 'boolean',
  'worktrees.titleBarTint': ['off', 'workspaceFile'],
  'discovery.extraPaths': 'string[]',
};

/**
 * Worktree settings at two levels.
 *
 * Defaults for every repository are ordinary VS Code settings
 * (`gitTree.worktrees.*`). What one repository changes — its location, its
 * copy patterns, its colour labels — lives in the extension's global state,
 * keyed by the repository's **common** git directory, so every worktree of a
 * repository (and every VS Code window showing one) sees the same values.
 * Global rather than workspace state for exactly that reason; and not synced,
 * because the paths are machine-specific.
 */
export class WorktreeSettingsStore {
  constructor(private readonly memento: vscode.Memento) {}

  defaults(): WorktreeDefaults {
    const config = vscode.workspace.getConfiguration('gitTree');
    const strings = (key: string) => (config.get<unknown[]>(key) ?? []).filter((value): value is string => typeof value === 'string');
    return {
      directory: config.get<string>('worktrees.directory') ?? '',
      subfolder: config.get<string>('worktrees.subfolder') ?? '',
      preserveBranchHierarchy: config.get<boolean>('worktrees.preserveBranchHierarchy') ?? false,
      openBehavior: config.get<WorktreeDefaults['openBehavior']>('worktrees.openBehavior') ?? 'gitTreeTab',
      preserveSubfolder: config.get<boolean>('worktrees.preserveSubfolder') ?? true,
      autoPull: config.get<boolean>('worktrees.autoPull') ?? false,
      autoPush: config.get<boolean>('worktrees.autoPush') ?? false,
      deleteGoneBranchOnRemove: config.get<boolean>('worktrees.deleteGoneBranchOnRemove') ?? false,
      copyInclude: strings('worktrees.copyInclude'),
      copyExclude: strings('worktrees.copyExclude'),
      colorLabels: config.get<boolean>('worktrees.colorLabels') ?? true,
      titleBarTint: config.get<WorktreeDefaults['titleBarTint']>('worktrees.titleBarTint') ?? 'off',
      extraPaths: strings('discovery.extraPaths'),
    };
  }

  override(commonDir: string): WorktreeRepoOverride {
    return this.read(commonDir)?.override ?? {};
  }

  async setOverride(commonDir: string, override: WorktreeRepoOverride | null): Promise<void> {
    const current = this.read(commonDir) ?? { v: 1, commonDir };
    const cleaned = override ? cleanOverride(override) : undefined;
    const next: StoredRepo = { ...current };
    if (cleaned && Object.keys(cleaned).length > 0) next.override = cleaned;
    else delete next.override;
    await this.write(commonDir, next);
  }

  colors(commonDir: string): Record<string, WorktreeColor> {
    return this.read(commonDir)?.colors ?? {};
  }

  colorOf(commonDir: string | undefined, root: string): WorktreeColor | undefined {
    if (!commonDir) return undefined;
    return this.colors(commonDir)[pathKey(root)];
  }

  async setColor(commonDir: string, root: string, color: WorktreeColor | null): Promise<void> {
    const current = this.read(commonDir) ?? { v: 1, commonDir };
    const colors = { ...(current.colors ?? {}) };
    if (color && WORKTREE_COLORS.includes(color)) colors[pathKey(root)] = color;
    else delete colors[pathKey(root)];
    await this.write(commonDir, { ...current, colors });
  }

  /**
   * Writes one allowlisted VS Code setting where it takes effect: the
   * workspace when the workspace already sets it (writing the user setting
   * would be hidden by it), the user settings otherwise.
   */
  async updateSetting(key: string, value: unknown): Promise<void> {
    const kind = WRITABLE[key];
    if (!kind) throw new Error(`gitTree.${key} cannot be changed from here.`);
    if (!valueFits(kind, value)) throw new Error(`gitTree.${key}: unexpected value.`);

    const config = vscode.workspace.getConfiguration('gitTree');
    const inspected = config.inspect(key);
    const target =
      inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
  }

  private key(commonDir: string): string {
    return `gitTree.worktrees/${repoId(commonDir)}`;
  }

  private read(commonDir: string): StoredRepo | undefined {
    return this.memento.get<StoredRepo>(this.key(commonDir));
  }

  private async write(commonDir: string, value: StoredRepo): Promise<void> {
    await this.memento.update(this.key(commonDir), value);
  }
}

function valueFits(kind: (typeof WRITABLE)[string], value: unknown): boolean {
  if (Array.isArray(kind)) return typeof value === 'string' && kind.includes(value);
  if (kind === 'string') return typeof value === 'string';
  if (kind === 'boolean') return typeof value === 'boolean';
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function cleanOverride(override: WorktreeRepoOverride): WorktreeRepoOverride {
  const out: WorktreeRepoOverride = {};
  if (typeof override.directory === 'string') out.directory = override.directory;
  if (typeof override.subfolder === 'string') out.subfolder = override.subfolder;
  if (typeof override.preserveBranchHierarchy === 'boolean') out.preserveBranchHierarchy = override.preserveBranchHierarchy;
  if (Array.isArray(override.copyInclude)) out.copyInclude = override.copyInclude.filter((p) => typeof p === 'string');
  if (Array.isArray(override.copyExclude)) out.copyExclude = override.copyExclude.filter((p) => typeof p === 'string');
  return out;
}
