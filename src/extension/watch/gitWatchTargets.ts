import path from 'node:path';
import type { RepoNode } from '@shared/model';
import { pathKey } from '../repo/identity';

/** Files inside a git directory whose change means repository state moved. */
export const GIT_FILES = ['HEAD', 'index', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'REVERT_HEAD'];

export interface WatchTarget {
  path: string;
  recursive: boolean;
}

/**
 * What to watch for one repository's git state.
 *
 * Pure, so the linked-worktree case can be tested without `vscode`: a linked
 * worktree's own gitdir (`.git/worktrees/<name>`) holds its HEAD and index but
 * no refs. Its branch moves — a commit, a fetch, a branch created in another
 * worktree — land in the **common** directory, so that directory's `refs/` and
 * `packed-refs` are watched as well. `commonDir/worktrees` is deliberately not
 * watched: on Windows it fires on every git operation in any linked worktree,
 * and the commands Git Tree runs refresh explicitly anyway.
 */
export function gitWatchTargets(node: Pick<RepoNode, 'gitDir' | 'commonDir'>): WatchTarget[] {
  const targets: WatchTarget[] = GIT_FILES.map((file) => ({ path: path.join(node.gitDir, file), recursive: false }));
  // refs/ is small and shallow; recursive here costs one handle, not a tree.
  targets.push({ path: path.join(node.gitDir, 'refs'), recursive: true });

  if (node.commonDir && pathKey(node.commonDir) !== pathKey(node.gitDir)) {
    targets.push({ path: path.join(node.commonDir, 'refs'), recursive: true });
    targets.push({ path: path.join(node.commonDir, 'packed-refs'), recursive: false });
  }

  return targets;
}
