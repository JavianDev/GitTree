import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RepoId } from '@shared/model';
import type { RepositoryTree } from '../repo/RepositoryTree';

/** Files inside `.git` whose change means repository state moved. */
const GIT_FILES = ['HEAD', 'index', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD'];

const DEBOUNCE_MS = 150;

/** An open coalescing window for one repository. */
interface RefreshWindow {
  timer: NodeJS.Timeout;
  /** A change arrived while the window was open and still owes a notification. */
  pending: boolean;
}

/**
 * Change notification for every repository in the workspace.
 *
 * The naive design — one recursive watcher per repository — does not survive a
 * workspace with twenty checkouts: recursive watchers are a limited OS
 * resource, and twenty of them over overlapping trees means every edit fires
 * repeatedly. Instead:
 *
 *  - **One** workspace-wide watcher covers worktree edits, and each event is
 *    routed to its owning repository by longest-prefix match. That is also what
 *    attributes a file in a nested checkout to the nested repo rather than the
 *    outer one.
 *  - A handful of **non-recursive** node watchers per loaded repository cover
 *    `.git/HEAD`, `.git/refs`, and the merge-state files, which is where
 *    branch switches and commits show up. Roughly four handles per repo.
 *
 * Events are coalesced per repository on the leading edge, so a checkout
 * touching a thousand files costs about two notifications while a single save
 * costs no delay at all.
 */
export class WatcherHub implements vscode.Disposable {
  private workspaceWatcher?: vscode.FileSystemWatcher;
  private readonly gitWatchers = new Map<RepoId, FSWatcher[]>();
  private readonly windows = new Map<RepoId, RefreshWindow>();
  private disposed = false;

  constructor(
    private readonly tree: RepositoryTree,
    private readonly onRepoChanged: (repoId: RepoId) => void,
  ) {}

  /** Starts the workspace watcher. Call once. */
  start(): void {
    if (this.workspaceWatcher || this.disposed) return;

    this.workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    const route = (uri: vscode.Uri) => this.routeWorktreeChange(uri);

    this.workspaceWatcher.onDidChange(route);
    this.workspaceWatcher.onDidCreate(route);
    this.workspaceWatcher.onDidDelete(route);
  }

  /**
   * Rebuilds the per-repository `.git` watchers to match the current tree.
   * Call after discovery, or when a repository is activated.
   */
  syncRepositories(): void {
    if (this.disposed) return;

    const current = new Set(this.tree.all().map((node) => node.id));

    for (const [repoId, watchers] of this.gitWatchers) {
      if (current.has(repoId)) continue;
      for (const watcher of watchers) watcher.close();
      this.gitWatchers.delete(repoId);
    }

    for (const node of this.tree.all()) {
      if (this.gitWatchers.has(node.id)) continue;
      this.gitWatchers.set(node.id, this.watchGitDir(node.id, node.gitDir));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.workspaceWatcher?.dispose();
    this.workspaceWatcher = undefined;

    for (const watchers of this.gitWatchers.values()) {
      for (const watcher of watchers) watcher.close();
    }
    this.gitWatchers.clear();

    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }

  private watchGitDir(repoId: RepoId, gitDir: string): FSWatcher[] {
    const watchers: FSWatcher[] = [];

    const add = (target: string, options?: { recursive?: boolean }) => {
      try {
        // `persistent: false` keeps these handles from holding the host open.
        const watcher = watch(target, { persistent: false, ...options }, () => this.schedule(repoId));
        watcher.on('error', () => watcher.close());
        watchers.push(watcher);
      } catch {
        // A missing MERGE_HEAD is the normal case, not an error.
      }
    };

    for (const file of GIT_FILES) add(path.join(gitDir, file));
    // refs/ is small and shallow; recursive here costs one handle, not a tree.
    add(path.join(gitDir, 'refs'), { recursive: true });

    return watchers;
  }

  private routeWorktreeChange(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;

    const fsPath = uri.fsPath;
    // `.git` internals are covered by the dedicated watchers above; routing
    // them here as well would double every event.
    if (fsPath.includes(`${path.sep}.git${path.sep}`) || fsPath.endsWith(`${path.sep}.git`)) return;

    const owner = this.tree.owning(fsPath);
    if (owner) this.schedule(owner.id);
  }

  /**
   * Coalesces a burst into one notification per window, leading edge first.
   *
   * A trailing-only timer made every change wait out the window, including the
   * single file save that is the overwhelmingly common case and that has
   * nothing to coalesce with. So the first change is delivered immediately and
   * opens a window instead; everything arriving inside it is folded into one
   * trailing notification when it closes. A checkout touching a thousand files
   * therefore costs about two notifications rather than a thousand, and a burst
   * that outlasts the window is capped at one per window rather than
   * accelerating as it goes.
   */
  private schedule(repoId: RepoId): void {
    if (this.disposed) return;

    const open = this.windows.get(repoId);
    if (open) {
      open.pending = true;
      return;
    }

    this.notify(repoId);
  }

  /** Fires the callback and opens the window that suppresses its followers. */
  private notify(repoId: RepoId): void {
    // Registered before the callback runs, so a change the callback itself
    // provokes lands in the window rather than starting a second one.
    this.windows.set(repoId, {
      timer: setTimeout(() => this.closeWindow(repoId), DEBOUNCE_MS),
      pending: false,
    });

    this.onRepoChanged(repoId);
  }

  private closeWindow(repoId: RepoId): void {
    const open = this.windows.get(repoId);
    this.windows.delete(repoId);

    if (this.disposed || !open?.pending) return;
    this.notify(repoId);
  }
}
