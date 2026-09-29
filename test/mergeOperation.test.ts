import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectMergeOperation } from '../src/extension/git/mergeOperation';

describe('detectMergeOperation', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = mkdtempSync(path.join(tmpdir(), 'gittree-mergeop-'));
  });

  afterEach(() => {
    rmSync(gitDir, { recursive: true, force: true });
  });

  it('returns undefined when no operation is in progress', async () => {
    expect(await detectMergeOperation(gitDir)).toBeUndefined();
  });

  it('detects a merge and reads the incoming branch from MERGE_MSG', async () => {
    await writeFile(path.join(gitDir, 'MERGE_HEAD'), 'abc1234567890abc1234567890abc1234567890\n');
    const message = "Merge branch 'feature/sched-fix' into main\n\n# Conflicts:\n#\tscheduler.ts";
    await writeFile(path.join(gitDir, 'MERGE_MSG'), `${message}\n`);

    expect(await detectMergeOperation(gitDir)).toEqual({
      kind: 'merge',
      incomingRef: 'feature/sched-fix',
      mergeMessage: message,
    });
  });

  it('detects a merge of a remote-tracking branch', async () => {
    await writeFile(path.join(gitDir, 'MERGE_HEAD'), 'abc1234567890abc1234567890abc1234567890\n');
    await writeFile(path.join(gitDir, 'MERGE_MSG'), "Merge remote-tracking branch 'origin/main'\n");

    expect((await detectMergeOperation(gitDir))?.incomingRef).toBe('origin/main');
  });

  it('falls back to a short SHA when MERGE_MSG is missing or unrecognized', async () => {
    await writeFile(path.join(gitDir, 'MERGE_HEAD'), 'abc1234567890abc1234567890abc1234567890\n');

    expect(await detectMergeOperation(gitDir)).toEqual({ kind: 'merge', incomingRef: 'abc1234' });
  });

  it('detects a rebase-merge (interactive/merge-based) rebase', async () => {
    const rebaseMerge = path.join(gitDir, 'rebase-merge');
    await mkdir(rebaseMerge);
    await writeFile(path.join(rebaseMerge, 'head-name'), 'refs/heads/feature/sched-fix\n');
    await writeFile(path.join(rebaseMerge, 'onto'), 'def4567890def4567890def4567890def456789\n');

    expect(await detectMergeOperation(gitDir)).toEqual({
      kind: 'rebase',
      incomingRef: 'feature/sched-fix',
      ontoRef: 'def4567',
    });
  });

  it('detects a rebase-apply (am-based) rebase identically', async () => {
    const rebaseApply = path.join(gitDir, 'rebase-apply');
    await mkdir(rebaseApply);
    await writeFile(path.join(rebaseApply, 'head-name'), 'refs/heads/main\n');
    await writeFile(path.join(rebaseApply, 'onto'), '1111111111111111111111111111111111111a\n');

    expect(await detectMergeOperation(gitDir)).toEqual({
      kind: 'rebase',
      incomingRef: 'main',
      ontoRef: '1111111',
    });
  });

  it('prefers rebase-merge over rebase-apply when (implausibly) both exist', async () => {
    await mkdir(path.join(gitDir, 'rebase-merge'));
    await writeFile(path.join(gitDir, 'rebase-merge', 'head-name'), 'refs/heads/from-merge\n');
    await mkdir(path.join(gitDir, 'rebase-apply'));
    await writeFile(path.join(gitDir, 'rebase-apply', 'head-name'), 'refs/heads/from-apply\n');

    expect((await detectMergeOperation(gitDir))?.incomingRef).toBe('from-merge');
  });

  it('detects a cherry-pick and shortens the SHA', async () => {
    await writeFile(path.join(gitDir, 'CHERRY_PICK_HEAD'), 'abc1234567890abc1234567890abc1234567890\n');

    expect(await detectMergeOperation(gitDir)).toEqual({ kind: 'cherryPick', incomingRef: 'abc1234' });
  });

  it('detects a revert and shortens the SHA', async () => {
    await writeFile(path.join(gitDir, 'REVERT_HEAD'), 'def4567890def4567890def4567890def456789\n');

    expect(await detectMergeOperation(gitDir)).toEqual({ kind: 'revert', incomingRef: 'def4567' });
  });

  it('prefers merge over every other kind when MERGE_HEAD exists alongside stale rebase state', async () => {
    // Not a realistic combination in practice, but the precedence order should
    // still be deterministic rather than depend on filesystem read order.
    await writeFile(path.join(gitDir, 'MERGE_HEAD'), 'abc1234567890abc1234567890abc1234567890\n');
    await writeFile(path.join(gitDir, 'MERGE_MSG'), "Merge branch 'x'\n");
    await writeFile(path.join(gitDir, 'CHERRY_PICK_HEAD'), 'def4567890def4567890def4567890def456789\n');

    expect((await detectMergeOperation(gitDir))?.kind).toBe('merge');
  });
});
