import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MergeOperation } from '@shared/model';

/**
 * Detects which multi-step git operation, if any, is in progress by reading
 * the same marker files git itself uses — `src/extension/watch/WatcherHub.ts`
 * already watches `MERGE_HEAD`/`CHERRY_PICK_HEAD`/`REBASE_HEAD` as triggers,
 * but nothing reads their content until now.
 *
 * Pure and fs-only (no git spawn): every value here is available on disk
 * without asking git anything, which keeps this synchronous-in-spirit and
 * unit-testable against a plain temp directory.
 */
export async function detectMergeOperation(gitDir: string): Promise<MergeOperation | undefined> {
  if (await exists(path.join(gitDir, 'MERGE_HEAD'))) {
    return await mergeOperationDetails(gitDir);
  }

  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  if (await exists(rebaseMerge)) {
    return await rebaseOperation(rebaseMerge);
  }

  const rebaseApply = path.join(gitDir, 'rebase-apply');
  if (await exists(rebaseApply)) {
    return await rebaseOperation(rebaseApply);
  }

  const cherryPickHead = await readTrimmed(path.join(gitDir, 'CHERRY_PICK_HEAD'));
  if (cherryPickHead) {
    return { kind: 'cherryPick', incomingRef: cherryPickHead.slice(0, 7) };
  }

  const revertHead = await readTrimmed(path.join(gitDir, 'REVERT_HEAD'));
  if (revertHead) {
    return { kind: 'revert', incomingRef: revertHead.slice(0, 7) };
  }

  return undefined;
}

/** `Merge branch 'feature-x'` / `Merge remote-tracking branch 'origin/feature-x'` → `feature-x`. */
const MERGE_MSG_PATTERN = /^Merge (?:branch|remote-tracking branch) '([^']+)'/;

async function mergeOperationDetails(gitDir: string): Promise<MergeOperation> {
  const message = await readTrimmed(path.join(gitDir, 'MERGE_MSG'));
  const match = message ? MERGE_MSG_PATTERN.exec(message) : null;

  // MERGE_MSG missing or in an unrecognized form (a squash merge, a custom
  // message) — the SHA is still a correct, if less friendly, identifier.
  const incomingRef = match?.[1] ?? (await readTrimmed(path.join(gitDir, 'MERGE_HEAD')))?.slice(0, 7);

  return {
    kind: 'merge',
    ...(incomingRef ? { incomingRef } : {}),
    ...(message ? { mergeMessage: message } : {}),
  };
}

async function rebaseOperation(rebaseDir: string): Promise<MergeOperation> {
  const headName = await readTrimmed(path.join(rebaseDir, 'head-name'));
  const onto = await readTrimmed(path.join(rebaseDir, 'onto'));

  return {
    kind: 'rebase',
    ...(headName ? { incomingRef: stripRefsHeads(headName) } : {}),
    ...(onto ? { ontoRef: onto.slice(0, 7) } : {}),
  };
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

async function readTrimmed(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
