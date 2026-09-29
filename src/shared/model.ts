/**
 * Domain model shared by the extension host and the webview.
 *
 * Everything here must be structured-clone friendly: plain data only, no
 * classes, no Date objects, no Maps. Dates travel as ISO-8601 strings and are
 * formatted at the presentation layer.
 */

/** Stable identity for a repository. Derived from its normalized real path. */
export type RepoId = string;

/* ------------------------------------------------------------------------ */
/* Repositories                                                             */
/* ------------------------------------------------------------------------ */

/**
 * How a repository relates to the workspace and to other repositories.
 *
 * The distinction is load-bearing, not cosmetic: a `nested` repo appears in its
 * parent's status as a single untracked directory, and staging it would commit
 * an empty gitlink. The UI blocks that; a `submodule` is the supported form of
 * the same relationship.
 */
export type RepoKind = 'root' | 'nested' | 'submodule' | 'worktree';

export interface RepoNode {
  id: RepoId;
  /** Worktree root, original casing, forward slashes. For display. */
  root: string;
  /** Resolved `.git` directory (for a worktree this is the linked gitdir). */
  gitDir: string;
  /** Folder basename, disambiguated by parent folder when names collide. */
  name: string;
  kind: RepoKind;
  /** Containing repository, when this one lives inside another's worktree. */
  parentId?: RepoId;
  children: RepoId[];
  /** Depth below the workspace folder that contains it. */
  depth: number;
  /** Path of the workspace folder this repo was discovered under. */
  workspaceFolder: string;
}

/** Live state for a repository that has been activated. */
export interface RepoState {
  id: RepoId;
  branch: BranchInfo;
  counts: StatusCounts;
  /** True while a git operation is in flight for this repo. */
  busy: boolean;
  /** Populated when the last operation failed. */
  error?: string;
}

export interface StatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

/* ------------------------------------------------------------------------ */
/* Status                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A single position of a porcelain v2 `XY` field.
 * `.` means unmodified in that position.
 */
export type StatusLetter = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U';

export type FileChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

/**
 * Submodule state from the 4-character porcelain v2 field.
 * `N...` means "not a submodule"; `S<c><m><u>` describes one.
 */
export interface SubmoduleState {
  commitChanged: boolean;
  hasModifiedTracked: boolean;
  hasUntracked: boolean;
}

/**
 * The three merge stages of an unmerged path. Stage 1 is the merge base,
 * stage 2 "ours", stage 3 "theirs". Any may be absent (mode `000000`) — for
 * example an add/add conflict has no stage 1.
 */
export interface ConflictStages {
  /** Two-letter conflict code, e.g. `UU`, `AA`, `DU`. */
  code: string;
  base?: { mode: string; oid: string };
  ours?: { mode: string; oid: string };
  theirs?: { mode: string; oid: string };
}

/**
 * Which multi-step git operation, if any, is in progress.
 *
 * A conflicted `FileStatus` alone cannot say *why* a path is unmerged — a
 * merge, a rebase, a cherry-pick, and a revert all produce the same `UU`/`AA`/
 * etc. codes. This matters beyond labeling: what git calls "ours" and
 * "theirs" during conflict resolution **reverses** during a rebase (git
 * replays your commits on top of the target, so the target becomes "ours" and
 * your own commit becomes "theirs") but not during a merge, cherry-pick, or
 * revert. Presentation layers must compute mine/theirs wording from `kind`,
 * never assume "mine" always means the current branch.
 */
export type MergeOperationKind = 'merge' | 'rebase' | 'cherryPick' | 'revert';

export interface MergeOperation {
  kind: MergeOperationKind;
  /**
   * `merge`: the incoming branch, parsed from `MERGE_MSG`.
   * `rebase`: the branch being rebased — read from `head-name`, since HEAD
   * itself is detached for the whole operation and `BranchInfo.head` cannot
   * supply this.
   * `cherryPick` / `revert`: short SHA of the commit being applied.
   */
  incomingRef?: string;
  /**
   * `rebase` only: the target being rebased onto, from `onto` (a raw SHA —
   * resolving it to a branch name needs a git call and is left as future
   * polish; showing the short SHA is still unambiguous). Unset for every
   * other kind, since `BranchInfo.head` already names the current branch
   * reliably when HEAD is not detached.
   */
  ontoRef?: string;
  /**
   * `merge` only: `MERGE_MSG`'s full raw content, so the commit box can
   * prefill it the same way plain `git commit` would — completing a merge has
   * no `--continue` subcommand of its own, it is just an ordinary commit.
   */
  mergeMessage?: string;
}

export interface FileStatus {
  /** Repo-relative, forward slashes, never quoted or octal-escaped. */
  path: string;
  /** Source path for a rename or copy. */
  origPath?: string;
  /** Index (staged) position of `XY`. */
  index: StatusLetter;
  /** Worktree (unstaged) position of `XY`. */
  worktree: StatusLetter;
  kind: FileChangeKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  /** Rename/copy similarity score, 0–100. */
  score?: number;
  submodule?: SubmoduleState;
  conflict?: ConflictStages;
  /**
   * Set when this path is a nested repository rather than an ordinary
   * untracked directory. Staging it is blocked.
   */
  nestedRepoId?: RepoId;
}

export interface BranchInfo {
  /** HEAD commit, or undefined on an unborn branch (no commits yet). */
  oid?: string;
  /** Branch name, or undefined when HEAD is detached. */
  head?: string;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface StatusResult {
  repoId: RepoId;
  branch: BranchInfo;
  files: FileStatus[];
  /** Set while a merge/rebase/cherry-pick/revert is in progress. */
  mergeOperation?: MergeOperation;
}

/* ------------------------------------------------------------------------ */
/* Commits                                                                  */
/* ------------------------------------------------------------------------ */

export interface Identity {
  name: string;
  email: string;
}

export type RefKind = 'head' | 'localBranch' | 'remoteBranch' | 'tag' | 'stash';

export interface RefDecoration {
  kind: RefKind;
  /** Display name: `main`, `origin/main`, `v1.2.0`. */
  name: string;
  /** True when HEAD points at this ref. */
  isHead: boolean;
  /** Remote name for `remoteBranch` refs. */
  remote?: string;
}

/**
 * A ref as listed by `for-each-ref`, for the object sidebar.
 *
 * Distinct from `RefDecoration`, which describes a ref *as it appears on a
 * commit row*. This one carries the tracking and date information the sidebar
 * needs to sort by recency and show divergence.
 */
export interface RefEntry {
  kind: RefKind;
  /** Short name: `feature/INST-11308`, `origin/main`, `v1.2.0`. */
  name: string;
  /** Full ref path, unambiguous. */
  fullName: string;
  oid: string;
  isHead: boolean;
  remote?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** True when the upstream branch has been deleted on the remote. */
  gone?: boolean;
  /** ISO-8601, used to order the RECENT group. */
  committedAt?: string;
  subject?: string;
}

/** One entry from `git stash list`. */
export interface StashEntry {
  /** `stash@{0}` — accepted verbatim by every `git stash` subcommand. */
  ref: string;
  index: number;
  oid: string;
  shortOid: string;
  author: Identity;
  /** ISO-8601 with offset. */
  createdAt: string;
  /** Branch the stash was taken from, when git's subject exposes one. */
  branch?: string;
  /** The part after "WIP on <branch>:" / "On <branch>:", or the raw subject. */
  message: string;
}

/** `%G?` — signature verification status. */
export type SignatureStatus =
  | 'good'
  | 'bad'
  | 'unknown-validity'
  | 'expired'
  | 'expired-key'
  | 'revoked-key'
  | 'cannot-check'
  | 'none';

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: Identity;
  /** ISO-8601 with offset, from `%aI`. */
  authorDate: string;
  committer: Identity;
  /** ISO-8601 with offset, from `%cI`. */
  commitDate: string;
  refs: RefDecoration[];
  signature: SignatureStatus;
  subject: string;
  /** Message body below the subject, trailing newlines trimmed. */
  body: string;
  /** Set in multi-repo (unified) history so rows can be attributed. */
  repoId?: RepoId;
}

/* ------------------------------------------------------------------------ */
/* Diffs                                                                    */
/* ------------------------------------------------------------------------ */

export type DiffLineKind = 'context' | 'add' | 'delete' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  /** 1-based line number in the pre-image, absent for added lines. */
  oldNo?: number;
  /** 1-based line number in the post-image, absent for deleted lines. */
  newNo?: number;
  /** Line content without the leading +/-/space marker. */
  text: string;
  /** True when this line carried a `\ No newline at end of file` marker. */
  noNewline?: boolean;
}

export interface DiffHunk {
  /** Verbatim `@@ -a,b +c,d @@` header, including any trailing section text. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileDiffStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'typechange';

export interface DiffFile {
  /** Post-image path. Equals `oldPath` unless renamed or copied. */
  path: string;
  oldPath: string;
  status: FileDiffStatus;
  /** True when git reported the content as binary; `hunks` will be empty. */
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  score?: number;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/**
 * Per-file line counts from `git diff --numstat`.
 *
 * Deliberately not part of `DiffFile`: the review pane needs a weight for every
 * changed file before any of their patches are loaded, and deriving these from
 * `DiffFile` would mean parsing every patch in a 29-file change to render one
 * header. Binary files have no counts at all, which `binary` records rather
 * than fakes.
 */
export interface FileStats {
  /** Post-image path, repo-relative, forward slashes. */
  path: string;
  /** Source path for a rename or copy. */
  oldPath?: string;
  added: number;
  deleted: number;
  /** True when git reported `-` for both counts; `added`/`deleted` are then 0. */
  binary: boolean;
}

/* ------------------------------------------------------------------------ */
/* Command journal                                                          */
/* ------------------------------------------------------------------------ */

/**
 * One recorded git invocation.
 *
 * Lives in the shared model because the command log renders it in the webview
 * while the host produces it — and because the whole point of the log is that
 * what the user sees is what actually ran.
 */
export interface JournalEntry {
  id: number;
  repoId?: RepoId;
  /**
   * The meaningful arguments — what a person would type. GitTree's own safety
   * options are excluded, so the log teaches the command rather than the
   * plumbing around it.
   */
  args: string[];
  /** Everything passed to the binary, for diagnostics. */
  fullArgv: string[];
  cwd: string;
  /** Epoch milliseconds. */
  startedAt: number;
  durationMs: number;
  exitCode: number;
  stderr?: string;
  /** False for reads, so mutations stand out in the log. */
  mutating: boolean;
  cancelled: boolean;
}

/* ------------------------------------------------------------------------ */
/* Settings                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A remote, with both directions resolved.
 *
 * `pushUrl` is never empty: git falls back to the fetch URL when
 * `remote.<name>.pushurl` is unset, so an absent field would have to mean
 * "unknown" rather than "not configured" and every reader would need to know
 * that fallback rule for itself.
 */
export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/** Everything the settings sheet reads about one repository. */
export interface RepoSettings {
  remotes: GitRemote[];
  /** `user.name` from this repository's own config, when it sets one. */
  userName?: string;
  userEmail?: string;
  /** The inherited identity, shown beside the "use global" toggle. */
  globalUserName?: string;
  globalUserEmail?: string;
  /**
   * True when the repository sets no local identity, so the global one applies.
   *
   * Not the same as the two identities being equal: a repository may set a
   * local value that happens to match the global one, and the toggle must
   * still show it as overridden.
   */
  usesGlobalUser: boolean;
  /** `git --version` as reported, or empty when git has not been located. */
  gitVersion: string;
  /** Worktree root, original casing, forward slashes. */
  root: string;
  kind: RepoKind;
  /**
   * Repo-relative path of the top-level `.gitignore`, set whether or not the
   * file exists. Relative because this is the value `editor/open` takes, which
   * resolves against the repository root; the display form is `root` + this.
   */
  ignoreFile: string;
}

/* ------------------------------------------------------------------------ */
/* Graph                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * How a rail leaves a row on its way to a parent commit.
 * `straight` continues in the same lane; `merge` and `branch` cross lanes.
 */
export type GraphEdgeKind = 'straight' | 'merge' | 'branch';

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  kind: GraphEdgeKind;
  /** Hash of the parent this edge travels toward. */
  parent: string;
  /** Palette index of the destination rail. */
  color: number;
}

/** A rail crossing a row without terminating in it. */
export interface GraphPassthrough {
  lane: number;
  color: number;
}

export interface GraphRow {
  hash: string;
  /** Row index in the laid-out sequence. */
  row: number;
  /** Lane the commit's node sits in. */
  lane: number;
  /**
   * Palette index for this commit's rail.
   *
   * Assigned when the rail is opened and held until it ends, rather than being
   * derived from the lane index. A branch therefore keeps one colour for its
   * whole visible life instead of changing hue whenever lanes are recycled
   * beneath it, and two branches that happen to occupy the same lane at
   * different times are not silently given the same colour.
   */
  color: number;
  /** Rails passing through this row untouched, with their colours. */
  passthrough: GraphPassthrough[];
  edges: GraphEdge[];
  /** Total lanes in use at this row; drives gutter width. */
  width: number;
  /** True when this commit has more than one parent. */
  isMerge: boolean;
  /** True when this commit has no parents. */
  isRoot: boolean;
}

/* ------------------------------------------------------------------------ */
/* Pull Requests                                                            */
/* ------------------------------------------------------------------------ */

export type PrProvider = 'github' | 'azureDevOps' | 'gitlab';
export type PullRequestStatus = 'active' | 'completed' | 'abandoned';
export type PullRequestVote =
  | 'approved'
  | 'approvedWithSuggestions'
  | 'noVote'
  | 'waitingForAuthor'
  | 'rejected';
export type MergeStatus = 'succeeded' | 'conflicts' | 'queued' | 'notSet' | 'rejectedByPolicy' | 'failure';
export type PolicyStatus = 'approved' | 'rejected' | 'queued' | 'running' | 'notApplicable' | 'broken' | 'pending';
export type ThreadStatus = 'active' | 'fixed' | 'wontFix' | 'closed' | 'pending' | 'unknown';

export interface PrIdentity {
  id: string;
  displayName: string;
  uniqueName?: string;
  imageUrl?: string;
}

export interface PullRequestReviewer {
  identity: PrIdentity;
  vote: PullRequestVote;
  isRequired: boolean;
}

/** One row in the PR list — everything the sidebar needs without a detail fetch. */
export interface PullRequestEntry {
  provider: PrProvider;
  id: number;
  title: string;
  status: PullRequestStatus;
  isDraft: boolean;
  author: PrIdentity;
  sourceRefName: string;
  targetRefName: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  reviewers: PullRequestReviewer[];
  webUrl: string;
}

export interface PullRequestCommit {
  commitId: string;
  author: Identity;
  date: string;
  comment: string;
}

export interface PolicyEvaluation {
  policyId: string;
  displayName: string;
  status: PolicyStatus;
  isBlocking: boolean;
  context?: string;
}

export interface WorkItemRef {
  id: string;
  title?: string;
  workItemType?: string;
  state?: string;
  webUrl: string;
}

/** Which vote/complete/work-item capabilities this provider actually supports. */
export interface PullRequestCapabilities {
  waitingForAuthorVote: boolean;
  bypassPolicy: boolean;
  workItems: boolean;
}

export interface PullRequestDetail extends PullRequestEntry {
  description: string;
  mergeStatus: MergeStatus;
  lastMergeSourceCommit?: string;
  lastMergeTargetCommit?: string;
  commits: PullRequestCommit[];
  policies: PolicyEvaluation[];
  workItems: WorkItemRef[];
  completionOptions?: { deleteSourceBranch: boolean; squashMerge: boolean; bypassPolicy: boolean };
  capabilities: PullRequestCapabilities;
}

export interface CommentThreadContext {
  filePath?: string;
  rightFileLine?: number;
}

export interface PullRequestComment {
  id: number;
  author: PrIdentity;
  content: string;
  publishedAt: string;
  commentType: 'text' | 'system' | 'codeChange';
}

export interface PullRequestCommentThread {
  id: number;
  status: ThreadStatus;
  context?: CommentThreadContext;
  comments: PullRequestComment[];
}

/** What the sidebar needs to decide whether/how to show the Pull Requests section. No settings, ever. */
export interface PullRequestConnection {
  /** True when a supported remote was found — drives whether the section renders at all. */
  detected: boolean;
  provider?: PrProvider;
  /** GitHub org/user, Azure DevOps organization, or GitLab namespace. */
  owner?: string;
  /** Repository name. */
  repo?: string;
  /** Azure DevOps project only; undefined for GitHub and GitLab. */
  project?: string;
  /** Result of a *silent* session check — no popup was shown to produce this value. */
  signedIn: boolean;
}
