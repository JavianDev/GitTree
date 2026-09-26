import * as vscode from 'vscode';
import type { RepoId, RepoNode } from '@shared/model';

/**
 * Opens and reuses a VS Code terminal per repository.
 *
 * Deliberately the editor's own integrated terminal rather than one embedded in
 * the webview: a webview terminal needs a PTY, which on Windows means a native
 * module rebuilt for every Electron version — a recurring source of broken
 * installs, in exchange for a window that is already one keystroke away.
 *
 * The terminal opens with `cwd` at the repository root, so a command copied out
 * of the command log behaves identically when pasted in.
 */
export class TerminalBridge implements vscode.Disposable {
  private readonly terminals = new Map<RepoId, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;

  constructor() {
    // A terminal the user closed must not be reused; its process is gone.
    this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      for (const [repoId, terminal] of this.terminals) {
        if (terminal === closed) this.terminals.delete(repoId);
      }
    });
  }

  /** Reveals the repository's terminal, creating it on first use. */
  open(repo: RepoNode): vscode.Terminal {
    const terminal = this.terminalFor(repo);
    terminal.show(true);
    return terminal;
  }

  /**
   * Types a command into the terminal without executing it.
   *
   * The trailing newline is deliberately omitted. The user is meant to read the
   * command, edit it if they like, and run it themselves — running it for them
   * would turn a teaching surface back into a button.
   */
  send(repo: RepoNode, command: string): void {
    const terminal = this.terminalFor(repo);
    terminal.show(true);
    terminal.sendText(command, false);
  }

  dispose(): void {
    this.closeListener.dispose();
    // Terminals are not disposed: the user may still be reading output in them,
    // and VS Code cleans them up with the window.
    this.terminals.clear();
  }

  private terminalFor(repo: RepoNode): vscode.Terminal {
    const existing = this.terminals.get(repo.id);
    if (existing) return existing;

    const terminal = vscode.window.createTerminal({
      name: `GitTree: ${repo.name}`,
      cwd: repo.root,
      iconPath: new vscode.ThemeIcon('git-branch'),
    });

    this.terminals.set(repo.id, terminal);
    return terminal;
  }
}
