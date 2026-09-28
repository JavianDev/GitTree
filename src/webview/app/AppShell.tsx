import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMANDS,
  type CommandContext,
  type CommandId,
  type CommandSpec,
  renderCommand,
  tokenize,
} from '@shared/commands';
import type { Commit, RefEntry, StashEntry } from '@shared/model';
import { CommandLog } from '../features/commands/CommandLog';
import { type CommandOption, CommandSheet } from '../features/commands/CommandSheet';
import { TeachingCard } from '../features/commands/TeachingCard';
import { HistoryView } from '../features/history/HistoryView';
import { ReviewPane } from '../features/review/ReviewPane';
import { SettingsSheet } from '../features/settings/SettingsSheet';
import { ObjectSidebar } from '../features/sidebar/ObjectSidebar';
import type { StashActionId } from '../features/sidebar/StashSection';
import { RpcRequestError, rpc } from '../rpc/client';
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
    { key: 'checkoutAfterCreate', label: 'Check out', hint: 'Switch to the branch once created' },
  ],
  'tag.create': [
    { key: 'annotated', label: 'Annotated', hint: 'A real tag object with a message — use for releases' },
  ],
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

const PANE_LABELS = ['Branches', 'Commit tree', 'Review'] as const;

/**
 * The application shell.
 *
 * Three independently sizable panes — branches, commit tree, review — under the
 * tab strip, toolbar, and context bar. History and the working tree are visible
 * at once, which is the whole reason for three panes rather than a modal middle
 * column.
 */
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
    if (next) setMode('history');
  }, []);

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

  const checkoutRef = useCallback(
    (ref: RefEntry) => {
      selectRef(ref);
      if (!active) return;
      if (ref.kind === 'localBranch') {
        const commandText = renderCommand(COMMANDS['branch.checkout'], { branch: ref.name }).replace(
          /^git /,
          '',
        );
        const argv = tokenize(commandText);
        void rpc
          .request('commands/run', { repoId: active.id, argv })
          .then(() => repositories.refresh())
          .catch(() => undefined);
      }
    },
    [active, selectRef, repositories],
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

  /**
   * `Escape` unwinds one layer at a time.
   *
   * Closing everything at once loses work — a half-typed command in the sheet
   * disappears along with the teaching card that was covering it.
   */
  const dismiss = useCallback(() => {
    if (teaching) return setTeaching(undefined);
    // Shortcuts before settings: settings can open it, and it covers it.
    if (shortcutsOpen) return setShortcutsOpen(false);
    if (settingsOpen) return setSettingsOpen(false);
    if (pending) return setPending(undefined);
    if (search.query) return setSearch((current) => ({ ...current, query: '' }));
    if (logOpen) return setLogOpen(false);
  }, [teaching, shortcutsOpen, settingsOpen, pending, search.query, logOpen]);

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
        onMode={setMode}
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
        pinned={layout.pinned}
        onTogglePin={layout.togglePin}
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
          />
        ) : (
          <div className="gt-empty">
            <p className="gt-empty-title">No repository open</p>
            <p className="gt-empty-detail">
              Choose a repository from the Repositories view, or open a folder containing one.
            </p>
          </div>
        )}

        {active ? (
          <ReviewPane
            key={`${active.id}:${mode}`}
            repoId={active.id}
            mode={mode}
            {...(commit ? { commitHash: commit.hash } : {})}
            revision={repositories.revision}
            onError={setError}
            onSelectionChange={setSelectedPaths}
          />
        ) : (
          <div className="gt-empty" />
        )}
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
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {teaching && <TeachingCard spec={teaching} onClose={() => setTeaching(undefined)} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

/** Kept for the error path in child views. */
export function describeError(error: unknown): string {
  return error instanceof RpcRequestError ? error.displayText : String(error);
}
