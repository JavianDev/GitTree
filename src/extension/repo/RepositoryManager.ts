import * as vscode from 'vscode';
import type { RepoId, RepoNode, RepoState } from '@shared/model';
import { CommandJournal } from '../git/CommandJournal';
import { GitExecutable, GitExecutableError } from '../git/GitExecutable';
import type { GitProcess } from '../git/GitProcess';
import { GitScheduler, defaultConcurrency } from '../git/GitScheduler';
import { GitService } from '../git/GitService';
import { WatcherHub } from '../watch/WatcherHub';
import { discoverRepositories } from './Discovery';
import { RepositoryTree } from './RepositoryTree';
import { displayPath } from './identity';

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
        this.journal.record(record, this.tree.owning(record.cwd)?.id);
      });
    } catch (error) {
      const message = error instanceof GitExecutableError ? error.message : String(error);
      void vscode.window.showErrorMessage(`GitTree: ${message}`);
      return;
    }

    this.watcher.start();
    await this.rescan();
  }

  /** Rescans every workspace folder and rebuilds the tree. */
  async rescan(): Promise<RepoNode[]> {
    const config = vscode.workspace.getConfiguration('gitTree');
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => displayPath(folder.uri.fsPath));

    const discovered = await discoverRepositories(folders, {
      maxDepth: config.get<number>('discovery.maxDepth') ?? 4,
      excludeDirs: config.get<string[]>('discovery.excludeGlobs') ?? [],
    });

    const nodes = this.tree.replace(discovered);

    // Drop services and state for repositories that disappeared.
    for (const id of [...this.services.keys()]) {
      if (!this.tree.get(id)) {
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

    const node = this.tree.get(repoId);
    if (!node || !this.git) return undefined;

    const service = new GitService(node, this.git, this.scheduler);
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
