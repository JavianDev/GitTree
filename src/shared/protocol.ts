/**
 * The typed contract between the webview and the extension host.
 *
 * The webview sends *intent* — never a command line. Every method that touches
 * a repository names it explicitly by `repoId`; the host keeps no implicit
 * "current repository", so a stale selection in the UI can never cause an
 * operation to land in the wrong repo.
 */

import type {
  Commit,
  DiffFile,
  FileStats,
  GitRemote,
  GraphRow,
  JournalEntry,
  PullRequestCommentThread,
  PullRequestConnection,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
  RefEntry,
  RepoId,
  RepoNode,
  RepoSettings,
  RepoState,
  StashEntry,
  StatusResult,
} from './model';
import type { CommandContext, CommandId } from './commands';

/* ------------------------------------------------------------------------ */
/* Request/response surface                                                 */
/* ------------------------------------------------------------------------ */

/** Which side of a change a diff should describe. */
export type DiffTarget =
  | { kind: 'worktree'; repoId: RepoId; path: string }
  | { kind: 'index'; repoId: RepoId; path: string }
  /** A path git isn't tracking yet: its whole content, shown as added lines. */
  | { kind: 'untracked'; repoId: RepoId; path: string }
  | { kind: 'commit'; repoId: RepoId; hash: string; path?: string }
  | { kind: 'range'; repoId: RepoId; from: string; to: string; path?: string };

/** A contiguous run of selected lines within one hunk, for partial staging. */
export interface LineSelection {
  hunkIndex: number;
  /** Indices into `DiffHunk.lines`, referring only to add/delete lines. */
  lineIndices: number[];
}

export interface CommitRequest {
  repoId: RepoId;
  message: string;
  amend: boolean;
  signoff: boolean;
  /** Force `-S`; when absent, git's own `commit.gpgsign` setting applies. */
  sign?: boolean;
  /** `Co-authored-by:` trailers appended to the message body. */
  coAuthors?: string[];
  /** Commit even with nothing staged (used for empty merge commits). */
  allowEmpty?: boolean;
  /** Skip the pre-commit and commit-msg hooks (`--no-verify`). */
  noVerify?: boolean;
}

export interface LogRequest {
  /**
   * Correlation id, minted by the **caller** before the request is sent.
   *
   * The host starts streaming as soon as it receives the request, so batches
   * can reach the webview before the response to `log/start` does. If the id
   * were assigned by the host and learned from that response, every batch that
   * won the race would be unroutable and silently dropped — which on a small
   * repository is every batch, leaving the view permanently empty.
   */
  streamId: string;
  repoIds: RepoId[];
  /** Refs to walk. Empty means `--all`. */
  refs?: string[];
  /** Maximum commits to stream before stopping. */
  limit?: number;
  /** Restrict history to these paths. */
  paths?: string[];
  /** Free-text `--grep` filter. */
  search?: string;
  /**
   * Which field the context bar's scope selector points `search` at.
   *
   * The term stays in `search` whichever scope is chosen, so the host owns the
   * translation into `--grep`, `--author`, or a SHA lookup. A webview that
   * moved the term into `author` itself would also have to know that a SHA is
   * not a `--grep` at all.
   */
  searchField?: 'message' | 'author' | 'sha';
  author?: string;
}

/**
 * Method table. Each entry names the parameter and result shape; the client
 * and host share it, so a mismatch is a compile error rather than a runtime
 * surprise.
 */
export interface Api {
  /* Repositories */
  'repos/list': { params: void; result: { nodes: RepoNode[]; activeId?: RepoId } };
  'repos/rescan': { params: void; result: { nodes: RepoNode[] } };
  'repos/openFolder': { params: void; result: void };
  'repos/activate': { params: { repoId: RepoId }; result: RepoState };
  'repos/state': { params: { repoId: RepoId }; result: RepoState };

  /* Status and staging */
  'status/get': { params: { repoId: RepoId }; result: StatusResult };
  /**
   * Per-file line counts for one side of the working tree.
   *
   * Separate from `status/get` because it is a second, slower invocation — it
   * diffs every changed file — and the file list must paint as soon as status
   * returns rather than waiting on counts that only add weight to rows.
   */
  'stats/get': { params: { repoId: RepoId; staged: boolean }; result: { stats: FileStats[] } };
  'stage/files': { params: { repoId: RepoId; paths: string[] }; result: void };
  'unstage/files': { params: { repoId: RepoId; paths: string[] }; result: void };
  'discard/files': { params: { repoId: RepoId; paths: string[] }; result: void };
  /**
   * Resolves conflicted paths by taking one side wholesale, then marks them
   * resolved. Not a `CommandSpec` — the right git invocation differs per path
   * (a checkout, or a `rm` for the add/delete case), so this is not one flat
   * argv the way every `commands/run` action is.
   */
  'conflicts/resolve': {
    params: { repoId: RepoId; paths: string[]; resolution: 'ours' | 'theirs' };
    result: void;
  };
  'files/remove': { params: { repoId: RepoId; paths: string[] }; result: void };
  'files/stopTracking': { params: { repoId: RepoId; paths: string[] }; result: void };
  'files/ignore': { params: { repoId: RepoId; paths: string[] }; result: void };
  'files/reveal': { params: { repoId: RepoId; path: string }; result: void };
  'stage/hunks': {
    params: { repoId: RepoId; path: string; hunkIndices: number[]; reverse: boolean };
    result: void;
  };
  'stage/lines': {
    params: { repoId: RepoId; path: string; selections: LineSelection[]; reverse: boolean };
    result: void;
  };

  /* Refs */
  'refs/list': { params: { repoId: RepoId }; result: { refs: RefEntry[] } };

  /* Stashes */
  'stash/list': { params: { repoId: RepoId }; result: { stashes: StashEntry[] } };

  /* Pull Requests */
  /** Silent detection + session check only — never prompts, never persists anything. */
  'pullRequests/connection': { params: { repoId: RepoId }; result: PullRequestConnection };
  /** Triggers the provider's native interactive sign-in popup (or, for GitLab, the PAT prompt). */
  'pullRequests/signIn': { params: { repoId: RepoId }; result: { signedIn: boolean } };
  'pullRequests/list': {
    params: { repoId: RepoId; status: PullRequestStatus };
    result: { pullRequests: PullRequestEntry[] };
  };
  'pullRequests/get': { params: { repoId: RepoId; id: number }; result: PullRequestDetail };
  'pullRequests/create': {
    params: {
      repoId: RepoId;
      title: string;
      description: string;
      sourceBranch: string;
      targetBranch: string;
      isDraft: boolean;
    };
    result: { id: number };
  };
  'pullRequests/vote': { params: { repoId: RepoId; id: number; vote: PullRequestVote }; result: void };
  'pullRequests/complete': {
    params: {
      repoId: RepoId;
      id: number;
      squashMerge: boolean;
      deleteSourceBranch: boolean;
      bypassPolicy: boolean;
      mergeCommitMessage?: string;
    };
    result: void;
  };
  'pullRequests/abandon': { params: { repoId: RepoId; id: number }; result: void };
  'pullRequests/commentThreads': {
    params: { repoId: RepoId; id: number };
    result: { threads: PullRequestCommentThread[] };
  };
  'pullRequests/addComment': {
    params: { repoId: RepoId; id: number; threadId?: number; content: string; filePath?: string; line?: number };
    result: { threadId: number };
  };
  /**
   * Fetches the PR's source/target branches locally so `diff/get` has the
   * objects it needs. Each provider gets there differently — see
   * `extension/pullRequests/providers/*`.
   */
  'pullRequests/ensureFetched': {
    params: { repoId: RepoId; id: number };
    result: { sourceOid: string; targetOid: string; mergeBaseOid: string };
  };
  'pullRequests/openExternal': { params: { url: string }; result: void };

  /* Settings */
  'settings/get': { params: { repoId: RepoId }; result: RepoSettings };
  /**
   * Sets or clears the repository's committer identity.
   *
   * `useGlobal` unsets the local keys rather than copying the global values
   * into them. Copying would freeze the identity at today's value, so changing
   * the global config later would quietly stop reaching this repository — and
   * the sheet would still be showing "use global".
   */
  'settings/setUser': {
    params: { repoId: RepoId; name?: string; email?: string; useGlobal: boolean };
    result: void;
  };

  /* Remotes */
  'remotes/list': { params: { repoId: RepoId }; result: { remotes: GitRemote[] } };
  'remotes/add': { params: { repoId: RepoId; name: string; url: string }; result: void };
  /** Also deletes the remote-tracking branches that belonged to it. */
  'remotes/remove': { params: { repoId: RepoId; name: string }; result: void };
  /**
   * Repoints a remote. Each URL given is written on its own, so a remote that
   * fetches over HTTPS and pushes over SSH keeps both settings distinct;
   * omitting one leaves that direction untouched.
   */
  'remotes/setUrl': {
    params: { repoId: RepoId; name: string; fetchUrl?: string; pushUrl?: string };
    result: void;
  };

  /* Diffs */
  'diff/get': { params: DiffTarget; result: DiffFile[] };

  /* History */
  /** Begins a history walk. The caller already knows the id, so nothing is returned. */
  'log/start': { params: LogRequest; result: void };
  'log/cancel': { params: { streamId: string }; result: void };
  /** Full record for one commit — body, committer, signature — loaded on selection. */
  'commit/get': { params: { repoId: RepoId; hash: string }; result: Commit };

  /* Mutations */
  'commit/create': { params: CommitRequest; result: { hash: string } };
  /**
   * A drafted commit message for what would be committed. `model` when an AI
   * model wrote it (via VS Code's language model API), `files` when it was
   * drafted from the changed files alone; `note` says why, when that matters.
   */
  'commit/suggest': {
    params: { repoId: RepoId };
    result: { summary: string; description: string; source: 'model' | 'files'; model?: string; note?: string };
  };
  /** Commits on the current branch that its upstream (or, without one, any remote) does not have yet. */
  'log/outgoing': { params: { repoId: RepoId }; result: { commits: Commit[]; hasUpstream: boolean } };

  /* Command log */
  'commands/recent': { params: { limit?: number }; result: { entries: JournalEntry[] } };
  'commands/clear': { params: void; result: void };

  /**
   * Runs a git command the user has seen, and may have edited, in the command
   * sheet.
   *
   * `argv` is an argument list, never a command line: it is passed to `spawn`
   * with `shell: false`, so shell metacharacters are inert. The leading `git` is
   * implicit — this endpoint cannot invoke any other program.
   */
  'commands/run': {
    params: { repoId: RepoId; argv: string[]; stdin?: string };
    result: { stdout: string; stderr: string; exitCode: number };
  };

  /* Terminal */
  'terminal/open': { params: { repoId: RepoId }; result: void };
  /**
   * Types a command into the repository's terminal **without running it**, so
   * the user can read and edit it before pressing Enter. Running it for them
   * would defeat the point of a learning surface.
   */
  'terminal/send': { params: { repoId: RepoId; command: string }; result: void };

  /* Editor bridge */
  'editor/open': {
    params: { repoId: RepoId; path: string; line?: number };
    result: void;
  };
}

export type Method = keyof Api;
export type Params<M extends Method> = Api[M]['params'];
export type Result<M extends Method> = Api[M]['result'];

/* ------------------------------------------------------------------------ */
/* Events (host → webview, unsolicited)                                     */
/* ------------------------------------------------------------------------ */

export interface Events {
  /** The repository tree changed — discovery finished, or a repo appeared. */
  'repos/changed': { nodes: RepoNode[]; activeId?: RepoId };
  /** A watcher fired; the webview should refetch status for this repo. */
  'status/changed': { repoId: RepoId };
  /** Busy/error state for a repo changed. */
  'repos/stateChanged': { state: RepoState };
  /**
   * A batch of commits from an in-flight `log/start` stream, with their graph
   * rows already assigned.
   *
   * Rows travel *with* the commits rather than being requested afterwards. The
   * round trip they replace sent every commit to the host and every row back —
   * megabytes of structured clone on a large history — and could not start
   * until the walk had finished, so the graph stayed blank throughout.
   */
  'log/batch': { streamId: string; commits: Commit[]; rows: GraphRow[]; done: boolean };
  /** A git command finished; appended to the command log live. */
  'commands/recorded': { entry: JournalEntry };
  /** Host-side configuration the webview mirrors (accent, density, dates). */
  'config/changed': { accentColor: string; density: string; dateFormat: string };
}

export type EventName = keyof Events;

/* ------------------------------------------------------------------------ */
/* Wire envelopes                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A structured failure. Git errors keep `stderr` and `exitCode` verbatim so the
 * UI can show a failing hook's own output rather than a generic message.
 */
export interface RpcError {
  code: 'git' | 'cancelled' | 'not-found' | 'invalid' | 'internal';
  message: string;
  stderr?: string;
  exitCode?: number;
  /** The argv that failed, for the diagnostics view. Never contains secrets. */
  argv?: string[];
}

export type WebviewMessage =
  | { kind: 'request'; id: number; method: Method; params: unknown }
  | { kind: 'cancel'; id: number }
  | { kind: 'ready' };

export type HostMessage =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcError }
  | { kind: 'event'; event: EventName; payload: unknown };
