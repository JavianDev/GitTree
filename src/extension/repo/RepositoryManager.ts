import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RepoId, RepoNode, RepoState } from '@shared/model';
import { CommandJournal } from '../git/CommandJournal';
import { GitExecutable, GitExecutableError, type GitFeature } from '../git/GitExecutable';
import type { GitProcess } from '../git/GitProcess';
import { GitScheduler, defaultConcurrency } from '../git/GitScheduler';
import { GitService } from '../git/GitService';
import { WatcherHub } from '../watch/WatcherHub';
import { type DiscoveredRepo, classifyDirectory, discoverRepositories } from './Discovery';
import { RepositoryTree } from './RepositoryTree';
import { displayPath, isPathInside, pathKey, repoId as repoIdOf } from './identity';

/**
 * Owns the repository set and everything scoped to it.
 *
 * Activation is lazy on purpose: discovery may turn up thirty repositories, and
 * creating a service and a state entry for each one up front would spend
 * startup time on repositories the user never opens. A repository becomes
 * "live" the first time something asks for it.
 */
export class RepositoryManager implements vscode.Disposable {
  private executable?: GitExecutable;
  private git?: GitProcess;
  private readonly scheduler: GitScheduler;
  private readonly tree = new RepositoryTree();
  /** Every git command GitTree has run, for the command log. */
  readonly journal = new CommandJournal();
  private readonly services = new Map<RepoId, GitService>();
  private readonly states = new Map<RepoId, RepoState>();
  private readonly watcher: WatcherHub;
  private activeId?: RepoId;
  /** The last scan, kept so an attached worktree can be merged in without rescanning. */
  private discovered: DiscoveredRepo[] = [];
  /**
   * Repositories opened by path — a worktree outside the workspace opened as a
   * tab. Part of the tree, with watchers, for the rest of the session.
   */
  private readonly attached = new Map<string, DiscoveredRepo>();
  /**
   * Worktrees known only through `git worktree list`: a node and a service so
   * their details, diffs, and terminal work, but no tree entry and no watchers.
   */
  private readonly shadows = new Map<RepoId, RepoNode>();

  private readonly repositoriesChanged = new vscode.EventEmitter<void>();
  private readonly repoChanged = new vscode.EventEmitter<RepoId>();
  private readonly stateChanged = new vscode.EventEmitter<RepoState>();

  /** Fires when the repository tree itself changes. */
  readonly onDidChangeRepositories = this.repositoriesChanged.event;
  /** Fires when a repository's on-disk state changed and needs refetching. */
  readonly onDidChangeRepository = this.repoChanged.event;
  /** Fires when a repository's busy/error state changes. */
  readonly onDidChangeState = this.stateChanged.event;

  constructor() {
    const configured = vscode.workspace.getConfiguration('gitTree').get<number>('git.maxConcurrentProcesses') ?? 0;
    this.scheduler = new GitScheduler(configured > 0 ? configured : defaultConcurrency());
    this.watcher = new WatcherHub(this.tree, (repoId) => this.repoChanged.fire(repoId));
  }

  /**
   * Locates git and performs the first scan.
   *
   * A missing or ancient git is reported once, here, rather than as a failure
   * on the first click.
   */
  async initialize(): Promise<void> {
    const configuredPath = vscode.workspace.getConfiguration('gitTree').get<string>('git.path')?.trim();

    try {
      this.executable = await GitExecutable.locate(configuredPath || undefined);
      // Every invocation is journaled, attributed to the repository it ran in.
      // Resolving the repo from `cwd` keeps the attribution accurate without
      // threading a repoId through every call site.
      this.git = this.executable.createProcess((record) => {
        this.journal.record(record, this.owningAny(record.cwd)?.id);
      });
    } catch (error) {
      const message = error instanceof GitExecutableError ? error.message : String(error);
      void vscode.window.showErrorMessage(`GitTree: ${message}`);
      return;
    }

    this.watcher.start();
    await this.rescan();
  }

  /** Rescans every workspace folder (and `discovery.extraPaths`) and rebuilds the tree. */
  async rescan(): Promise<RepoNode[]> {
    const config = vscode.workspace.getConfiguration('gitTree');
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => displayPath(folder.uri.fsPath));
    const extra = extraDiscoveryPaths(config.get<string[]>('discovery.extraPaths') ?? []);

    this.discovered = await discoverRepositories([...folders, ...extra], {
      maxDepth: config.get<number>('discovery.maxDepth') ?? 4,
      excludeDirs: config.get<string[]>('discovery.excludeGlobs') ?? [],
    });

    return this.rebuild();
  }

  /** The tree from the last scan plus every attached repository. */
  private rebuild(): RepoNode[] {
    const merged = new Map<string, DiscoveredRepo>();
    for (const repo of [...this.discovered, ...this.attached.values()]) {
      const key = pathKey(repo.root);
      if (!merged.has(key)) merged.set(key, repo);
    }

    const nodes = this.tree.replace([...merged.values()]);

    // A shadow that is now a real node gives way to it.
    for (const id of [...this.shadows.keys()]) {
      if (this.tree.get(id)) {
        this.shadows.delete(id);
        this.services.delete(id);
      }
    }

    // Drop services and state for repositories that disappeared.
    for (const id of [...this.services.keys()]) {
      if (!this.tree.get(id) && !this.shadows.has(id)) {
        this.scheduler.cancelRepo(id);
        this.services.delete(id);
        this.states.delete(id);
      }
    }

    if (this.activeId && !this.tree.get(this.activeId)) this.activeId = undefined;
    if (!this.activeId) this.activeId = nodes[0]?.id;

    this.watcher.syncRepositories();
    this.repositoriesChanged.fire();
    return nodes;
  }

  /** A repository node: one in the tree, or a worktree known only by path. */
  node(id: RepoId): RepoNode | undefined {
    return this.tree.get(id) ?? this.shadows.get(id);
  }

  /** True when the located git is new enough for a feature (true before git is located). */
  supports(feature: GitFeature): boolean {
    return this.executable?.supports(feature) ?? true;
  }

  /**
   * The node for a worktree folder: the tree's own when it is already there,
   * otherwise a shadow, created on first use. Undefined when the folder is not
   * a git working tree (a missing worktree, for instance).
   */
  async resolveWorktree(fsPath: string): Promise<RepoNode | undefined> {
    const root = displayPath(fsPath);
    const existing = this.findByRoot(root);
    if (existing) return existing;

    const id = repoIdOf(root);
    const shadow = this.shadows.get(id);
    if (shadow) return shadow;

    const classified = await classifyDirectory(root, path.dirname(root), 0);
    if (!classified) return undefined;

    const node: RepoNode = {
      id,
      root: classified.root,
      gitDir: classified.gitDir,
      ...(classified.commonDir ? { commonDir: classified.commonDir } : {}),
      name: path.basename(classified.root) || classified.root,
      kind: classified.kind,
      children: [],
      depth: 0,
      workspaceFolder: classified.workspaceFolder,
      ...(this.isOutsideWorkspace(root) ? { external: true } : {}),
    };
    this.shadows.set(id, node);
    return node;
  }

  /**
   * Adds a worktree folder to the tree — watchers, a tab — and optionally makes
   * it the active repository. A folder already in the tree is just activated.
   */
  async attach(fsPath: string, options: { activate: boolean }): Promise<RepoNode | undefined> {
    const root = displayPath(fsPath);
    const existing = this.findByRoot(root);
    if (existing) {
      if (options.activate) this.setActive(existing.id);
      return existing;
    }

    const classified = await classifyDirectory(root, path.dirname(root), 0);
    if (!classified) return undefined;

    this.attached.set(pathKey(root), { ...classified, ...(this.isOutsideWorkspace(root) ? { external: true } : {}) });
    const id = repoIdOf(root);
    this.shadows.delete(id);
    this.services.delete(id);
    if (options.activate) this.activeId = id;

    this.rebuild();
    return this.tree.get(id);
  }

  /**
   * Lets go of a repository's watchers, queued git work, and service, ahead of
   * removing or moving its folder. On Windows an open handle can make the delete
   * fail; `restoreWatchers` (or the next rebuild) brings them back if it stays.
   */
  release(id: RepoId): void {
    this.scheduler.cancelRepo(id);
    this.watcher.release(id);
    this.services.delete(id);
  }

  /** Re-creates watchers released ahead of an operation that did not go through. */
  restoreWatchers(): void {
    this.watcher.syncRepositories();
  }

  /**
   * Forgets shadows and attached tabs of one repository whose folders git no
   * longer lists — after a remove, move, or prune.
   */
  forgetMissing(commonDir: string, listedRoots: readonly string[]): void {
    const listed = new Set(listedRoots.map((root) => pathKey(root)));
    const sameRepo = (node: { commonDir?: string }) =>
      node.commonDir !== undefined && pathKey(node.commonDir) === pathKey(commonDir);

    for (const [id, node] of [...this.shadows]) {
      if (sameRepo(node) && !listed.has(pathKey(node.root))) {
        this.shadows.delete(id);
        this.release(id);
      }
    }

    let changed = false;
    for (const [key, repo] of [...this.attached]) {
      if (sameRepo(repo) && !listed.has(key)) {
        this.attached.delete(key);
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  private findByRoot(root: string): RepoNode | undefined {
    const key = pathKey(root);
    return this.tree.all().find((node) => pathKey(node.root) === key);
  }

  /** Tree first, then the shadow whose folder contains `cwd`: who ran a journaled command. */
  private owningAny(cwd: string): RepoNode | undefined {
    const owner = this.tree.owning(cwd);
    if (owner) return owner;

    let best: RepoNode | undefined;
    for (const node of this.shadows.values()) {
      if (isPathInside(cwd, node.root) && (!best || node.root.length > best.root.length)) best = node;
    }
    return best;
  }

  private isOutsideWorkspace(root: string): boolean {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    return !folders.some((folder) => isPathInside(root, folder));
  }

  get repositories(): RepositoryTree {
    return this.tree;
  }

  get gitVersion(): string | undefined {
    return this.executable?.version.raw;
  }

  get active(): RepoNode | undefined {
    return this.activeId ? this.tree.get(this.activeId) : undefined;
  }

  setActive(repoId: RepoId): void {
    if (!this.tree.get(repoId) || this.activeId === repoId) return;
    this.activeId = repoId;
    this.repositoriesChanged.fire();
  }

  /**
   * Makes the repository owning a file the active one.
   *
   * Longest-prefix matching means a file inside a nested checkout activates the
   * nested repository, not the outer one containing its path.
   */
  activateForPath(fsPath: string): void {
    const owner = this.tree.owning(displayPath(fsPath));
    if (owner) this.setActive(owner.id);
  }

  /** The service for a repository, created on first use. */
  service(repoId: RepoId): GitService | undefined {
    const existing = this.services.get(repoId);
    if (existing) return existing;

    const node = this.node(repoId);
    if (!node || !this.git) return undefined;

    const service = new GitService(node, this.git, this.scheduler, (feature) => this.supports(feature));
    this.services.set(repoId, service);
    return service;
  }

  /** Reads current branch and change counts, updating cached state. */
  async refreshState(repoId: RepoId): Promise<RepoState | undefined> {
    const service = this.service(repoId);
    if (!service) return undefined;

    this.publishState(repoId, { busy: true, error: undefined });

    try {
      const status = await service.status({ priority: 'visible' });
      const counts = {
        staged: status.files.filter((f) => f.staged).length,
        unstaged: status.files.filter((f) => f.unstaged && f.kind !== 'untracked').length,
        untracked: status.files.filter((f) => f.kind === 'untracked').length,
        conflicted: status.files.filter((f) => f.conflicted).length,
      };

      return this.publishState(repoId, { branch: status.branch, counts, busy: false, error: undefined });
    } catch (error) {
      return this.publishState(repoId, { busy: false, error: describeError(error) });
    }
  }

  state(repoId: RepoId): RepoState | undefined {
    return this.states.get(repoId);
  }

  dispose(): void {
    this.watcher.dispose();
    this.scheduler.dispose();
    this.repositoriesChanged.dispose();
    this.repoChanged.dispose();
    this.stateChanged.dispose();
  }

  private publishState(repoId: RepoId, patch: Partial<RepoState>): RepoState {
    const previous = this.states.get(repoId);
    const next: RepoState = {
      id: repoId,
      branch: patch.branch ?? previous?.branch ?? { detached: false, ahead: 0, behind: 0 },
      counts: patch.counts ?? previous?.counts ?? { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
      busy: patch.busy ?? false,
      ...(patch.error ? { error: patch.error } : {}),
    };

    this.states.set(repoId, next);
    this.stateChanged.fire(next);
    return next;
  }
}

/** `discovery.extraPaths`, with `~` and `${userHome}` expanded. */
export function extraDiscoveryPaths(configured: readonly string[]): string[] {
  const home = homedir();
  return configured
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/\$\{userHome\}/g, home).replace(/^~(?=$|[\\/])/, home))
    .map((entry) => displayPath(entry));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
