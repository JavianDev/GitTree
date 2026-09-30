/**
 * The keyboard scheme.
 *
 * Two constraints shape it, and both are about living inside another
 * application rather than owning the window:
 *
 *  - **No `Alt`+letter, no `Ctrl`+`Shift`+letter.** On Windows `Alt`+letter opens
 *    the menu bar, and VS Code already claims most `Ctrl`+`Shift` letters. A
 *    webview does not reliably win those fights, so a scheme built on them works
 *    on one machine and fails on the next.
 *  - **Bare letters, which are safe here for a specific reason.** Every git
 *    action opens the editable command sheet instead of executing, so a mistyped
 *    `p` opens a Pull dialog to read and cancel — it does not push. That is what
 *    makes a single-key scheme appropriate for a Git client, where it usually
 *    would not be. `Ctrl+Enter` to commit is the one direct action, and it
 *    already requires a message.
 *
 * The table below is the single source of truth: the matcher reads it, and the
 * shortcuts sheet renders it, so the help cannot drift from the behaviour.
 *
 * This module touches no DOM type on purpose. The test project is compiled with
 * the extension host's config, which has no `lib.dom`, so a stray `HTMLElement`
 * here breaks the host build — and more to the point, a matcher that needs a
 * browser to run is a matcher that cannot be tested properly. The one function
 * that must inspect a real element lives in `useKeyboard.ts` instead.
 */

export type CommandId =
  | 'pane.next'
  | 'pane.prev'
  | 'pane.focus.branches'
  | 'pane.focus.tree'
  | 'pane.focus.review'
  | 'pane.toggle.branches'
  | 'pane.toggle.tree'
  | 'log.toggle'
  | 'help.shortcuts'
  | 'list.next'
  | 'list.prev'
  | 'list.first'
  | 'list.last'
  | 'list.pageDown'
  | 'list.pageUp'
  | 'list.toggleSelect'
  | 'list.extendDown'
  | 'list.extendUp'
  | 'list.selectAll'
  | 'list.activate'
  | 'mode.changes'
  | 'mode.history'
  | 'goto.uncommitted'
  | 'filter.focus'
  | 'search.focus'
  | 'dismiss'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'commit.push'
  | 'review.toggleViewed'
  | 'review.nextFile'
  | 'review.prevFile'
  | 'review.toggleLayout'
  | 'review.toggleWhitespace'
  | 'git.fetch'
  | 'git.pull'
  | 'git.push'
  | 'git.branch'
  | 'git.merge'
  | 'git.stash'
  | 'git.tag'
  | 'terminal.open'
  | 'theme.cycle'
  | 'repo.refresh'
  | 'repo.rescan';

export interface Binding {
  id: CommandId;
  /** Canonical key strings. More than one means the same command has aliases. */
  keys: string[];
  label: string;
  /** Section heading in the shortcuts sheet. */
  group: string;
  /**
   * Fires even while a text field has focus. Reserved for keys that cannot be
   * confused with typing — a bare letter never qualifies.
   */
  whileTyping?: boolean;
}

export const BINDINGS: readonly Binding[] = [
  /* Panes and focus */
  { id: 'pane.next', keys: ['f6'], label: 'Next pane', group: 'Panes', whileTyping: true },
  { id: 'pane.prev', keys: ['shift+f6'], label: 'Previous pane', group: 'Panes', whileTyping: true },
  { id: 'pane.focus.branches', keys: ['ctrl+1'], label: 'Focus Branches', group: 'Panes', whileTyping: true },
  { id: 'pane.focus.tree', keys: ['ctrl+2'], label: 'Focus Commit tree', group: 'Panes', whileTyping: true },
  { id: 'pane.focus.review', keys: ['ctrl+3'], label: 'Focus Review', group: 'Panes', whileTyping: true },
  { id: 'pane.toggle.branches', keys: ['ctrl+alt+1'], label: 'Collapse or expand Branches', group: 'Panes', whileTyping: true },
  { id: 'pane.toggle.tree', keys: ['ctrl+alt+2'], label: 'Collapse or expand Commit tree', group: 'Panes', whileTyping: true },
  { id: 'log.toggle', keys: ['ctrl+\\'], label: 'Toggle command log', group: 'Panes', whileTyping: true },
  { id: 'help.shortcuts', keys: ['?'], label: 'Keyboard shortcuts', group: 'Panes' },

  /* Moving and selecting */
  { id: 'list.next', keys: ['j', 'arrowdown'], label: 'Next row', group: 'Moving' },
  { id: 'list.prev', keys: ['k', 'arrowup'], label: 'Previous row', group: 'Moving' },
  { id: 'list.first', keys: ['home'], label: 'First row', group: 'Moving' },
  { id: 'list.last', keys: ['end'], label: 'Last row', group: 'Moving' },
  { id: 'list.pageDown', keys: ['pagedown'], label: 'Page down', group: 'Moving' },
  { id: 'list.pageUp', keys: ['pageup'], label: 'Page up', group: 'Moving' },
  { id: 'list.toggleSelect', keys: ['space'], label: 'Toggle selection', group: 'Moving' },
  { id: 'list.extendDown', keys: ['shift+arrowdown'], label: 'Extend selection down', group: 'Moving' },
  { id: 'list.extendUp', keys: ['shift+arrowup'], label: 'Extend selection up', group: 'Moving' },
  { id: 'list.selectAll', keys: ['ctrl+a'], label: 'Select all in group', group: 'Moving' },
  { id: 'list.activate', keys: ['enter'], label: 'Check out branch, open commit or file', group: 'Moving' },

  /* Modes and search */
  { id: 'mode.changes', keys: ['g c'], label: 'Changes mode', group: 'Modes' },
  { id: 'mode.history', keys: ['g h'], label: 'History mode', group: 'Modes' },
  { id: 'goto.uncommitted', keys: ['g u'], label: 'Jump to Uncommitted changes', group: 'Modes' },
  { id: 'filter.focus', keys: ['/'], label: 'Focus this pane’s filter', group: 'Modes' },
  { id: 'search.focus', keys: ['ctrl+f'], label: 'Focus commit search', group: 'Modes', whileTyping: true },
  { id: 'dismiss', keys: ['escape'], label: 'Clear filter, close sheet, clear selection', group: 'Modes', whileTyping: true },

  /* Staging and committing */
  { id: 'stage', keys: ['s', 'arrowright'], label: 'Stage selection', group: 'Staging' },
  { id: 'unstage', keys: ['u', 'arrowleft'], label: 'Unstage selection', group: 'Staging' },
  { id: 'discard', keys: ['d'], label: 'Discard selection', group: 'Staging' },
  { id: 'commit', keys: ['ctrl+enter'], label: 'Commit', group: 'Staging', whileTyping: true },
  { id: 'commit.push', keys: ['ctrl+shift+enter'], label: 'Commit & Push', group: 'Staging', whileTyping: true },

  /* Review */
  { id: 'review.toggleViewed', keys: ['v'], label: 'Toggle Viewed', group: 'Review' },
  { id: 'review.nextFile', keys: [']'], label: 'Next file', group: 'Review' },
  { id: 'review.prevFile', keys: ['['], label: 'Previous file', group: 'Review' },
  { id: 'review.toggleLayout', keys: ['ctrl+alt+d'], label: 'Unified or side-by-side diff', group: 'Review', whileTyping: true },
  { id: 'review.toggleWhitespace', keys: ['ctrl+alt+w'], label: 'Toggle whitespace', group: 'Review', whileTyping: true },

  /* Git actions — every one opens the command sheet; nothing runs unprompted */
  { id: 'git.fetch', keys: ['f'], label: 'Fetch…', group: 'Git' },
  { id: 'git.pull', keys: ['p'], label: 'Pull…', group: 'Git' },
  { id: 'git.push', keys: ['shift+p'], label: 'Push…', group: 'Git' },
  { id: 'git.branch', keys: ['b'], label: 'New branch…', group: 'Git' },
  { id: 'git.merge', keys: ['m'], label: 'Merge…', group: 'Git' },
  { id: 'git.stash', keys: ['shift+s'], label: 'Stash…', group: 'Git' },
  { id: 'git.tag', keys: ['t'], label: 'Tag…', group: 'Git' },
  { id: 'terminal.open', keys: ['shift+t'], label: 'Open terminal here', group: 'Git' },
  { id: 'theme.cycle', keys: ['ctrl+alt+t'], label: 'Cycle theme', group: 'Git', whileTyping: true },

  /*
   * Refresh. Automatic refresh covers the normal case, but it can be switched
   * off with `gitTree.autoRefresh`, and a watcher can still miss a change made
   * by a tool that writes outside the workspace — so a manual path has to exist
   * and has to be reachable without hunting for a button.
   */
  { id: 'repo.refresh', keys: ['r', 'f5'], label: 'Refresh now', group: 'Repository' },
  {
    id: 'repo.rescan',
    keys: ['shift+r'],
    label: 'Rescan workspace for repositories',
    group: 'Repository',
  },
];

/** Milliseconds a chord prefix stays armed before it is forgotten. */
export const CHORD_TIMEOUT_MS = 1200;

/** The subset of a KeyboardEvent the matcher needs, so it is testable without a DOM. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type MatchResult =
  | { kind: 'command'; id: CommandId }
  /** A chord prefix was pressed; hold it and wait for the next key. */
  | { kind: 'pending'; prefix: string }
  | { kind: 'none' };

/**
 * Reduces an event to a canonical key string.
 *
 * Punctuation carries its own shift state — `?` is already the shifted `/`, so
 * adding a `shift+` prefix would produce a token no binding could ever name.
 * Letters do not, so `P` becomes `shift+p`.
 */
export function canonicalKey(event: KeyEventLike): string {
  const parts: string[] = [];

  // Meta is folded into ctrl so one table serves both platforms.
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');

  const raw = event.key;
  let token: string;

  if (raw === ' ') {
    token = 'space';
    if (event.shiftKey) parts.push('shift');
  } else if (raw.length === 1) {
    const lower = raw.toLowerCase();
    const isLetter = lower >= 'a' && lower <= 'z';
    if (isLetter && event.shiftKey) parts.push('shift');
    token = lower;
  } else {
    if (event.shiftKey) parts.push('shift');
    token = raw.toLowerCase();
  }

  parts.push(token);
  return parts.join('+');
}

export interface MatchOptions {
  /** Focus is in a text field, so bare keys must not steal the keystroke. */
  typing?: boolean;
  /** Chord prefix currently armed, if any. */
  chord?: string;
}

/** Every chord prefix in the table, e.g. `g`. */
const CHORD_PREFIXES = new Set(
  BINDINGS.flatMap((binding) => binding.keys)
    .filter((key) => key.includes(' '))
    .map((key) => key.split(' ')[0] ?? ''),
);

/**
 * Resolves an event against the table.
 *
 * Pure, and deliberately so: the chord state machine and the typing guard are
 * where a keyboard scheme actually goes wrong, and neither is observable
 * through a rendered component.
 */
export function matchBinding(event: KeyEventLike, options: MatchOptions = {}): MatchResult {
  const key = canonicalKey(event);
  const typing = options.typing ?? false;

  // Mid-chord: only the completion counts, and any miss cancels rather than
  // falling through to a single-key binding the user did not intend.
  if (options.chord) {
    const combined = `${options.chord} ${key}`;
    const chorded = BINDINGS.find((binding) => binding.keys.includes(combined));
    return chorded ? { kind: 'command', id: chorded.id } : { kind: 'none' };
  }

  const binding = BINDINGS.find((entry) => entry.keys.includes(key));

  if (binding) {
    // While typing, a bare letter belongs to the text field. Combinations and
    // the keys explicitly marked safe still fire.
    if (typing && !binding.whileTyping) return { kind: 'none' };
    return { kind: 'command', id: binding.id };
  }

  if (!typing && CHORD_PREFIXES.has(key)) return { kind: 'pending', prefix: key };

  return { kind: 'none' };
}

/** Bindings grouped for the shortcuts sheet, in table order. */
export function bindingGroups(): Array<{ group: string; bindings: Binding[] }> {
  const groups: Array<{ group: string; bindings: Binding[] }> = [];

  for (const binding of BINDINGS) {
    const existing = groups.find((entry) => entry.group === binding.group);
    if (existing) existing.bindings.push(binding);
    else groups.push({ group: binding.group, bindings: [binding] });
  }

  return groups;
}

/**
 * Key strings claimed by more than one command.
 *
 * Exported so a test can assert the table is unambiguous. A scheme this size
 * grows a collision the moment someone adds a binding without reading the rest,
 * and the symptom — one shortcut silently shadowing another — is invisible.
 */
export function collisions(): Array<{ key: string; ids: CommandId[] }> {
  const owners = new Map<string, CommandId[]>();

  for (const binding of BINDINGS) {
    for (const key of binding.keys) {
      const list = owners.get(key) ?? [];
      list.push(binding.id);
      owners.set(key, list);
    }
  }

  return [...owners.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

/** Human-readable form for the shortcuts sheet, e.g. `Ctrl` `Enter` or `g` then `c`. */
export function formatKey(key: string): string[] {
  if (key.includes(' ')) {
    const [prefix, rest] = key.split(' ');
    return [prefix ?? '', 'then', rest ?? ''];
  }

  return key.split('+').map((part) => {
    switch (part) {
      case 'ctrl':
        return 'Ctrl';
      case 'alt':
        return 'Alt';
      case 'shift':
        return 'Shift';
      case 'arrowup':
        return '↑';
      case 'arrowdown':
        return '↓';
      case 'arrowleft':
        return '←';
      case 'arrowright':
        return '→';
      case 'space':
        return 'Space';
      case 'escape':
        return 'Esc';
      case 'enter':
        return 'Enter';
      case 'pageup':
        return 'PgUp';
      case 'pagedown':
        return 'PgDn';
      default:
        return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    }
  });
}
