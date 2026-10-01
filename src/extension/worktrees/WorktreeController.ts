import { existsSync, promises as fs, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import type {
  CopyReport,
  RepoId,
  RepoNode,
  WorktreeColor,
  WorktreeConfig,
  WorktreeEntry,
  WorktreeList,
  WorktreeOpenTarget,
  WorktreeRepoOverride,
  WorktreeSummary,
} from '@shared/model';
import type { Api, EventName, Events } from '@shared/protocol';
import {
  basename,
  dirname,
  isInsidePath,
  joinPath,
  normalizePath,
  preservedSubfolder,
  suggestWorktreePath,
  uniquePath,
  worktreeTargetOf,
} from '@shared/worktrees';
import { shortBranch } from '../git/parsers/worktree';
import type { GitService } from '../git/GitService';
import { RpcFailure } from '../panel/RpcFailure';
import type { RepositoryManager } from '../repo/RepositoryManager';
import { displayPath, isPathInside, pathKey, repoId as repoIdOf } from '../repo/identity';
import type { TerminalBridge } from '../terminal/TerminalBridge';
import { copyWorktreeFiles } from './copyFiles';
import type { WorktreeSettingsStore } from './WorktreeSettingsStore';

type Handler<M extends keyof Api> = (params: Api[M]['params']) => Promise<Api[M]['result']>;
type Emit = <E extends EventName>(event: E, payload: Events[E]) => void;

/** How long a worktree row's counts are reused before another `git status`. */
const SUMMARY_TTL_MS = 4000;

/** Title-bar colours for a tinted worktree window; white text is legible on each. */
const TINT: Record<WorktreeColor, string> = {
  red: '#cf222e',
  orange: '#bc4c00',
  yellow: '#9a6700',
  green: '#1a7f37',
  teal: '#0e7c86',
  blue: '#1f6feb',
  purple: '#8250df',
  pink: '#bf3989',
};

const platform = (): 'win32' | 'posix' => (process.platform === 'win32' ? 'win32' : 'posix');

/**
 * Everything worktree-shaped the webview asks for.
 *
 * Every request names the repository it is about and, where it acts on one
 * worktree, the worktree's folder. That folder must be one `git worktree list`
 * reports for the repository — checked afresh each time — so the webview can
 * never point git, the terminal, or the file system at an arbitrary directory.
 */
export class WorktreeController {
  private readonly summaries = new Map<string, { at: number; value: WorktreeSummary }>();

  constructor(
    private readonly manager: RepositoryManager,
    private readonly store: WorktreeSettingsStore,
    private readonly terminals: TerminalBridge,
    private readonly context: vscode.ExtensionContext,
    private readonly emit: Emit,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Listing                                                                */
  /* ---------------------------------------------------------------------- */

  async list(repoId: RepoId): Promise<WorktreeList> {
    const node = this.requireNode(repoId);
    const service = this.requireService(repoId);
    const records = await service.worktrees({ priority: 'visible' });
    const commonDir = await this.commonDirOf(node, service);
    const colors = this.store.colors(commonDir);
    const openFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const bare = records[0]?.bare ?? false;

    const worktrees = await Promise.all(
      records.map(async (record, index): Promise<WorktreeEntry> => {
        const root = displayPath(record.path);
        const inTree = this.manager.repositories.all().find((candidate) => pathKey(candidate.root) === pathKey(root));
        const missing = !record.bare && !(await isDirectory(root));
        const branch = shortBranch(record.branchRef);
        const color = colors[pathKey(root)];
        return {
          path: root,
          repoId: inTree?.id ?? repoIdOf(root),
          ...(record.head ? { head: record.head } : {}),
          ...(branch ? { branch } : {}),
          detached: record.detached,
          bare: record.bare,
          isMain: index === 0 && !record.bare,
          isCurrent: pathKey(root) === pathKey(node.root),
          locked: record.locked,
          ...(record.lockReason ? { lockReason: record.lockReason } : {}),
          prunable: record.prunable || missing,
          ...(record.prunableReason ? { prunableReason: record.prunableReason } : {}),
          missing,
          openInWindow: openFolders.some((folder) => isPathInside(folder, root)),
          inTree: inTree !== undefined,
          ...(color ? { color } : {}),
        };
      }),
    );

    const main = worktrees.find((entry) => entry.isMain);
    return { commonDir, ...(main ? { mainPath: main.path } : {}), bare, worktrees };
  }

  /** The listed entry for `worktreePath`, or a refusal: the guard every path-taking call goes through. */
  async requireListed(repoId: RepoId, worktreePath: string): Promise<{ list: WorktreeList; entry: WorktreeEntry }> {
    const list = await this.list(repoId);
    const entry = list.worktrees.find((candidate) => pathKey(candidate.path) === pathKey(worktreePath));
    if (!entry) throw new RpcFailure('invalid', `${worktreePath} is not a worktree of this repository.`);
    return { list, entry };
  }

  async summary(repoId: RepoId, paths: readonly string[], force: boolean): Promise<WorktreeSummary[]> {
    const list = await this.list(repoId);
    const results: WorktreeSummary[] = [];

    await Promise.all(
      paths.map(async (requested) => {
        const entry = list.worktrees.find((candidate) => pathKey(candidate.path) === pathKey(requested));
        if (!entry || entry.bare) return;
        const key = pathKey(entry.path);
        const cached = this.summaries.get(key);
        if (!force && cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
          results.push(cached.value);
          return;
        }
        if (entry.missing) {
          results.push(emptySummary(entry.path, 'The folder is missing.'));
          return;
        }
        try {
          const node = await this.manager.resolveWorktree(entry.path);
          const service = node ? this.manager.service(node.id) : undefined;
          if (!service) throw new Error('Not a git working tree.');
          const value = { ...(await service.summary({ priority: 'background' })), path: entry.path };
          this.summaries.set(key, { at: Date.now(), value });
          results.push(value);
        } catch (error) {
          results.push(emptySummary(entry.path, describe(error)));
        }
      }),
    );

    return results;
  }

  async register(repoId: RepoId, worktreePath: string): Promise<{ repoId: RepoId }> {
    const { entry } = await this.requireListed(repoId, worktreePath);
    const node = await this.manager.resolveWorktree(entry.path);
    if (!node) throw new RpcFailure('not-found', `${entry.path} is not a git working tree. Its folder may be missing.`);
    return { repoId: node.id };
  }

  /* ---------------------------------------------------------------------- */
  /* Opening                                                                */
  /* ---------------------------------------------------------------------- */

  async open(repoId: RepoId, worktreePath: string, target: WorktreeOpenTarget): Promise<void> {
    const { list, entry } = await this.requireListed(repoId, worktreePath);
    if (entry.missing) throw new RpcFailure('invalid', `${entry.path} no longer exists. Prune clears git's record of it.`);
    if (entry.bare) throw new RpcFailure('invalid', 'A bare repository has no files to open.');

    if (target === 'gitTreeTab') {
      const node = await this.manager.attach(entry.path, { activate: true });
      if (!node) throw new RpcFailure('not-found', `${entry.path} is not a git working tree.`);
      void this.manager.refreshState(node.id);
      return;
    }

    const config = this.config(repoId, list);
    let folder = entry.path;
    if (config.effective.preserveSubfolder) {
      const source = this.manager.node(repoId);
      const open = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const relative = source && open ? preservedSubfolder(source.root, displayPath(open), platform()) : undefined;
      if (relative && (await isDirectory(joinPath(entry.path, relative)))) folder = joinPath(entry.path, relative);
    }

    let uri = vscode.Uri.file(folder);
    if (config.effective.titleBarTint === 'workspaceFile' && entry.color) {
      uri = await this.writeTintedWorkspace(entry, folder);
    }

    await vscode.commands.executeCommand('vscode.openFolder', uri, {
      forceNewWindow: target === 'newWindow',
      forceReuseWindow: target === 'currentWindow',
    });
  }

  async reveal(repoId: RepoId, worktreePath: string): Promise<void> {
    const { entry } = await this.requireListed(repoId, worktreePath);
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.missing ? dirname(entry.path) : entry.path));
  }

  async terminal(repoId: RepoId, worktreePath: string): Promise<void> {
    const { entry } = await this.requireListed(repoId, worktreePath);
    const node = await this.manager.resolveWorktree(entry.path);
    if (!node) throw new RpcFailure('not-found', `${entry.path} is not a git working tree.`);
    this.terminals.open(node);
  }

  async copyPath(repoId: RepoId, worktreePath: string): Promise<void> {
    const { entry } = await this.requireListed(repoId, worktreePath);
    await vscode.env.clipboard.writeText(platform() === 'win32' ? entry.path.replace(/\//g, '\\') : entry.path);
  }

  /**
   * The title bar can only be coloured through settings, and writing
   * `.vscode/settings.json` into the worktree would show up as a change there.
   * A generated `.code-workspace` in Git Tree's own storage carries the colour
   * instead, so nothing is written inside the repository.
   */
  private async writeTintedWorkspace(entry: WorktreeEntry, folder: string): Promise<vscode.Uri> {
    const color = TINT[entry.color!];
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'worktree-windows');
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(dir, `${basename(entry.path)}-${entry.repoId}.code-workspace`);
    const content = {
      folders: [{ path: folder }],
      settings: {
        'workbench.colorCustomizations': {
          'titleBar.activeBackground': color,
          'titleBar.activeForeground': '#ffffff',
          'titleBar.inactiveBackground': `${color}cc`,
          'titleBar.inactiveForeground': '#ffffffcc',
        },
      },
    };
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(content, null, 2)));
    return file;
  }

  /* ---------------------------------------------------------------------- */
  /* Creating                                                               */
  /* ---------------------------------------------------------------------- */

  async suggestPath(
    repoId: RepoId,
    name: string,
    location: Partial<WorktreeRepoOverride> | undefined,
  ): Promise<Api['worktrees/suggestPath']['result']> {
    const list = await this.list(repoId);
    const config = this.config(repoId, list);
    const settings = {
      directory: location?.directory ?? config.effective.directory,
      subfolder: location?.subfolder ?? config.effective.subfolder,
      preserveBranchHierarchy: location?.preserveBranchHierarchy ?? config.effective.preserveBranchHierarchy,
    };
    const suggested = suggestWorktreePath(name, settings, config.vars, config.platform);
    if (!suggested.path) return { ...suggested, suffixed: false };

    const registered = new Set(list.worktrees.map((entry) => pathKey(entry.path)));
    const taken = (candidate: string) => registered.has(pathKey(candidate)) || !folderIsEmpty(candidate);
    const unique = uniquePath(suggested.path, taken);
    if (!unique) return { ...suggested, path: undefined, suffixed: false, error: 'Every folder name from here to -99 is taken.' };
    return { ...suggested, path: unique, suffixed: unique !== suggested.path };
  }

  async checkPath(repoId: RepoId, candidate: string): Promise<Api['worktrees/checkPath']['result']> {
    const target = normalizePath(candidate);
    const list = await this.list(repoId);
    const exists = existsSync(target);
    const empty = folderIsEmpty(target);
    const registered = list.worktrees.some((entry) => pathKey(entry.path) === pathKey(target));
    const holder = list.worktrees.find((entry) => !entry.bare && isInsidePath(target, entry.path, platform()));

    let error: string | undefined;
    if (!path.isAbsolute(target)) error = 'Enter a full path.';
    else if (registered) error = 'A worktree is already registered there.';
    else if (exists && !empty) error = 'That folder exists and is not empty.';
    else if (holder && !holder.isMain) error = `That is inside another worktree (${holder.path}).`;

    return {
      exists,
      empty,
      registered,
      ...(holder ? { insideWorktree: holder.path } : {}),
      ...(error ? { error } : {}),
    };
  }

  async copyFiles(repoId: RepoId, params: Api['worktrees/copyFiles']['params']): Promise<CopyReport> {
    const source = this.requireNode(repoId);
    if (params.targetPath) await this.requireListed(repoId, params.targetPath);
    const candidates = await this.requireService(repoId).untrackedEntries({ priority: 'foreground' });
    return copyWorktreeFiles({
      sourceRoot: source.root,
      ...(params.targetPath ? { targetRoot: normalizePath(params.targetPath) } : {}),
      candidates,
      include: params.include,
      exclude: params.exclude,
      dryRun: params.dryRun,
      caseInsensitive: platform() === 'win32',
    });
  }

  /** Adds an in-repository worktree folder to `.git/info/exclude`, so it never shows as untracked. */
  async excludeFolder(repoId: RepoId, folder: string): Promise<void> {
    const normalized = normalizePath(folder).replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) throw new RpcFailure('invalid', 'Not a folder inside the repository.');

    const node = this.requireNode(repoId);
    const commonDir = await this.commonDirOf(node, this.requireService(repoId));
    const file = path.join(commonDir, 'info', 'exclude');
    const line = `/${normalized}/`;

    let content = '';
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      // No exclude file yet: create it.
    }
    if (content.split(/\r?\n/).some((existing) => existing.trim() === line)) return;

    await fs.mkdir(path.dirname(file), { recursive: true });
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    await fs.writeFile(file, `${content}${prefix}# Worktrees created by Git Tree\n${line}\n`, 'utf8');
  }

  /* ---------------------------------------------------------------------- */
  /* Settings                                                               */
  /* ---------------------------------------------------------------------- */

  async configFor(repoId: RepoId): Promise<WorktreeConfig> {
    return this.config(repoId, await this.list(repoId));
  }

  private config(repoId: RepoId, list: WorktreeList): WorktreeConfig {
    const defaults = this.store.defaults();
    const override = this.store.override(list.commonDir);
    const effective = { ...defaults, ...override };

    // Variables resolve against the main worktree, so a worktree created from
    // inside a linked worktree still lands beside the main one.
    const repoRoot = list.mainPath ?? list.commonDir.replace(/\/?\.git$/, '').replace(/\.git$/, '');
    return {
      defaults,
      override,
      effective,
      vars: {
        userHome: displayPath(homedir()),
        repoName: basename(repoRoot),
        repoParent: dirname(repoRoot),
        repoRoot,
      },
      platform: platform(),
      git: {
        version: this.manager.gitVersion ?? '',
        listNul: this.manager.supports('worktreeListZ'),
        removeMove: this.manager.supports('worktreeRemoveMove'),
        repair: this.manager.supports('worktreeRepair'),
      },
    };
    void repoId;
  }

  async setOverride(repoId: RepoId, override: WorktreeRepoOverride | null): Promise<WorktreeConfig> {
    const list = await this.list(repoId);
    await this.store.setOverride(list.commonDir, override);
    this.emit('config/changed', { scopes: ['worktrees'] });
    return this.config(repoId, list);
  }

  async setColor(repoId: RepoId, worktreePath: string, color: WorktreeColor | null): Promise<void> {
    const { list, entry } = await this.requireListed(repoId, worktreePath);
    await this.store.setColor(list.commonDir, entry.path, color);
    this.emit('repos/changed', { nodes: this.decorate(this.manager.repositories.all()), activeId: this.manager.active?.id });
    this.emit('status/changed', { repoId });
  }

  /** Repository nodes with their worktree colour as the tab accent. */
  decorate(nodes: readonly RepoNode[]): RepoNode[] {
    return nodes.map((node) => {
      const accent = this.store.colorOf(node.commonDir, node.root);
      return accent ? { ...node, accent } : node;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Around `commands/run`                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Before a `worktree remove` or `move`: let go of everything holding the
   * folder open — watchers, queued git work, Git Tree's terminal in it — so
   * Windows lets git delete or rename it.
   */
  async beforeCommand(argv: readonly string[]): Promise<void> {
    const target = worktreeTargetOf(argv);
    if (!target || !target.path || (target.verb !== 'remove' && target.verb !== 'move')) return;
    const root = displayPath(path.resolve(target.path));
    const id = this.manager.repositories.all().find((node) => pathKey(node.root) === pathKey(root))?.id ?? repoIdOf(root);
    this.manager.release(id);
    this.terminals.close(id);
  }

  /** After any `worktree …` command: forget folders git no longer lists, and refresh. */
  async afterCommand(repoId: RepoId, argv: readonly string[], ok: boolean): Promise<void> {
    if (argv[0] !== 'worktree') return;
    this.summaries.clear();
    try {
      const list = await this.list(repoId);
      this.manager.forgetMissing(
        list.commonDir,
        list.worktrees.filter((entry) => !entry.missing).map((entry) => entry.path),
      );
    } catch {
      // The listing failing leaves the tree as it was; the next refresh retries.
    }
    if (!ok) this.manager.restoreWatchers();
  }

  /* ---------------------------------------------------------------------- */
  /* Handlers                                                               */
  /* ---------------------------------------------------------------------- */

  handlers(): { [M in keyof Api]?: Handler<M> } {
    return {
      'worktrees/list': async ({ repoId }) => this.list(repoId),
      'worktrees/summary': async ({ repoId, paths, force }) => ({ summaries: await this.summary(repoId, paths, force === true) }),
      'worktrees/register': async ({ repoId, path: worktreePath }) => this.register(repoId, worktreePath),
      'worktrees/open': async ({ repoId, path: worktreePath, target }) => this.open(repoId, worktreePath, target),
      'worktrees/reveal': async ({ repoId, path: worktreePath }) => this.reveal(repoId, worktreePath),
      'worktrees/terminal': async ({ repoId, path: worktreePath }) => this.terminal(repoId, worktreePath),
      'worktrees/copyPath': async ({ repoId, path: worktreePath }) => this.copyPath(repoId, worktreePath),
      'worktrees/suggestPath': async ({ repoId, name, location }) => this.suggestPath(repoId, name, location),
      'worktrees/checkPath': async ({ repoId, path: candidate }) => this.checkPath(repoId, candidate),
      'worktrees/copyFiles': async (params) => this.copyFiles(params.repoId, params),
      'worktrees/config': async ({ repoId }) => this.configFor(repoId),
      'worktrees/setOverride': async ({ repoId, override }) => this.setOverride(repoId, override),
      'worktrees/setColor': async ({ repoId, path: worktreePath, color }) => this.setColor(repoId, worktreePath, color),
      'worktrees/excludeFolder': async ({ repoId, folder }) => this.excludeFolder(repoId, folder),
      'config/update': async ({ key, value }) => {
        try {
          await this.store.updateSetting(key, value);
        } catch (error) {
          throw new RpcFailure('invalid', describe(error));
        }
      },
      'dialog/pickFolder': async ({ title, defaultPath }) => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          ...(title ? { title } : {}),
          ...(defaultPath && existsSync(defaultPath) ? { defaultUri: vscode.Uri.file(defaultPath) } : {}),
        });
        const chosen = picked?.[0];
        return chosen ? { path: displayPath(chosen.fsPath) } : {};
      },
    };
  }

  /* ---------------------------------------------------------------------- */

  private requireNode(repoId: RepoId): RepoNode {
    const node = this.manager.node(repoId);
    if (!node) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
    return node;
  }

  private requireService(repoId: RepoId): GitService {
    const service = this.manager.service(repoId);
    if (!service) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
    return service;
  }

  private async commonDirOf(node: RepoNode, service: GitService): Promise<string> {
    return displayPath(node.commonDir ?? (await service.commonDir({ priority: 'visible' })));
  }
}

function emptySummary(worktreePath: string, error: string): WorktreeSummary {
  return { path: worktreePath, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ahead: 0, behind: 0, error };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function folderIsEmpty(target: string): boolean {
  try {
    return readdirSync(target).length === 0;
  } catch {
    return true;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
