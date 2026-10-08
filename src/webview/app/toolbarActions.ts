import { COMMANDS, type CommandContext, type CommandId, type CommandSpec } from '@shared/commands';
import type { RepoState } from '@shared/model';

export interface ToolbarAction {
  spec: CommandSpec;
  context: CommandContext;
  /** Reason the action is unavailable. Present means disabled. */
  disabledReason?: string;
  /** Badge text, e.g. the ahead count on Push. */
  badge?: string;
}

/**
 * What each toolbar button opens its sheet with, and when it is unavailable.
 *
 * Kept out of the shell so the defaults are tested: a pre-ticked flag here is a
 * flag on every run of that command for everyone who doesn't look.
 */
export function toolbarActions(
  state: Pick<RepoState, 'branch' | 'counts'> | undefined,
  pendingCount: number,
  selectedPaths: readonly string[],
): Partial<Record<CommandId, ToolbarAction>> {
  const branch = state?.branch;

  return {
    commit: {
      spec: COMMANDS.commit,
      context: {},
      disabledReason: (state?.counts.staged ?? 0) > 0 ? undefined : 'Stage at least one change first.',
    },
    fetch: { spec: COMMANDS.fetch, context: { prune: true, remote: 'origin' } },
    pull: {
      spec: COMMANDS.pull,
      // Rebase keeps local commits on top; Autostash is offered in the sheet but
      // not ticked — shelving uncommitted work should be a choice, not a default.
      context: { rebase: true, remote: 'origin', branch: branch?.head },
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
}
