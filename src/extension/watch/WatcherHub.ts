import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RepoId, RepoNode } from '@shared/model';
import type { RepositoryTree } from '../repo/RepositoryTree';
import { gitWatchTargets } from './gitWatchTargets';

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
  /**
   * File watchers for repositories opened from outside every workspace folder
   * — a worktree in a sibling folder. The workspace-wide watcher never sees
   * their files, so each gets its own, for as long as it is open.
   */
  private readonly externalWatchers = new Map<RepoId, vscode.FileSystemWatcher>();
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

    for (const [repoId, watcher] of this.externalWatchers) {
      if (current.has(repoId)) continue;
      watcher.dispose();
      this.externalWatchers.delete(repoId);
    }

    for (const node of this.tree.all()) {
      if (!this.gitWatchers.has(node.id)) this.gitWatchers.set(node.id, this.watchGitDir(node));
      if (node.external && !this.externalWatchers.has(node.id)) this.externalWatchers.set(node.id, this.watchExternal(node));
    }
  }

  /**
   * Closes one repository's handles now, ahead of removing or moving its
   * folder: on Windows an open directory handle can make git's delete fail.
   * The next `syncRepositories` restores them if the repository is still there.
   */
  release(repoId: RepoId): void {
    for (const watcher of this.gitWatchers.get(repoId) ?? []) watcher.close();
    this.gitWatchers.delete(repoId);
    this.externalWatchers.get(repoId)?.dispose();
    this.externalWatchers.delete(repoId);
  }

  dispose(): void {
    this.disposed = true;
    this.workspaceWatcher?.dispose();
    this.workspaceWatcher = undefined;

    for (const watchers of this.gitWatchers.values()) {
      for (const watcher of watchers) watcher.close();
    }
    this.gitWatchers.clear();
    for (const watcher of this.externalWatchers.values()) watcher.dispose();
    this.externalWatchers.clear();

    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }

  private watchGitDir(node: RepoNode): FSWatcher[] {
    const watchers: FSWatcher[] = [];

    for (const target of gitWatchTargets(node)) {
      try {
        // `persistent: false` keeps these handles from holding the host open.
        const watcher = watch(target.path, { persistent: false, recursive: target.recursive }, () => this.schedule(node.id));
        watcher.on('error', () => watcher.close());
        watchers.push(watcher);
      } catch {
        // A missing MERGE_HEAD is the normal case, not an error.
      }
    }

    return watchers;
  }

  private watchExternal(node: RepoNode): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(node.root), '**/*'));
    const route = (uri: vscode.Uri) => {
      const fsPath = uri.fsPath;
      if (fsPath.includes(`${path.sep}.git${path.sep}`) || fsPath.endsWith(`${path.sep}.git`)) return;
      this.schedule(node.id);
    };
    watcher.onDidChange(route);
    watcher.onDidCreate(route);
    watcher.onDidDelete(route);
    return watcher;
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
