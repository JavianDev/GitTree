import * as vscode from 'vscode';
import type { RepoId, RepoNode } from '@shared/model';
import { GitTreePanel } from './panel/GitTreePanel';
import { RepositoryManager } from './repo/RepositoryManager';
import { RepositoryTreeProvider } from './views/RepositoryTreeProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const manager = new RepositoryManager();
  context.subscriptions.push(manager);

  const provider = new RepositoryTreeProvider(manager);
  const treeView = vscode.window.createTreeView('gittree.repositories', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('gitTree.open', () => GitTreePanel.show(context, manager)),

    vscode.commands.registerCommand('gitTree.refresh', async () => {
      const active = manager.active;
      if (active) await manager.refreshState(active.id);
      provider.refresh();
    }),

    vscode.commands.registerCommand('gitTree.rescan', async () => {
      await manager.rescan();
      await refreshVisibleStates(manager);
    }),

    vscode.commands.registerCommand('gitTree.revealRepository', async (node?: RepoNode) => {
      if (node) manager.setActive(node.id);
      GitTreePanel.show(context, manager);
      if (node) await manager.refreshState(node.id);
    }),
  );

  // A watcher fired: refresh the status counts shown in the sidebar. Gated on
  // `autoRefresh` like every other automatic path — a setting that silenced the
  // editor events but left the watcher refreshing would not be "off".
  context.subscriptions.push(
    manager.onDidChangeRepository((repoId) => {
      if (!autoRefreshEnabled()) return;
      void manager.refreshState(repoId);
    }),
  );

  /** Refreshes each repository owning one of these files, at most once. */
  const refreshOwners = (uris: readonly vscode.Uri[]): void => {
    if (!autoRefreshEnabled()) return;

    const seen = new Set<RepoId>();
    for (const uri of uris) {
      if (uri.scheme !== 'file') continue;

      const owner = manager.repositories.owning(uri.fsPath);
      // Deduplicated per repository: renaming forty files inside one checkout
      // is still one status read.
      if (!owner || seen.has(owner.id)) continue;
      seen.add(owner.id);
      void manager.refreshState(owner.id);
    }
  };

  // The editor knows about a save or an explorer file operation before the
  // filesystem watcher is told, so these are what make an edit appear without a
  // perceptible pause. The watcher stays as the backstop for everything changed
  // outside VS Code, and will report the same save a moment later: that costs
  // one redundant status read, which is a fair price for the instant path and
  // is bounded by the watcher's own coalescing window rather than multiplied by
  // the number of files touched.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => refreshOwners([document.uri])),
    vscode.workspace.onDidCreateFiles((event) => refreshOwners(event.files)),
    vscode.workspace.onDidDeleteFiles((event) => refreshOwners(event.files)),
    // Both ends of a rename, because it can move a file between repositories.
    vscode.workspace.onDidRenameFiles((event) =>
      refreshOwners(event.files.flatMap((file) => [file.oldUri, file.newUri])),
    ),
  );

  // Follow the active editor so the repository in focus matches the file in
  // focus — including when that file lives in a nested checkout.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.uri.scheme !== 'file') return;
      if (!vscode.workspace.getConfiguration('gitTree').get<boolean>('followActiveEditor', true)) return;
      manager.activateForPath(editor.document.uri.fsPath);
    }),
  );

  // Workspace folders changing is a structural change; rescan rather than
  // patching the tree, since folders can be added, removed, and reordered.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await manager.rescan();
      await refreshVisibleStates(manager);
    }),
  );

  await manager.initialize();
  await refreshVisibleStates(manager);

  const count = manager.repositories.size;
  treeView.message = count === 0 ? 'No Git repositories found in this workspace.' : undefined;
}

export function deactivate(): void {
  // Everything is registered in context.subscriptions and disposed by the host.
}

/**
 * Read per event rather than cached, so turning auto-refresh off takes effect
 * on the next save instead of on the next window reload.
 */
function autoRefreshEnabled(): boolean {
  return vscode.workspace.getConfiguration('gitTree').get<boolean>('autoRefresh', true);
}

/**
 * Loads status for the repositories worth showing immediately.
 *
 * Bounded on purpose: in a workspace with thirty checkouts, reading status for
 * every one at startup would spend the first seconds of the session on
 * repositories the user has not looked at. The rest load when expanded.
 */
async function refreshVisibleStates(manager: RepositoryManager, limit = 12): Promise<void> {
  const targets = manager.repositories.all().slice(0, limit);
  await Promise.all(targets.map((node) => manager.refreshState(node.id)));
}
