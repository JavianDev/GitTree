import type { DiffFile, DiffLine } from '@shared/model';

/** Beyond this, the rest is summarized rather than shipped to the webview line by line. */
export const MAX_UNTRACKED_LINES = 5000;

/** Git's own heuristic: a NUL in the first 8000 bytes means binary. */
const BINARY_PROBE_BYTES = 8000;

/**
 * An untracked file as an all-added diff.
 *
 * Git has nothing to diff a path it isn't tracking against, so the content is
 * read from disk and shaped the way `git diff` would show a newly added file.
 * Built here rather than with `git diff --no-index /dev/null <path>`, whose
 * null-device handling differs between Git for Windows and everything else.
 */
export function synthesizeAddedFile(path: string, content: Buffer): DiffFile {
  const empty: DiffFile = {
    path,
    oldPath: path,
    status: 'added',
    binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  };

  if (content.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { ...empty, binary: true };
  if (content.length === 0) return empty;

  const text = content.toString('utf8');
  const endsWithNewline = text.endsWith('\n');
  const rawLines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  const total = rawLines.length;
  const shown = Math.min(total, MAX_UNTRACKED_LINES);

  const lines: DiffLine[] = rawLines.slice(0, shown).map((line, index) => ({
    kind: 'add',
    newNo: index + 1,
    text: line.endsWith('\r') ? line.slice(0, -1) : line,
  }));

  if (!endsWithNewline && shown === total) {
    const last = lines[lines.length - 1];
    if (last) last.noNewline = true;
  }

  if (shown < total) {
    lines.push({ kind: 'meta', text: `… ${total - shown} more lines not shown` });
  }

  return {
    ...empty,
    hunks: [
      {
        header: `@@ -0,0 +1,${total} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: total,
        lines,
      },
    ],
    additions: total,
  };
}
