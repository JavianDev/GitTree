import { randomBytes } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RepoId, StatusResult } from '@shared/model';
import type {
  Api,
  EventName,
  Events,
  HostMessage,
  Method,
  RpcError,
  WebviewMessage,
} from '@shared/protocol';
import { CancelledError, GitError } from '../git/GitProcess';
import { remoteAddArgs, remoteRemoveArgs, remoteSetUrlArgs } from '../git/parsers/remote';
import { PullRequestService } from '../pullRequests/PullRequestService';
import { suggestCommitMessage } from '../commitMessage/suggest';
import type { PullRequestProvider } from '../pullRequests/PullRequestProvider';
import { AzureDevOpsProvider } from '../pullRequests/providers/AzureDevOpsProvider';
import { BitbucketProvider } from '../pullRequests/providers/BitbucketProvider';
import { GitHubProvider } from '../pullRequests/providers/GitHubProvider';
import { GitLabProvider } from '../pullRequests/providers/GitLabProvider';
import type { RepositoryManager } from '../repo/RepositoryManager';
import { displayPath, relativeTo } from '../repo/identity';
import { TerminalBridge } from '../terminal/TerminalBridge';
import { WorktreeController } from '../worktrees/WorktreeController';
import { WorktreeSettingsStore } from '../worktrees/WorktreeSettingsStore';
import { RpcFailure } from './RpcFailure';

/** Handler signature for one RPC method. */
type Handler<M extends Method> = (params: Api[M]['params']) => Promise<Api[M]['result']>;

/**
 * Hosts the GitTree webview and brokers every request it makes.
 *
 * The webview is sandboxed and has no Node access: it sends intent, and this
 * class decides which argv that becomes. No string from the webview is ever
 * concatenated into a command line, and every repository-scoped request names
 * its repository explicitly rather than relying on a shared "current" value.
 */
export class GitTreePanel {
  private static current?: GitTreePanel;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly logStreams = new Map<string, AbortController>();
  private readonly terminals = new TerminalBridge();
  private readonly prServices = new Map<RepoId, PullRequestService>();
  private readonly prProviders: PullRequestProvider[];
  private readonly worktrees: WorktreeController;
  private disposed = false;
  /** The webview has said it is listening. */
  private ready = false;
  /** UI requests made before the webview was ready, delivered when it is. */
  private readonly pendingUi: Array<Events['ui/request']> = [];

  static show(context: vscode.ExtensionContext, manager: RepositoryManager): GitTreePanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (GitTreePanel.current) {
      GitTreePanel.current.panel.reveal(column);
      return GitTreePanel.current;
    }

    const panel = vscode.window.createWebviewPanel('gitTree', 'Git Tree', column, {
      enableScripts: true,
      // History and diffs are expensive to rebuild; keeping the context alive
      // makes tab switching instant instead of a full reload.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media')],
    });

    GitTreePanel.current = new GitTreePanel(panel, context, manager);
    return GitTreePanel.current;
  }

  /** The open panel, if any — for settings changes made outside it. */
  static get instance(): GitTreePanel | undefined {
    return GitTreePanel.current;
  }

  /** Asks the webview to open a surface, queued until it is listening. */
  requestUi(request: Events['ui/request']): void {
    if (this.ready) this.emit('ui/request', request);
    else this.pendingUi.push(request);
  }

  /** Settings changed outside the webview (settings.json, the Settings UI). */
  notifyConfigChanged(scopes: Events['config/changed']['scopes']): void {
    this.emit('config/changed', { scopes });
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly manager: RepositoryManager,
  ) {
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'gittree.svg');
    panel.webview.html = this.render(panel.webview);

    // One shared instance per provider (not per repo): each caches its own
    // session/profile lookups, and there is exactly one signed-in identity
    // per provider regardless of how many repos on that host are open.
    this.prProviders = [
      new GitHubProvider(),
      new AzureDevOpsProvider(),
      new GitLabProvider(context.secrets),
      new BitbucketProvider(context.secrets),
    ];

    this.worktrees = new WorktreeController(
      manager,
      new WorktreeSettingsStore(context.globalState),
      this.terminals,
      context,
      (event, payload) => this.emit(event, payload),
    );
    this.handlers = { ...this.baseHandlers, ...this.worktrees.handlers() };

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.receive(message)),
      panel.onDidDispose(() => this.dispose()),
      manager.onDidChangeRepositories(() => this.emitRepositories()),
      manager.onDidChangeRepository((repoId) => this.emit('status/changed', { repoId })),
      manager.onDidChangeState((state) => this.emit('repos/stateChanged', { state })),
      { dispose: manager.journal.onDidRecord((entry) => this.emit('commands/recorded', { entry })) },
      this.terminals,
    );
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    GitTreePanel.current = undefined;
    for (const controller of this.logStreams.values()) controller.abort();
    this.logStreams.clear();
    for (const item of this.disposables) item.dispose();
    this.panel.dispose();
  }

  /* ---------------------------------------------------------------------- */
  /* Messaging                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Posts to the webview, tolerating a panel that has gone away.
   *
   * Streams and watchers outlive a closed panel by a few milliseconds — a
   * history walk in flight, a debounced status refresh — and `postMessage` on a
   * disposed webview returns a rejected promise. Left unhandled, each one is an
   * unhandled rejection in the extension host's Debug Console: alarming, and
   * entirely a consequence of the user closing a tab.
   */
  private post(message: HostMessage): void {
    if (this.disposed) return;

    try {
      void this.panel.webview.postMessage(message).then(undefined, () => undefined);
    } catch {
      // The panel was disposed between the check and the call.
    }
  }

  private emit<E extends EventName>(event: E, payload: Events[E]): void {
    this.post({ kind: 'event', event, payload });
  }

  private emitRepositories(): void {
    this.emit('repos/changed', {
      nodes: this.worktrees.decorate(this.manager.repositories.all()),
      activeId: this.manager.active?.id,
    });
  }

  private async receive(message: WebviewMessage): Promise<void> {
    if (message.kind === 'ready') {
      this.ready = true;
      this.emitRepositories();
      for (const request of this.pendingUi.splice(0)) this.emit('ui/request', request);
      return;
    }

    if (message.kind === 'cancel') {
      return;
    }

    const { id, method, params } = message;

    try {
      const handler = this.handlers[method] as Handler<Method> | undefined;
      if (!handler) throw new RpcFailure('not-found', `Unknown method: ${method}`);

      const result = await handler(params as never);
      this.post({ kind: 'response', id, ok: true, result });
    } catch (error) {
      this.post({ kind: 'response', id, ok: false, error: toRpcError(error) });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Handlers                                                               */
  /* ---------------------------------------------------------------------- */

  private requireService(repoId: RepoId) {
    const service = this.manager.service(repoId);
    if (!service) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
    return service;
  }

  private requirePrService(repoId: RepoId): PullRequestService {
    const existing = this.prServices.get(repoId);
    if (existing) return existing;

    const service = new PullRequestService(this.requireService(repoId), this.prProviders);
    this.prServices.set(repoId, service);
    return service;
  }

  private requireRepo(repoId: RepoId) {
    const repo = this.manager.node(repoId);
    if (!repo) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
    return repo;
  }

  /**
   * Runs a settings edit down the same path as `commands/run`.
   *
   * Nothing here shortcuts to `git config` internally: a settings screen that
   * mutated configuration invisibly would be the one place this tool stopped
   * teaching, so every write is journaled and appears in the command log
   * exactly like a command the user typed.
   *
   * `service.run` reports a non-zero exit rather than throwing — right for the
   * command sheet, which shows the output either way — so the failure is turned
   * back into an error here. `okExitCodes` covers the cases where git uses a
   * non-zero status as an answer; `config --unset` exits 5 when the key was
   * already absent, which is the desired end state, not a failure.
   */
  private async runWrite(repoId: RepoId, argv: string[], okExitCodes: readonly number[] = []): Promise<void> {
    const result = await this.requireService(repoId).run(argv);
    if (result.exitCode === 0 || okExitCodes.includes(result.exitCode)) return;

    throw new RpcFailure('git', result.stderr.trim() || `git exited with ${result.exitCode}`);
  }

  /** Every handler: the base set below plus the worktree controller's. */
  private readonly handlers: { [M in Method]?: Handler<M> };

  private readonly baseHandlers: { [M in Method]?: Handler<M> } = {
    'repos/list': async () => ({
      nodes: this.worktrees.decorate(this.manager.repositories.all()),
      activeId: this.manager.active?.id,
    }),

    'repos/rescan': async () => ({ nodes: await this.manager.rescan() }),

    'repos/openFolder': async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Open Repository or Workspace',
      });

      if (folder && folder[0]) {
        await vscode.commands.executeCommand('vscode.openFolder', folder[0], false);
      }
    },

    'repos/activate': async ({ repoId }) => {
      this.manager.setActive(repoId);
      const state = await this.manager.refreshState(repoId);
      if (!state) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
      return state;
    },

    'repos/state': async ({ repoId }) => {
      const state = await this.manager.refreshState(repoId);
      if (!state) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);
      return state;
    },

    'status/get': async ({ repoId }) => {
      const status = await this.requireService(repoId).status({ priority: 'foreground' });
      return this.markNestedRepositories(status);
    },

    'stage/files': async ({ repoId, paths }) =>
      this.requireService(repoId).stageFiles(paths, { priority: 'foreground' }),

    'unstage/files': async ({ repoId, paths }) =>
      this.requireService(repoId).unstageFiles(paths, { priority: 'foreground' }),

    'discard/files': async ({ repoId, paths, untracked }) =>
      this.requireService(repoId).discardFiles(paths, { priority: 'foreground' }, untracked ?? []),

    'conflicts/resolve': async ({ repoId, paths, resolution }) =>
      this.requireService(repoId).resolveConflicts(paths, resolution, { priority: 'foreground' }),

    'files/remove': async ({ repoId, paths }) =>
      this.requireService(repoId).removeFiles(paths, { priority: 'foreground' }),

    'files/stopTracking': async ({ repoId, paths }) =>
      this.requireService(repoId).stopTrackingFiles(paths, { priority: 'foreground' }),

    'files/ignore': async ({ repoId, paths }) =>
      this.requireService(repoId).ignoreFiles(paths, { priority: 'foreground' }),

    'files/reveal': async ({ repoId, path: relativePath }) => {
      const repo = this.requireRepo(repoId);
      const uri = vscode.Uri.joinPath(vscode.Uri.file(repo.root), relativePath);
      await vscode.commands.executeCommand('revealFileInOS', uri);
    },

    'stage/hunks': async ({ repoId, path, hunkIndices, reverse }) =>
      this.requireService(repoId).applyHunks(path, hunkIndices, reverse, { priority: 'foreground' }),

    'stage/lines': async ({ repoId, path, selections, reverse }) =>
      this.requireService(repoId).applyLines(path, selections, reverse, { priority: 'foreground' }),

    'refs/list': async ({ repoId }) => ({
      refs: await this.requireService(repoId).refs({ priority: 'visible' }),
    }),

    'stash/list': async ({ repoId }) => ({
      stashes: await this.requireService(repoId).stashes({ priority: 'visible' }),
    }),

    'pullRequests/connection': async ({ repoId }) => this.requirePrService(repoId).connection(),

    'pullRequests/signIn': async ({ repoId }) => this.requirePrService(repoId).signIn(),

    'pullRequests/list': async ({ repoId, status }) => ({
      pullRequests: await this.requirePrService(repoId).list(status),
    }),

    'pullRequests/get': async ({ repoId, id }) => this.requirePrService(repoId).get(id),

    'pullRequests/create': async ({ repoId, ...input }) => this.requirePrService(repoId).create(input),

    'pullRequests/vote': async ({ repoId, id, vote }) => this.requirePrService(repoId).vote(id, vote),

    'pullRequests/complete': async ({ repoId, id, ...options }) =>
      this.requirePrService(repoId).complete(id, options),

    'pullRequests/abandon': async ({ repoId, id }) => this.requirePrService(repoId).abandon(id),

    'pullRequests/commentThreads': async ({ repoId, id }) => ({
      threads: await this.requirePrService(repoId).commentThreads(id),
    }),

    'pullRequests/addComment': async ({ repoId, id, ...input }) =>
      this.requirePrService(repoId).addComment(id, input),

    'pullRequests/ensureFetched': async ({ repoId, id }) => this.requirePrService(repoId).ensureFetched(id),

    'pullRequests/openExternal': async ({ url }) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },

    'stats/get': async ({ repoId, staged }) => ({
      stats: await this.requireService(repoId).stats(staged, { priority: 'visible' }),
    }),

    'settings/get': async ({ repoId }) => {
      const repo = this.requireRepo(repoId);
      const settings = await this.requireService(repoId).settings({ priority: 'foreground' });

      return {
        ...settings,
        // Discovered once when git was located. Empty rather than absent when
        // git never resolved, so the sheet has one thing to render.
        gitVersion: this.manager.gitVersion ?? '',
        root: repo.root,
        kind: repo.kind,
        ignoreFile: '.gitignore',
      };
    },

    'settings/setUser': async ({ repoId, name, email, useGlobal }) => {
      if (useGlobal) {
        // Exit 5 is `--unset` reporting that the key was not there to begin
        // with, which is precisely the state being asked for.
        await this.runWrite(repoId, ['config', '--local', '--unset', 'user.name'], [5]);
        await this.runWrite(repoId, ['config', '--local', '--unset', 'user.email'], [5]);
        return;
      }

      // An omitted field is "leave this one alone", not "clear it": the sheet
      // may be saving a changed email while the name is untouched.
      if (name !== undefined) await this.runWrite(repoId, ['config', '--local', 'user.name', name]);
      if (email !== undefined) await this.runWrite(repoId, ['config', '--local', 'user.email', email]);
    },

    'remotes/list': async ({ repoId }) => ({
      remotes: await this.requireService(repoId).remotes({ priority: 'visible' }),
    }),

    'remotes/add': async ({ repoId, name, url }) => {
      await this.runWrite(repoId, remoteAddArgs(name, url));
    },

    'remotes/remove': async ({ repoId, name }) => {
      await this.runWrite(repoId, remoteRemoveArgs(name));
      // Removing a remote deletes its remote-tracking branches, so the ref
      // list and any ahead/behind counts drawn from them are now stale.
      this.emit('status/changed', { repoId });
    },

    'remotes/setUrl': async ({ repoId, name, fetchUrl, pushUrl }) => {
      if (fetchUrl !== undefined) await this.runWrite(repoId, remoteSetUrlArgs(name, fetchUrl));
      if (pushUrl !== undefined) await this.runWrite(repoId, remoteSetUrlArgs(name, pushUrl, true));
    },

    'diff/get': async (target) => this.requireService(target.repoId).diff(target, { priority: 'foreground' }),

    'commit/get': async ({ repoId, hash }) => {
      const commit = await this.requireService(repoId).commitDetails(hash);
      if (!commit) throw new RpcFailure('not-found', `Unknown commit: ${hash}`);
      return commit;
    },

    'commit/create': async (request) => this.requireService(request.repoId).commit(request),

    'commit/suggest': async ({ repoId }) => suggestCommitMessage(this.requireService(repoId)),

    'log/outgoing': async ({ repoId }) => this.requireService(repoId).outgoing({ priority: 'visible' }),

    'log/start': async (request) => {
      // The caller owns the id. Generating it here and returning it would leave
      // a window between the first emitted batch and the webview learning the
      // id, and every batch inside that window would be undeliverable.
      const { streamId } = request;
      const controller = new AbortController();

      // A repeated id means the previous walk is stale; stop it rather than
      // letting two streams interleave into the same collector.
      this.logStreams.get(streamId)?.abort();
      this.logStreams.set(streamId, controller);

      // Fan out across the requested repositories; each batch is tagged with
      // its repoId so the unified view can attribute rows.
      void Promise.all(
        request.repoIds.map(async (repoId) => {
          const service = this.manager.service(repoId);
          if (!service) return;

          await service.log(
            request,
            (commits, rows) => {
              // Per-repository completion is not stream completion; the single
              // done:true below fires once every repository has finished.
              if (commits.length > 0) {
                this.emit('log/batch', { streamId, commits, rows, done: false });
              }
            },
            { priority: 'visible', signal: controller.signal },
          );
        }),
      )
        .catch(() => undefined)
        .finally(() => {
          // Only retire the entry if it is still ours; a restart under the same
          // id will have replaced it.
          if (this.logStreams.get(streamId) === controller) this.logStreams.delete(streamId);
          this.emit('log/batch', { streamId, commits: [], rows: [], done: true });
        });
    },

    'log/cancel': async ({ streamId }) => {
      this.logStreams.get(streamId)?.abort();
      this.logStreams.delete(streamId);
    },

    'commands/recent': async ({ limit }) => ({ entries: this.manager.journal.recent(limit) }),

    'commands/clear': async () => {
      this.manager.journal.clear();
    },

    'commands/run': async ({ repoId, argv, stdin }) => {
      const service = this.requireService(repoId);
      await this.worktrees.beforeCommand(argv);
      const result = await service.run(argv, stdin);
      await this.worktrees.afterCommand(repoId, argv, result.exitCode === 0);

      // Almost every mutation moves HEAD, the index, or the refs. Refreshing
      // here means the views update from one place rather than each caller
      // remembering to, and the watcher's debounce is bypassed so the result is
      // visible immediately rather than 150ms later.
      void this.manager.refreshState(repoId);
      this.emit('status/changed', { repoId });

      return result;
    },

    'dialog/saveFile': async ({ repoId, title, defaultName, filters }) => {
      const repo = this.requireRepo(repoId);
      const picked = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(path.dirname(repo.root), path.basename(defaultName))),
        ...(title ? { title } : {}),
        ...(filters ? { filters } : {}),
      });
      return picked ? { path: displayPath(picked.fsPath) } : {};
    },

    'clipboard/write': async ({ text, label }) => {
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`$(check) ${label ?? 'Copied'}`, 2500);
    },

    'terminal/open': async ({ repoId }) => {
      this.terminals.open(this.requireRepo(repoId));
    },

    'terminal/send': async ({ repoId, command }) => {
      this.terminals.send(this.requireRepo(repoId), command);
    },

    'editor/open': async ({ repoId, path: relativePath, line }) => {
      const repo = this.manager.node(repoId);
      if (!repo) throw new RpcFailure('not-found', `Unknown repository: ${repoId}`);

      const uri = vscode.Uri.joinPath(vscode.Uri.file(repo.root), relativePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: true });

      if (line !== undefined) {
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    },
  };

  /**
   * Tags status entries that are actually other repositories.
   *
   * Git reports a nested checkout as a single untracked directory, giving the
   * user no hint that "staging" it would commit an empty gitlink and lose every
   * file inside. Matching the entry against the known child repositories lets
   * the UI refuse the action and explain why.
   */
  private markNestedRepositories(status: StatusResult): StatusResult {
    const repo = this.manager.repositories.get(status.repoId);
    if (!repo) return status;

    const children = this.manager.repositories.childrenOf(repo.id);
    if (children.length === 0) return status;

    const byRelativePath = new Map<string, RepoId>();
    for (const child of children) {
      const relative = relativeTo(repo.root, child.root);
      if (relative) byRelativePath.set(relative, child.id);
    }

    return {
      ...status,
      files: status.files.map((file) => {
        // Untracked directories arrive with a trailing slash.
        const normalized = file.path.replace(/\/+$/, '');
        const nestedRepoId = byRelativePath.get(normalized);
        return nestedRepoId ? { ...file, nestedRepoId } : file;
      }),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* HTML                                                                   */
  /* ---------------------------------------------------------------------- */

  private render(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (...segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...segments));

    const script = asset('dist', 'webview', 'index.js');
    const style = asset('dist', 'webview', 'index.css');

    // `default-src 'none'` plus a per-load nonce: no inline script, no remote
    // origin, and no way for repository content rendered into the view to
    // execute. Fonts are local only; the type stack falls back to system faces.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <title>Git Tree</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${script}"></script>
  </body>
</html>`;
  }
}

/**
 * Converts a thrown value into the wire error shape.
 *
 * Git's stderr and exit code survive intact, because a failing `pre-commit`
 * hook's own output is the entire useful diagnostic and replacing it with
 * "commit failed" would throw away the only thing the user needs.
 */
function toRpcError(error: unknown): RpcError {
  if (error instanceof GitError) {
    return {
      code: 'git',
      message: error.message,
      stderr: error.stderr,
      exitCode: error.exitCode ?? undefined,
      argv: [...error.argv],
    };
  }

  if (error instanceof CancelledError) {
    return { code: 'cancelled', message: error.message };
  }

  if (error instanceof RpcFailure) {
    return { code: error.code, message: error.message };
  }

  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}
