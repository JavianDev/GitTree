import * as vscode from 'vscode';
import type { RepoKind, RepoNode, RepoState } from '@shared/model';
import type { RepositoryManager } from '../repo/RepositoryManager';

/** Codicon per repository kind, so the four kinds are distinguishable at a glance. */
const ICONS: Record<RepoKind, string> = {
  root: 'repo',
  nested: 'repo-forked',
  submodule: 'file-submodule',
  worktree: 'git-branch',
};

const KIND_LABELS: Record<RepoKind, string> = {
  root: 'Repository',
  nested: 'Nested repository',
  submodule: 'Submodule',
  worktree: 'Linked worktree',
};

/**
 * The repository hierarchy in the activity bar.
 *
 * Renders the containment tree rather than a flat list, so a workspace holding
 * a parent folder of checkouts — each with its own submodules, nested repos and
 * worktrees — reads as the structure it actually is.
 */
export class RepositoryTreeProvider implements vscode.TreeDataProvider<RepoNode> {
  private readonly changed = new vscode.EventEmitter<RepoNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly manager: RepositoryManager) {
    manager.onDidChangeRepositories(() => this.changed.fire(undefined));
    manager.onDidChangeState(() => this.changed.fire(undefined));
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: RepoNode): vscode.TreeItem {
    const children = this.manager.repositories.childrenOf(node.id);
    const item = new vscode.TreeItem(
      node.name,
      children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    const state = this.manager.state(node.id);
    const isActive = this.manager.active?.id === node.id;

    item.id = node.id;
    item.contextValue = `repo:${node.kind}`;
    item.resourceUri = vscode.Uri.file(node.root);
    item.description = describe(state);
    item.tooltip = tooltip(node, state);

    // The active repository is tinted; the rest stay in the theme foreground.
    item.iconPath = new vscode.ThemeIcon(
      ICONS[node.kind],
      isActive ? new vscode.ThemeColor('charts.yellow') : undefined,
    );

    item.command = {
      command: 'gitTree.revealRepository',
      title: 'Open in GitTree',
      arguments: [node],
    };

    return item;
  }

  getChildren(node?: RepoNode): RepoNode[] {
    return node ? this.manager.repositories.childrenOf(node.id) : this.manager.repositories.roots();
  }

  getParent(node: RepoNode): RepoNode | undefined {
    return node.parentId ? this.manager.repositories.get(node.parentId) : undefined;
  }
}

/** Compact status line: branch, divergence, and pending changes. */
function describe(state: RepoState | undefined): string {
  if (!state) return '';

  const parts: string[] = [];
  const branch = state.branch;

  if (branch.detached) parts.push('detached');
  else if (branch.head) parts.push(branch.head);

  if (branch.ahead > 0) parts.push(`↑${branch.ahead}`);
  if (branch.behind > 0) parts.push(`↓${branch.behind}`);

  const pending = state.counts.staged + state.counts.unstaged + state.counts.untracked;
  if (pending > 0) parts.push(`${pending}∆`);
  if (state.counts.conflicted > 0) parts.push(`${state.counts.conflicted}!`);
  if (state.error) parts.push('error');

  return parts.join(' ');
}

function tooltip(node: RepoNode, state: RepoState | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${node.name}** — ${KIND_LABELS[node.kind]}\n\n`);
  md.appendMarkdown(`\`${node.root}\`\n\n`);

  if (node.kind === 'nested') {
    // Worth stating outright: this is the case that silently commits an empty
    // gitlink if treated like ordinary content.
    md.appendMarkdown('_A separate repository inside another checkout. Its parent sees it only as an untracked directory._\n\n');
  }

  if (state?.error) md.appendMarkdown(`\n**Error:** ${state.error}\n`);
  else if (state) {
    md.appendMarkdown(
      `Staged ${state.counts.staged} · Modified ${state.counts.unstaged} · ` +
        `Untracked ${state.counts.untracked} · Conflicts ${state.counts.conflicted}`,
    );
  }

  return md;
}
