import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMANDS,
  type CommandContext,
  type CommandId,
  type CommandSpec,
  archiveFormatFor,
  patchFileName,
  renderCommand,
  tokenize,
} from '@shared/commands';
import type { Commit, PullRequestEntry, RefEntry, StashEntry, WorktreeEntry } from '@shared/model';
import { CommandLog } from '../features/commands/CommandLog';
import { type CommandOption, CommandSheet } from '../features/commands/CommandSheet';
import { TeachingCard } from '../features/commands/TeachingCard';
import { type CommitAction, checkoutPlan, commitMenu } from '../features/history/commitActions';
import { CommitPopover } from '../features/history/CommitPopover';
import { HistoryView, type PointerSpot } from '../features/history/HistoryView';
import { CreatePullRequestSheet } from '../features/pullRequests/CreatePullRequestSheet';
import { PullRequestDiffPane } from '../features/pullRequests/PullRequestDiffPane';
import { PullRequestMaster } from '../features/pullRequests/PullRequestMaster';
import { ReviewPane } from '../features/review/ReviewPane';
import { SettingsSheet } from '../features/settings/SettingsSheet';
import { ObjectSidebar } from '../features/sidebar/ObjectSidebar';
import type { StashActionId } from '../features/sidebar/StashSection';
import type { SectionId as SettingsSectionId } from '../features/settings/SettingsSheet';
import type { WorktreeAction } from '../features/worktrees/actions';
import { BranchInWorktreeSheet } from '../features/worktrees/BranchInWorktreeSheet';
import { CreateWorktreeSheet } from '../features/worktrees/CreateWorktreeSheet';
import { RemoveWorktreeSheet } from '../features/worktrees/RemoveWorktreeSheet';
import { type WorktreeSelection, WorktreeDetails } from '../features/worktrees/WorktreeDetails';
import { WorktreeDiffPane } from '../features/worktrees/WorktreeDiffPane';
import { RpcRequestError, rpc } from '../rpc/client';
import type { ContextMenuItem } from '../shared/ContextMenu';
import { BottomRibbon } from './BottomRibbon';
import { ContextBar, type HistoryOptions, type SearchOptions, type ViewMode } from './ContextBar';
import { RepoTabs } from './RepoTabs';
import type { CommandId as KeyCommandId } from './keymap';
import { ShortcutsSheet } from './ShortcutsSheet';
import { SplitPane } from './SplitPane';
import { ThemeToggle } from './ThemeToggle';
import { Toolbar, type ToolbarAction } from './Toolbar';
import { useKeyboard } from './useKeyboard';
import { useLayout } from './useLayout';
import { useRepositories } from './useRepositories';
import { useTheme } from './useTheme';

/**
 * Options offered in each command sheet.
 *
 * Only the choices that genuinely change the outcome — the rest of git's flags
 * belong in the editable field, not in a wall of checkboxes nobody reads.
 */
const SHEET_OPTIONS: Partial<Record<CommandId, CommandOption[]>> = {
  fetch: [
    { key: 'prune', label: 'Prune', hint: 'Delete local copies of branches removed on the remote' },
    { key: 'tags', label: 'Tags', hint: 'Fetch tags as well as branches' },
    { key: 'all', label: 'All remotes', hint: 'Fetch from every configured remote' },
  ],
  pull: [
    { key: 'rebase', label: 'Rebase', hint: 'Replay your commits on top instead of merging' },
    { key: 'autostash', label: 'Autostash', hint: 'Shelve uncommitted work and restore it after' },
    { key: 'prune', label: 'Prune', hint: 'Also remove deleted remote branches' },
  ],
  push: [
    { key: 'setUpstream', label: 'Set upstream', hint: 'Track this remote branch from now on' },
    { key: 'tags', label: 'Push tags', hint: 'Tags are not pushed automatically' },
    { key: 'force', label: 'Force with lease', hint: 'Overwrite, but refuse if someone else pushed' },
  ],
  merge: [
    { key: 'noFastForward', label: 'No fast-forward', hint: 'Always create a merge commit' },
    { key: 'squash', label: 'Squash', hint: 'Stage the result without recording the merge' },
  ],
  'stash.push': [
    { key: 'message', label: 'Message', kind: 'text', placeholder: 'Optional description' },
    { key: 'includeUntracked', label: 'Include untracked', hint: 'New files are skipped otherwise' },
    { key: 'keepIndex', label: 'Keep index', hint: 'Leave the staged version in the working tree' },
    { key: 'stagedOnly', label: 'Staged only', hint: 'Stash just what is staged' },
  ],
  'branch.create': [
    { key: 'branch', label: 'Name', kind: 'text', placeholder: 'feature/name' },
    { key: 'checkoutAfterCreate', label: 'Check out', hint: 'Switch to the branch once created' },
  ],
  'tag.create': [
    { key: 'tagName', label: 'Name', kind: 'text', placeholder: 'v1.0.0' },
    { key: 'message', label: 'Message', kind: 'text', placeholder: 'What this release is (annotated tags)' },
    { key: 'annotated', label: 'Annotated', hint: 'A real tag object with a message — use for releases' },
  ],
  rebase: [{ key: 'autostash', label: 'Autostash', hint: 'Shelve uncommitted work and restore it after' }],
  cherryPick: [
    { key: 'recordOrigin', label: 'Record origin (-x)', hint: 'Note in the message which commit this came from' },
    { key: 'noCommit', label: 'Don’t commit', hint: 'Apply the change to your files and index; commit it yourself' },
  ],
  revert: [{ key: 'noCommit', label: 'Don’t commit', hint: 'Apply the undo to your files and index; commit it yourself' }],
  reset: [
    {
      key: 'resetMode',
      label: 'Mode',
      kind: 'choice',
      choices: [
        { value: 'soft', label: 'Soft', hint: 'Keep every change in between, staged' },
        { value: 'mixed', label: 'Mixed', hint: 'Keep every change in between in your files, unstaged' },
        { value: 'hard', label: 'Hard', hint: 'Discard every change in between and all uncommitted work' },
      ],
    },
  ],
  'worktree.lock': [{ key: 'lockReason', label: 'Reason', kind: 'text', placeholder: 'Why it must be kept (optional)' }],
  'worktree.move': [
    { key: 'newPath', label: 'Move to', kind: 'text', placeholder: 'New folder' },
    { key: 'force', label: 'Force', hint: 'Move even with uncommitted changes' },
    { key: 'forceLocked', label: 'Even though locked', hint: 'Passes --force twice' },
  ],
  'worktree.prune': [
    { key: 'dryRun', label: 'Dry run', hint: 'Only report what would be pruned' },
    { key: 'verbose', label: 'Verbose', hint: 'Name each record as it is pruned' },
  ],
  'branch.deleteGone': [{ key: 'forceDelete', label: 'Even if unmerged (-D)', hint: 'Delete branches whose commits are not merged anywhere' }],
};

/**
 * Which toolbar action each git shortcut opens.
 *
 * Two distinct id spaces meet here and both are called `CommandId`: the keyboard
 * scheme's (`git.fetch`) and the git command registry's (`fetch`). The alias
 * keeps the mapping between them explicit rather than letting one silently
 * stand in for the other.
 */
const SHORTCUT_ACTIONS: Partial<Record<KeyCommandId, CommandId>> = {
  'git.fetch': 'fetch',
  'git.pull': 'pull',
  'git.push': 'push',
  'git.branch': 'branch.create',
  'git.merge': 'merge',
  'git.stash': 'stash.push',
  'git.tag': 'tag.create',
};

const PANE_LABELS = ['Branches', 'Git Tree', 'Files', 'Code'] as const;

/**
 * How wide each pane may grow to show its text in full — branch names, commit
 * subjects, file names. The Code pane is whatever is left, so it has none.
 */
const PANE_FIT_MAX = [360, 720, 420, undefined] as const;

/**
 * The application shell.
 *
 * Three independently sizable panes — branches, commit tree, review — under the
 * tab strip, toolbar, and context bar. History and the working tree are visible
 * at once, which is the whole reason for three panes rather than a modal middle
 * column.
 */
/** Branches and Git Tree — the panes focus-diff mode folds away. */
const FOCUS_PANES: readonly number[] = [0, 1];

export function AppShell(): React.JSX.Element {
  const repositories = useRepositories();
  const layout = useLayout();
  const theme = useTheme();

  const [openIds, setOpenIds] = useState<string[]>([]);
  // History first, matching the tab order: the middle pane shows the graph, so
  // arriving in Changes meant the review pane disagreed with what was in front
  // of you until you switched.
  const [mode, setMode] = useState<ViewMode>('history');
  const [commit, setCommit] = useState<Commit | undefined>();
  const [selectedRef, setSelectedRef] = useState<string | undefined>();
  const [focusHash, setFocusHash] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [logOpen, setLogOpen] = useState(false);
  const [teaching, setTeaching] = useState<CommandSpec | undefined>();
  /**
   * `context` holds per-invocation overrides merged on top of the toolbar's
   * base context (see `runAction`) — a stash row's Apply/Pop/Drop each need a
   * different `stashRef`, which the toolbar's fixed `actions` map cannot express.
   */
  const [pending, setPending] = useState<{ id: CommandId; context: Partial<CommandContext> } | undefined>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pullRequestId, setPullRequestId] = useState<number | undefined>();
  const [prCommitHash, setPrCommitHash] = useState<string | undefined>();
  const [createPrOpen, setCreatePrOpen] = useState(false);
  /** The worktree whose details are open; its own repository id arrives once registered. */
  const [worktree, setWorktree] = useState<{ entry: WorktreeEntry; repoId?: string } | undefined>();
  const [worktreeSelection, setWorktreeSelection] = useState<WorktreeSelection | undefined>();
  const [createWorktree, setCreateWorktree] = useState<{ mode?: 'new' | 'existing'; base?: RefEntry } | undefined>();
  const [removeWorktree, setRemoveWorktree] = useState<WorktreeEntry | undefined>();
  const [branchHeld, setBranchHeld] = useState<{ ref: RefEntry; entry: WorktreeEntry } | undefined>();
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | undefined>();
  /** A commit's details panel; with `items`, its actions too (a right-click). */
  const [commitPop, setCommitPop] = useState<
    { commit: Commit; at: PointerSpot; items?: ContextMenuItem[] } | undefined
  >();

  const [history, setHistory] = useState<HistoryOptions>({
    scope: 'all',
    order: 'date',
    showRemotes: true,
  });
  const [search, setSearch] = useState<SearchOptions>({ field: 'message', query: '' });
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);

  const active = repositories.active;
  const activeState = active ? repositories.states.get(active.id) : undefined;
  const repoIds = useMemo(() => (active ? [active.id] : []), [active]);

  const pendingCount =
    (activeState?.counts.staged ?? 0) +
    (activeState?.counts.unstaged ?? 0) +
    (activeState?.counts.untracked ?? 0);

  // A repository becomes a tab the first time it is activated, so the strip
  // reflects what the user has opened rather than everything on disk.
  useEffect(() => {
    if (!active) return;
    setOpenIds((current) => (current.includes(active.id) ? current : [...current, active.id]));
  }, [active]);

  const closeTab = useCallback(
    (repoId: string) => {
      setOpenIds((current) => {
        const next = current.filter((id) => id !== repoId);
        if (repositories.activeId === repoId && next[0]) repositories.activate(next[0]);
        return next;
      });
    },
    [repositories],
  );

  /*
   * Selecting in the tree moves the mode with it.
   *
   * The switcher drives the review pane while the tree drives what that pane is
   * about, so the two can disagree: click a commit while in Changes and nothing
   * appears to happen. Coupling them in this one direction removes that without
   * taking the explicit switcher away.
   */
  const selectCommit = useCallback((next: Commit | undefined) => {
    setCommit(next);
    if (next) {
      setMode('history');
      setPullRequestId(undefined);
      setWorktree(undefined);
    }
  }, []);

  const selectPr = useCallback((pr: PullRequestEntry) => {
    setPullRequestId(pr.id);
    setPrCommitHash(undefined);
    setWorktree(undefined);
    setMode('pullRequest');
  }, []);

  /** Switching to History or Changes leaves whatever PR or worktree was selected behind. */
  const changeMode = useCallback((next: ViewMode) => {
    setMode(next);
    if (next !== 'pullRequest') setPullRequestId(undefined);
    if (next !== 'worktree') setWorktree(undefined);
  }, []);

  /**
   * The fourth pane's element. The review pane portals its diff into it, so it
   * is state rather than a ref: the review pane must re-render once it exists.
   */
  const [codePane, setCodePane] = useState<HTMLDivElement | null>(null);

  /** The pull request on screen, if any — Files then shows its details, Code its diff. */
  const openPrId = mode === 'pullRequest' ? pullRequestId : undefined;

  /**
   * Focus-diff mode: opening a file collapses the Branches and Git Tree panes
   * to their rails so Files and Code get the full width. Only the panes this
   * collapsed are remembered, so restoring never reopens one the user had
   * closed themselves.
   */
  const [focusCollapsed, setFocusCollapsed] = useState<readonly number[]>([]);
  const { collapsed: paneCollapsed, toggle: togglePane } = layout;

  const focusDiff = useCallback(() => {
    const toCollapse = FOCUS_PANES.filter((index) => paneCollapsed[index] !== true);
    if (toCollapse.length === 0) return;
    for (const index of toCollapse) togglePane(index);
    setFocusCollapsed((current) => [...new Set([...current, ...toCollapse])]);
  }, [paneCollapsed, togglePane]);

  const restorePanels = useCallback(() => {
    for (const index of focusCollapsed) {
      if (paneCollapsed[index] === true) togglePane(index);
    }
    setFocusCollapsed([]);
  }, [focusCollapsed, paneCollapsed, togglePane]);

  const focusActive = focusCollapsed.some((index) => paneCollapsed[index] === true);

  // Switching between History and Changes gives the panes back: the switch is
  // itself a move to browse, and the commit tree is where browsing starts.
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    if (focusActive) restorePanels();
  }, [mode, focusActive, restorePanels]);

  /**
   * A stash's diff reuses the commit-diff pipeline verbatim: its oid is a real
   * git object, just one not reachable from any branch, so `diff/get({ kind:
   * 'commit', hash })` works on it exactly as it does on any other commit.
   * `parents`/`refs`/`signature`/`body` are never read by that path — only
   * `hash` is — so a minimal synthetic `Commit` is enough to drive it.
   */
  const selectStash = useCallback(
    (stash: StashEntry) => {
      setSelectedRef(stash.ref);
      selectCommit({
        hash: stash.oid,
        shortHash: stash.shortOid,
        parents: [],
        author: stash.author,
        authorDate: stash.createdAt,
        committer: stash.author,
        commitDate: stash.createdAt,
        refs: [],
        signature: 'none',
        subject: stash.message,
        body: '',
      });
    },
    [selectCommit],
  );

  const selectUncommitted = useCallback(() => {
    setCommit(undefined);
    setMode('changes');
    setPullRequestId(undefined);
  }, []);

  const openTerminal = useCallback(() => {
    if (!active) return;
    void rpc.request('terminal/open', { repoId: active.id }).catch(() => undefined);
  }, [active]);

  const sendToTerminal = useCallback(
    (command: string) => {
      if (!active) return;
      void rpc.request('terminal/send', { repoId: active.id, command }).catch(() => undefined);
    },
    [active],
  );

  /**
   * Selecting a ref takes the graph to it.
   *
   * Recording the selection alone left the click doing nothing visible, so the
   * ref's oid is handed to the graph as well: it scrolls to that commit,
   * selects it, and the review pane fills with the tip's diff. A stash is
   * excluded because its commit is not on any branch and so is not in the walk.
   */
  const selectRef = useCallback((ref: RefEntry) => {
    setSelectedRef(ref.fullName);
    if (ref.kind !== 'stash') setFocusHash(ref.oid);
  }, []);

  /** `git switch <branch>`, run at once: what a double-click on a branch means. */
  const switchBranch = useCallback(
    (branch: string) => {
      if (!active) return;
      const commandText = renderCommand(COMMANDS['branch.checkout'], { branch }).replace(/^git /, '');
      const argv = tokenize(commandText);
      void rpc
        .request('commands/run', { repoId: active.id, argv })
        .then((result) => {
          // A refused checkout explains itself; swallowing it left the
          // double-click looking like it did nothing.
          setError(result.exitCode === 0 ? undefined : (result.stderr || result.stdout).trim() || `git switch exited with ${result.exitCode}`);
          repositories.refresh();
        })
        .catch((reason: unknown) => setError(describeError(reason)));
    },
    [active, repositories],
  );

  const checkoutRef = useCallback(
    (ref: RefEntry) => {
      selectRef(ref);
      if (ref.kind === 'localBranch') switchBranch(ref.name);
    },
    [selectRef, switchBranch],
  );

  const actions = useMemo<Partial<Record<CommandId, ToolbarAction>>>(() => {
    const branch = activeState?.branch;

    return {
      commit: {
        spec: COMMANDS.commit,
        context: {},
        disabledReason:
          (activeState?.counts.staged ?? 0) > 0 ? undefined : 'Stage at least one change first.',
      },
      fetch: { spec: COMMANDS.fetch, context: { prune: true, remote: 'origin' } },
      pull: {
        spec: COMMANDS.pull,
        context: { rebase: true, autostash: true, remote: 'origin', branch: branch?.head },
        disabledReason: branch?.upstream ? undefined : 'This branch has no upstream to pull from.',
      },
      push: {
        spec: COMMANDS.push,
        context: { remote: 'origin', branch: branch?.head, setUpstream: !branch?.upstream },
        ...(branch && branch.ahead > 0 ? { badge: String(branch.ahead) } : {}),
        disabledReason: branch?.detached ? 'HEAD is detached; check out a branch first.' : undefined,
      },
      'branch.create': { spec: COMMANDS['branch.create'], context: { checkoutAfterCreate: true } },
      merge: { spec: COMMANDS.merge, context: {} },
      'stash.push': {
        spec: COMMANDS['stash.push'],
        context: { includeUntracked: true },
        disabledReason: pendingCount > 0 ? undefined : 'Nothing to stash — the working tree is clean.',
      },
      discard: {
        spec: COMMANDS.discard,
        context: { paths: [...selectedPaths] },
        disabledReason: selectedPaths.length > 0 ? undefined : 'Select files in the review pane to discard.',
      },
      'tag.create': { spec: COMMANDS['tag.create'], context: { annotated: true } },
    };
  }, [activeState, pendingCount, selectedPaths]);

  const runAction = useCallback((id: CommandId, extra?: Partial<CommandContext>) => {
    // Committing needs a message, which belongs with the files it describes.
    if (id === 'commit') {
      setMode('changes');
    }
    setPending({ id, context: extra ?? {} });
  }, []);

  const stashAction = useCallback(
    (id: StashActionId, stashRef: string) => runAction(id, { stashRef }),
    [runAction],
  );

  /** Everything the Worktrees section, the details pane, and the branch menu ask for. */
  const handleWorktree = useCallback(
    (action: WorktreeAction) => {
      if (!active) return;
      const repoId = active.id;
      const fail = (reason: unknown) => setError(describeError(reason));

      switch (action.kind) {
        case 'select':
        case 'details': {
          const entry = action.entry;
          setWorktree({ entry });
          setWorktreeSelection(undefined);
          setPullRequestId(undefined);
          setMode('worktree');
          if (!entry.missing && !entry.bare) {
            void rpc
              .request('worktrees/register', { repoId, path: entry.path })
              .then((result) => setWorktree((current) => (current?.entry.path === entry.path ? { entry, repoId: result.repoId } : current)))
              .catch(fail);
          }
          return;
        }
        case 'open':
          void rpc.request('worktrees/open', { repoId, path: action.entry.path, target: action.target }).catch(fail);
          return;
        case 'reveal':
          void rpc.request('worktrees/reveal', { repoId, path: action.entry.path }).catch(fail);
          return;
        case 'terminal':
          void rpc.request('worktrees/terminal', { repoId, path: action.entry.path }).catch(fail);
          return;
        case 'copyPath':
          void rpc.request('worktrees/copyPath', { repoId, path: action.entry.path }).catch(fail);
          return;
        case 'color':
          void rpc
            .request('worktrees/setColor', { repoId, path: action.entry.path, color: action.color })
            .then(() => {
              setWorktree((current) =>
                current?.entry.path === action.entry.path
                  ? { ...current, entry: { ...current.entry, ...(action.color ? { color: action.color } : { color: undefined }) } }
                  : current,
              );
              repositories.refresh();
            })
            .catch(fail);
          return;
        case 'lock':
          runAction('worktree.lock', { worktreePath: action.entry.path });
          return;
        case 'unlock':
          runAction('worktree.unlock', { worktreePath: action.entry.path });
          return;
        case 'move':
          runAction('worktree.move', { worktreePath: action.entry.path, newPath: action.entry.path });
          return;
        case 'remove':
          setRemoveWorktree(action.entry);
          return;
        case 'create':
          setCreateWorktree({ ...(action.mode ? { mode: action.mode } : {}), ...(action.base ? { base: action.base } : {}) });
          return;
        case 'branchHeld':
          setBranchHeld({ ref: action.ref, entry: action.entry });
          return;
        case 'cleanupGone':
          runAction('branch.deleteGone', { branches: action.branches });
          return;
        case 'refresh':
          repositories.refresh();
          return;
        case 'prune':
          runAction('worktree.prune', { verbose: true });
          return;
        case 'repair':
          runAction('worktree.repair');
          return;
        case 'settings':
          setSettingsSection('worktrees');
          setSettingsOpen(true);
          return;
      }
    },
    [active, runAction, repositories],
  );

  /**
   * Local branches checked out in another worktree, read when a commit's menu
   * or double-click needs them: a branch lives in one worktree at a time, so
   * those are offered as "open its worktree" rather than a switch git refuses.
   */
  const branchHolders = useCallback(async (): Promise<Map<string, WorktreeEntry>> => {
    const holders = new Map<string, WorktreeEntry>();
    if (!active) return holders;
    try {
      const list = await rpc.request('worktrees/list', { repoId: active.id });
      for (const entry of list.worktrees) if (entry.branch && !entry.isCurrent) holders.set(entry.branch, entry);
    } catch {
      // Without the list, a held branch is simply tried; git's refusal is shown.
    }
    return holders;
  }, [active]);

  const copyText = useCallback((text: string, label: string) => {
    void rpc.request('clipboard/write', { text, label }).catch((reason: unknown) => setError(describeError(reason)));
  }, []);

  /** Asks where to write the file, then opens the command's sheet with it filled in. */
  const saveThenRun = useCallback(
    (id: 'archive' | 'formatPatch', commit: Commit) => {
      if (!active) return;
      const archive = id === 'archive';
      void rpc
        .request('dialog/saveFile', {
          repoId: active.id,
          title: archive ? `Archive ${commit.shortHash}` : `Create a patch of ${commit.shortHash}`,
          defaultName: archive ? `${active.name}-${commit.shortHash}.zip` : patchFileName(commit.subject),
          filters: archive
            ? { 'Zip archive': ['zip'], 'Tar archive, gzipped': ['tar.gz', 'tgz'], 'Tar archive': ['tar'] }
            : { Patch: ['patch'] },
        })
        .then(({ path }) => {
          if (!path) return;
          runAction(id, {
            commitish: commit.hash,
            outputPath: path,
            ...(archive ? { archiveFormat: archiveFormatFor(path) } : {}),
          });
        })
        .catch((reason: unknown) => setError(describeError(reason)));
    },
    [active, runAction],
  );

  const runCommitAction = useCallback(
    (action: CommitAction, commit: Commit) => {
      switch (action.kind) {
        case 'switch':
          switchBranch(action.branch);
          return;
        case 'held':
          setBranchHeld({
            ref: { kind: 'localBranch', name: action.branch, fullName: `refs/heads/${action.branch}`, oid: commit.hash, isHead: false },
            entry: action.entry,
          });
          return;
        case 'command':
          runAction(action.id, action.context);
          return;
        case 'archive':
          saveThenRun('archive', commit);
          return;
        case 'patch':
          saveThenRun('formatPatch', commit);
          return;
        case 'copy':
          copyText(action.text, action.label);
          return;
      }
    },
    [switchBranch, runAction, saveThenRun, copyText],
  );

  const head = activeState?.branch;

  const openCommitMenu = useCallback(
    (commit: Commit, at: PointerSpot) => {
      const build = (holders: ReadonlyMap<string, WorktreeEntry>): ContextMenuItem[] =>
        commitMenu(commit, head ?? { detached: false }, holders).map((entry) =>
          entry.separator
            ? { label: '', separator: true, run: () => undefined }
            : {
                label: entry.label,
                run: () => {
                  if (entry.action) runCommitAction(entry.action, commit);
                },
                ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
                ...(entry.hint ? { hint: entry.hint } : {}),
                ...(entry.destructive ? { destructive: true } : {}),
                ...(entry.default ? { default: true, shortcut: 'Double-click' } : {}),
              },
        );
      setCommitPop({ commit, at, items: build(new Map()) });
      // The worktree list decides which branches can be checked out here; the
      // menu is shown at once and corrected the moment it arrives.
      void branchHolders().then((holders) => {
        if (holders.size === 0) return;
        setCommitPop((current) => (current?.commit.hash === commit.hash && current.items ? { ...current, items: build(holders) } : current));
      });
    },
    [head, runCommitAction, branchHolders],
  );

  const closeCommitPop = useCallback(() => setCommitPop(undefined), []);

  const openCommitDetails = useCallback((commit: Commit, at: PointerSpot) => setCommitPop({ commit, at }), []);

  const activateCommit = useCallback(
    (commit: Commit, at: PointerSpot) => {
      setCommitPop(undefined);
      void branchHolders().then((holders) => {
        const plan = checkoutPlan(commit, head ?? { detached: false }, holders);
        if (plan.kind === 'choose') openCommitMenu(commit, at);
        else if (plan.kind !== 'none') runCommitAction(plan, commit);
      });
    },
    [head, branchHolders, openCommitMenu, runCommitAction],
  );

  // The palette command (Ctrl+Shift+G W) asks for the New Worktree sheet.
  useEffect(
    () =>
      rpc.on('ui/request', ({ action }) => {
        if (action === 'worktree.create') setCreateWorktree({});
      }),
    [],
  );

  /**
   * `Escape` unwinds one layer at a time.
   *
   * Closing everything at once loses work — a half-typed command in the sheet
   * disappears along with the teaching card that was covering it.
   */
  const dismiss = useCallback(() => {
    if (commitPop) return setCommitPop(undefined);
    if (teaching) return setTeaching(undefined);
    // Shortcuts before settings: settings can open it, and it covers it.
    if (shortcutsOpen) return setShortcutsOpen(false);
    if (pending) return setPending(undefined);
    if (branchHeld) return setBranchHeld(undefined);
    if (removeWorktree) return setRemoveWorktree(undefined);
    if (createWorktree) return setCreateWorktree(undefined);
    if (settingsOpen) return setSettingsOpen(false);
    if (search.query) return setSearch((current) => ({ ...current, query: '' }));
    if (logOpen) return setLogOpen(false);
  }, [commitPop, teaching, shortcutsOpen, settingsOpen, pending, search.query, logOpen, branchHeld, removeWorktree, createWorktree]);

  useKeyboard({
    'help.shortcuts': () => setShortcutsOpen(true),
    dismiss,
    'log.toggle': () => setLogOpen((open) => !open),
    'theme.cycle': theme.cycle,
    'terminal.open': openTerminal,
    'mode.changes': () => setMode('changes'),
    'mode.history': () => setMode('history'),
    'goto.uncommitted': selectUncommitted,
    'search.focus': () => searchRef.current?.focus(),
    'pane.toggle.branches': () => layout.toggle(0),
    'pane.toggle.tree': () => layout.toggle(1),
    'repo.refresh': () => repositories.refresh(),
    'repo.rescan': () => {
      void rpc.request('repos/rescan', undefined).catch(() => undefined);
    },
    'git.worktree': () => setCreateWorktree({}),
    // Git shortcuts open the command sheet rather than running: a mistyped key
    // shows a dialog to read and cancel, never an executed push.
    ...Object.fromEntries(
      Object.entries(SHORTCUT_ACTIONS).map(([shortcut, action]) => [
        shortcut,
        () => runAction(action),
      ]),
    ),
  });

  // Falls back to the bare command spec for actions with no toolbar button
  // (stash apply/pop/drop, reached only from the sidebar's context menu).
  const pendingAction = pending
    ? (actions[pending.id] ?? { spec: COMMANDS[pending.id], context: {} })
    : undefined;

  return (
    <div className="gt-shell">
      <RepoTabs
        model={repositories}
        openIds={openIds}
        onClose={closeTab}
        onAdd={() => {
          void rpc.request('repos/openFolder', undefined).catch(() => undefined);
        }}
      />

      <Toolbar
        actions={actions}
        onRun={runAction}
        onExplain={setTeaching}
        onTerminal={openTerminal}
        onSettings={() => setSettingsOpen(true)}
        trailing={<ThemeToggle model={theme} />}
      />

      <ContextBar
        ref={searchRef}
        mode={mode}
        onMode={changeMode}
        showPrTab={pullRequestId !== undefined}
        showWorktreeTab={worktree !== undefined}
        history={history}
        onHistory={setHistory}
        search={search}
        onSearch={setSearch}
      />

      {error && (
        <div className="gt-error" role="alert">
          <strong>Git reported a problem</strong>
          {/* Verbatim: for a failing hook this output is the whole diagnostic. */}
          <pre>{error}</pre>
        </div>
      )}

      <SplitPane
        sizes={layout.sizes}
        mins={layout.mins}
        collapsed={layout.collapsed}
        defaults={layout.defaults}
        labels={PANE_LABELS}
        onResize={layout.resize}
        onToggleCollapse={layout.toggle}
        onMeasure={layout.fit}
        fitMax={PANE_FIT_MAX}
        {...(active ? { fitKey: active.id } : {})}
      >
        {active ? (
          <ObjectSidebar
            key={active.id}
            repoId={active.id}
            revision={repositories.revision}
            selectedRef={selectedRef}
            onSelect={selectRef}
            onCheckout={checkoutRef}
            onSelectStash={selectStash}
            onStashAction={stashAction}
            selectedPrId={pullRequestId}
            onSelectPr={selectPr}
            onCreatePr={() => setCreatePrOpen(true)}
            {...(mode === 'worktree' && worktree ? { selectedWorktree: worktree.entry.path } : {})}
            onWorktree={handleWorktree}
          />
        ) : (
          <nav className="gt-sidebar" aria-label="Repository objects" />
        )}

        {active ? (
          <HistoryView
            key={active.id}
            repoIds={repoIds}
            revision={repositories.revision}
            selectedHash={commit?.hash}
            onSelect={selectCommit}
            onError={setError}
            search={search}
            options={history}
            pendingCount={pendingCount}
            uncommittedSelected={mode === 'changes'}
            onSelectUncommitted={selectUncommitted}
            {...(focusHash ? { focusHash } : {})}
            onCommitActivate={activateCommit}
            onCommitMenu={openCommitMenu}
            onCommitDetails={openCommitDetails}
          />
        ) : (
          <div className="gt-empty">
            <p className="gt-empty-title">No repository open</p>
            <p className="gt-empty-detail">
              Choose a repository from the Repositories view, or open a folder containing one.
            </p>
          </div>
        )}

        {/* Files: what to look at — a change's or commit's files, a PR's details and commits, or a worktree. */}
        {active && mode === 'worktree' && worktree ? (
          <WorktreeDetails
            key={`${active.id}:${worktree.entry.path}`}
            entry={worktree.entry}
            {...(worktree.repoId ? { worktreeRepoId: worktree.repoId } : {})}
            revision={repositories.revision}
            colorLabels
            {...(worktreeSelection ? { selection: worktreeSelection } : {})}
            onSelect={setWorktreeSelection}
            onAction={handleWorktree}
          />
        ) : active && openPrId !== undefined ? (
          <PullRequestMaster
            key={`${active.id}:${openPrId}`}
            repoId={active.id}
            prId={openPrId}
            selectedCommit={prCommitHash}
            onSelectCommit={setPrCommitHash}
            onChanged={() => repositories.refresh()}
          />
        ) : active ? (
          <ReviewPane
            key={`${active.id}:${mode}`}
            repoId={active.id}
            // `mode` can be `'pullRequest'` while `pullRequestId` is briefly
            // unset (e.g. right after closing a PR); the PR panes take over
            // whenever both are set, so this fallback never actually renders
            // history-as-changes in practice.
            mode={mode === 'changes' ? 'changes' : 'history'}
            {...(commit ? { commitHash: commit.hash } : {})}
            revision={repositories.revision}
            onError={setError}
            onSelectionChange={setSelectedPaths}
            onRunCommand={runAction}
            onFileActivated={focusDiff}
            {...(focusActive ? { onRestorePanels: restorePanels } : {})}
            codeContainer={codePane}
          />
        ) : (
          <div className="gt-empty" />
        )}

        {/* Code. Always mounted, so the review pane's portal target survives a
            switch into and out of a pull request. */}
        <div className="gt-code-pane" ref={setCodePane}>
          {active && mode === 'worktree' && worktree && (
            <WorktreeDiffPane
              {...(worktree.repoId ? { worktreeRepoId: worktree.repoId } : {})}
              {...(worktreeSelection ? { selection: worktreeSelection } : {})}
            />
          )}
          {active && openPrId !== undefined && (
            <PullRequestDiffPane
              key={`${active.id}:${openPrId}:${prCommitHash ?? 'overall'}`}
              repoId={active.id}
              prId={openPrId}
              {...(prCommitHash ? { commitHash: prCommitHash } : {})}
            />
          )}
        </div>
      </SplitPane>

      <CommandLog open={logOpen} repoId={active?.id} onSendToTerminal={sendToTerminal} />

      <BottomRibbon
        state={activeState}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((open) => !open)}
        onTerminal={openTerminal}
      />

      {pending && pendingAction && active && (
        <CommandSheet
          key={pending.id}
          spec={pendingAction.spec}
          context={{ ...pendingAction.context, ...pending.context }}
          repoId={active.id}
          options={SHEET_OPTIONS[pending.id] ?? []}
          onExplain={setTeaching}
          onClose={() => setPending(undefined)}
          onApplied={() => repositories.refresh()}
        />
      )}

      {settingsOpen && active && (
        <SettingsSheet
          key={active.id}
          repoId={active.id}
          model={theme}
          appearance={history}
          onAppearance={(next) => setHistory((current) => ({ ...current, ...next }))}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsSection(undefined);
          }}
          {...(settingsSection ? { initialSection: settingsSection } : {})}
          onRunCommand={runAction}
          onCreateWorktree={() => setCreateWorktree({})}
        />
      )}

      {createWorktree && active && (
        <CreateWorktreeSheet
          repoId={active.id}
          {...(activeState?.branch?.head ? { currentBranch: activeState.branch.head } : {})}
          {...(createWorktree.mode ? { initialMode: createWorktree.mode } : {})}
          {...(createWorktree.base ? { initialBase: createWorktree.base } : {})}
          onExplain={setTeaching}
          onClose={() => setCreateWorktree(undefined)}
          onCreated={() => repositories.refresh()}
        />
      )}

      {removeWorktree && active && (
        <RemoveWorktreeSheet
          repoId={active.id}
          entry={removeWorktree}
          onExplain={setTeaching}
          onClose={() => setRemoveWorktree(undefined)}
          onRemoved={() => {
            if (worktree?.entry.path === removeWorktree.path) {
              setWorktree(undefined);
              setMode('history');
            }
            repositories.refresh();
          }}
        />
      )}

      {branchHeld && active && (
        <BranchInWorktreeSheet
          ref_={branchHeld.ref}
          entry={branchHeld.entry}
          onOpen={(target) => {
            void rpc.request('worktrees/open', { repoId: active.id, path: branchHeld.entry.path, target }).catch((reason: unknown) => setError(describeError(reason)));
            setBranchHeld(undefined);
          }}
          onClose={() => setBranchHeld(undefined)}
        />
      )}

      {commitPop && active && (
        <CommitPopover
          key={`${commitPop.commit.hash}:${commitPop.items ? 'menu' : 'details'}`}
          repoId={active.id}
          commit={commitPop.commit}
          x={commitPop.at.x}
          y={commitPop.at.y}
          {...(commitPop.items ? { items: commitPop.items } : {})}
          onClose={closeCommitPop}
          onJump={setFocusHash}
          onCopy={copyText}
        />
      )}

      {teaching && <TeachingCard spec={teaching} onClose={() => setTeaching(undefined)} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}

      {createPrOpen && active && (
        <CreatePullRequestSheet
          repoId={active.id}
          currentBranch={activeState?.branch?.head}
          onClose={() => setCreatePrOpen(false)}
          onCreated={(id) => {
            setPullRequestId(id);
            setPrCommitHash(undefined);
            setMode('pullRequest');
          }}
        />
      )}
    </div>
  );
}

/** Kept for the error path in child views. */
export function describeError(error: unknown): string {
  return error instanceof RpcRequestError ? error.displayText : String(error);
}
