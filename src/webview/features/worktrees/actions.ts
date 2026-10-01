import type { RefEntry, WorktreeColor, WorktreeEntry, WorktreeOpenTarget } from '@shared/model';
import { WORKTREE_COLORS } from '@shared/model';
import { moveBlocker, removeBlocker } from '@shared/worktrees';
import type { ContextMenuItem } from '../../shared/ContextMenu';

/** Everything a worktree control can ask the shell to do. */
export type WorktreeAction =
  | { kind: 'select'; entry: WorktreeEntry }
  | { kind: 'open'; entry: WorktreeEntry; target: WorktreeOpenTarget }
  | { kind: 'reveal' | 'terminal' | 'copyPath' | 'details' | 'lock' | 'unlock' | 'move' | 'remove'; entry: WorktreeEntry }
  | { kind: 'color'; entry: WorktreeEntry; color: WorktreeColor | null }
  | { kind: 'create'; mode?: 'new' | 'existing'; base?: RefEntry }
  | { kind: 'branchHeld'; ref: RefEntry; entry: WorktreeEntry }
  | { kind: 'cleanupGone'; branches: string[] }
  | { kind: 'refresh' | 'prune' | 'repair' | 'settings' };

export const COLOR_LABEL: Record<WorktreeColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
};

/** The CSS colour token a label maps to. */
export const colorVar = (color: WorktreeColor): string => `var(--gt-${color})`;

const openBlocker = (entry: WorktreeEntry): string | undefined => {
  if (entry.bare) return 'A bare repository has no files to open.';
  if (entry.missing) return 'Its folder is gone.';
  return undefined;
};

/** The worktree row's right-click menu, with disabled items saying why. */
export function worktreeMenu(
  entry: WorktreeEntry,
  run: (action: WorktreeAction) => void,
  options: { canMoveRemove: boolean; onColorMenu?: () => void },
): ContextMenuItem[] {
  const gitTooOld = options.canMoveRemove ? undefined : 'Needs git 2.17 or newer.';
  const items: ContextMenuItem[] = [
    {
      label: 'Open in Git Tree Tab',
      default: true,
      shortcut: 'Enter',
      run: () => run({ kind: 'open', entry, target: 'gitTreeTab' }),
      ...(openBlocker(entry) || entry.isCurrent
        ? { disabled: openBlocker(entry) ?? 'This tab is already showing it.' }
        : {}),
    },
    { label: 'Open in New VS Code Window', run: () => run({ kind: 'open', entry, target: 'newWindow' }), ...withReason(openBlocker(entry)) },
    {
      label: 'Open in This VS Code Window',
      run: () => run({ kind: 'open', entry, target: 'currentWindow' }),
      ...withReason(openBlocker(entry) ?? (entry.openInWindow ? 'It is already open in this window.' : undefined)),
    },
    { label: '', run: () => undefined, separator: true },
    { label: 'Reveal in File Explorer', run: () => run({ kind: 'reveal', entry }) },
    { label: 'Open Terminal Here', run: () => run({ kind: 'terminal', entry }), ...withReason(openBlocker(entry)) },
    { label: 'Copy Path', run: () => run({ kind: 'copyPath', entry }) },
    { label: 'Show Details', run: () => run({ kind: 'details', entry }), ...withReason(entry.bare ? 'A bare repository has no working files.' : undefined) },
    { label: '', run: () => undefined, separator: true },
  ];

  if (options.onColorMenu) {
    items.push({ label: 'Colour Label…', run: options.onColorMenu, hint: 'Choose a colour for this worktree' });
  }
  items.push(
    entry.locked
      ? { label: 'Unlock', run: () => run({ kind: 'unlock', entry }) }
      : {
          label: 'Lock…',
          run: () => run({ kind: 'lock', entry }),
          ...withReason(entry.isMain || entry.bare ? 'git cannot lock the main worktree.' : undefined),
        },
    { label: 'Move…', run: () => run({ kind: 'move', entry }), ...withReason(gitTooOld ?? moveBlocker(entry)) },
    { label: '', run: () => undefined, separator: true },
    { label: 'Remove…', destructive: true, run: () => run({ kind: 'remove', entry }), ...withReason(gitTooOld ?? removeBlocker(entry)) },
  );
  return items;
}

/** Eight colours and "No colour", for the label picker. */
export function colorMenu(entry: WorktreeEntry, run: (action: WorktreeAction) => void): ContextMenuItem[] {
  return [
    ...WORKTREE_COLORS.map((color) => ({
      label: COLOR_LABEL[color] + (entry.color === color ? '  ✓' : ''),
      swatch: colorVar(color),
      run: () => run({ kind: 'color', entry, color }),
    })),
    { label: '', run: () => undefined, separator: true },
    { label: 'No Colour', run: () => run({ kind: 'color', entry, color: null }), ...withReason(entry.color ? undefined : 'It has no colour.') },
  ];
}

function withReason(reason: string | undefined): { disabled?: string } {
  return reason ? { disabled: reason } : {};
}
