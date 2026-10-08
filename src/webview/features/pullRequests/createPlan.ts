import type { RefEntry } from '@shared/model';

export interface CreatePlan {
  /** The remote the source branch is pushed to. */
  remote: string;
  /** Not on the remote at all (or its remote branch was deleted). */
  unpublished: boolean;
  /** Commits on the source the remote does not have yet. */
  unpushed: number;
  needsPush: boolean;
  pushArgv: string[];
  /** Why Create cannot run yet; undefined when it can. */
  blocked?: string;
}

/**
 * What New Pull Request must do before asking the host: whether the source
 * branch has to be pushed first, and what (if anything) is still missing.
 *
 * A pull request is opened between two branches *on the host*, so a branch that
 * exists only here is pushed first — otherwise GitHub answers "head invalid".
 */
export function createPlan(
  branches: readonly RefEntry[],
  sourceBranch: string,
  targetBranch: string,
  title: string,
): CreatePlan {
  const sourceRef = branches.find((ref) => ref.name === sourceBranch);
  const targetRef = branches.find((ref) => ref.name === targetBranch);
  const remote = sourceRef?.upstream && !sourceRef.gone ? sourceRef.upstream.split('/')[0]! : 'origin';
  const unpublished = sourceRef !== undefined && (!sourceRef.upstream || sourceRef.gone === true);
  const unpushed = sourceRef !== undefined && !unpublished ? (sourceRef.ahead ?? 0) : 0;
  const needsPush = unpublished || unpushed > 0;
  const pushArgv = ['push', ...(unpublished ? ['--set-upstream'] : []), remote, sourceBranch];

  const blocked = !sourceBranch
    ? 'Choose the branch with your changes.'
    : !targetBranch
      ? 'Choose the branch to merge into.'
      : sourceBranch === targetBranch
        ? 'Source and target are the same branch — choose the branch with your changes as the source.'
        : sourceRef && targetRef && sourceRef.oid === targetRef.oid
          ? `${sourceBranch} has no commits that ${targetBranch} doesn’t already have — commit something on it first.`
          : !title.trim()
            ? 'Add a title.'
            : undefined;

  return { remote, unpublished, unpushed, needsPush, pushArgv, ...(blocked ? { blocked } : {}) };
}

/** The default target: a usual default branch that is not the source. */
export function defaultTarget(branches: readonly RefEntry[], source: string | undefined): string | undefined {
  return ['main', 'master'].find((name) => name !== source && branches.some((ref) => ref.name === name));
}
