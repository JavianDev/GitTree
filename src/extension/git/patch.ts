import type { DiffFile, DiffHunk, DiffLine } from '@shared/model';
import type { LineSelection } from '@shared/protocol';

/**
 * Builds the synthetic patches that make hunk- and line-level staging work.
 *
 * Everything here is patch arithmetic against `git apply --cached`. Two rules
 * carry all the risk:
 *
 *  1. **Recompute the `@@` counts.** Reusing the original hunk header after
 *     dropping lines is the single most common cause of "corrupt patch at line
 *     N". The counts must be derived from the lines that actually survive.
 *
 *  2. **Unselected lines invert between staging and unstaging.** A patch is
 *     validated against the side git is applying *from*. Staging applies
 *     forward from the index's current content, so an unselected `+` line is
 *     not there yet and must be dropped, while an unselected `-` line is still
 *     there and must be kept as context. Unstaging applies `--reverse` from the
 *     staged content, where exactly the opposite is true. Getting this backwards
 *     produces a patch that applies cleanly and stages the wrong lines.
 */

/** Assembles the `diff --git` / `---` / `+++` preamble for a file. */
export function buildFileHeader(file: DiffFile): string {
  const lines = [`diff --git a/${file.oldPath} b/${file.path}`];

  if (file.status === 'added') {
    lines.push(`new file mode ${file.newMode ?? '100644'}`, '--- /dev/null', `+++ b/${file.path}`);
  } else if (file.status === 'deleted') {
    lines.push(`deleted file mode ${file.oldMode ?? '100644'}`, `--- a/${file.oldPath}`, '+++ /dev/null');
  } else {
    lines.push(`--- a/${file.oldPath}`, `+++ b/${file.path}`);
  }

  return lines.join('\n');
}

/**
 * Renders one hunk, deriving its header from the lines it actually contains.
 *
 * `newStart` is offset by the net line change of every hunk already emitted in
 * this patch, because those hunks shift the post-image.
 */
export function renderHunk(lines: readonly DiffLine[], oldStart: number, newStart: number): string {
  let oldLines = 0;
  let newLines = 0;

  for (const line of lines) {
    if (line.kind !== 'add') oldLines++;
    if (line.kind !== 'delete') newLines++;
  }

  // Git writes `@@ -N +M @@` rather than `-N,1` when a side has exactly one
  // line, and an empty side is written as `-N,0` with N the position before it.
  const oldSpec = oldLines === 1 ? `${oldStart}` : `${oldLines === 0 ? oldStart - 1 : oldStart},${oldLines}`;
  const newSpec = newLines === 1 ? `${newStart}` : `${newLines === 0 ? newStart - 1 : newStart},${newLines}`;

  const body = lines.map((line) => {
    const marker = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ';
    const suffix = line.noNewline ? '\n\\ No newline at end of file' : '';
    return `${marker}${line.text}${suffix}`;
  });

  return [`@@ -${oldSpec} +${newSpec} @@`, ...body].join('\n');
}

/**
 * A patch containing only the named hunks, unchanged.
 *
 * Used for hunk-level staging, where no line filtering happens and only the
 * `newStart` offsets need recomputing.
 */
export function buildHunkPatch(file: DiffFile, hunkIndices: readonly number[]): string {
  const wanted = new Set(hunkIndices);
  const parts: string[] = [];
  let delta = 0;

  for (let i = 0; i < file.hunks.length; i++) {
    const hunk = file.hunks[i];
    if (!hunk || !wanted.has(i)) continue;

    parts.push(renderHunk(hunk.lines, hunk.oldStart, hunk.oldStart + delta));
    delta += countKind(hunk.lines, 'add') - countKind(hunk.lines, 'delete');
  }

  if (parts.length === 0) return '';
  return `${buildFileHeader(file)}\n${parts.join('\n')}\n`;
}

/**
 * A patch containing only the selected lines.
 *
 * `reverse` describes what the patch will be used for — staging (false) or
 * unstaging (true) — and flips how unselected lines are treated. The patch
 * itself is always written forward; the caller passes `--reverse` to git.
 */
export function buildLinePatch(
  file: DiffFile,
  selections: readonly LineSelection[],
  reverse: boolean,
): string {
  const byHunk = new Map<number, Set<number>>();
  for (const selection of selections) {
    const existing = byHunk.get(selection.hunkIndex) ?? new Set<number>();
    for (const index of selection.lineIndices) existing.add(index);
    byHunk.set(selection.hunkIndex, existing);
  }

  const parts: string[] = [];
  let delta = 0;

  for (let i = 0; i < file.hunks.length; i++) {
    const hunk = file.hunks[i];
    const selected = byHunk.get(i);
    if (!hunk || !selected || selected.size === 0) continue;

    const lines = filterHunkLines(hunk, selected, reverse);
    // A hunk left with nothing but context would be a no-op that git rejects.
    if (!lines.some((line) => line.kind !== 'context')) continue;

    parts.push(renderHunk(lines, hunk.oldStart, hunk.oldStart + delta));
    delta += countKind(lines, 'add') - countKind(lines, 'delete');
  }

  if (parts.length === 0) return '';
  return `${buildFileHeader(file)}\n${parts.join('\n')}\n`;
}

/**
 * Applies the selection rules to one hunk.
 *
 * Selected lines keep their marker. Unselected lines either become context or
 * disappear, depending on which side git will validate the patch against.
 */
function filterHunkLines(
  hunk: DiffHunk,
  selected: ReadonlySet<number>,
  reverse: boolean,
): DiffLine[] {
  const out: DiffLine[] = [];

  for (let index = 0; index < hunk.lines.length; index++) {
    const line = hunk.lines[index];
    if (!line) continue;

    if (line.kind === 'context') {
      out.push(line);
      continue;
    }

    if (selected.has(index)) {
      out.push(line);
      continue;
    }

    // Unselected. Whether it survives as context or vanishes depends on which
    // image git is applying from.
    const keepAsContext = reverse ? line.kind === 'add' : line.kind === 'delete';
    if (keepAsContext) {
      out.push({ kind: 'context', text: line.text, oldNo: line.oldNo, newNo: line.newNo });
    }
  }

  return out;
}

function countKind(lines: readonly DiffLine[], kind: DiffLine['kind']): number {
  let total = 0;
  for (const line of lines) if (line.kind === kind) total++;
  return total;
}
