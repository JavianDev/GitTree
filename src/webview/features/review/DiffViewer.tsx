import { useState } from 'react';
import type { DiffFile, DiffHunk, DiffLine, DiffLineKind } from '@shared/model';
import './review.css';

/**
 * The diff surface: line-number gutters, hunk headers, per-file collapse, and
 * a choice of unified or side-by-side.
 *
 * It renders whatever `DiffFile[]` it is handed and owns no fetching, which is
 * what lets the same component show a commit's files in History mode and one
 * file's staged or unstaged side in Changes mode.
 */

export type DiffSide = 'staged' | 'unstaged';
export type DiffLayout = 'unified' | 'split';

const SIDE_LABEL: Record<DiffSide, string> = {
  staged: 'Staged',
  unstaged: 'Unstaged',
};

/** Leading marker per line kind. `−` is U+2212, so it sits at digit width. */
const MARKER: Record<DiffLineKind, string> = {
  add: '+',
  delete: '−',
  context: ' ',
  meta: ' ',
};

export interface DiffViewerProps {
  files: readonly DiffFile[];
  layout: DiffLayout;
  /** Omitted when the pane is too narrow for side by side to be worth offering. */
  onLayout?: (layout: DiffLayout) => void;
  /**
   * Which sides this path exists on. Two entries render the segmented control:
   * a file that is both staged and further edited has two different diffs, and
   * picking one for the user is what the old inspector got wrong.
   */
  sides?: readonly DiffSide[];
  side?: DiffSide;
  onSide?: (side: DiffSide) => void;
  loading?: boolean;
  error?: string;
  /** Shown in place of a diff. Says *why* there is nothing, not just that there isn't. */
  empty?: string;
}

export function DiffViewer({
  files,
  layout,
  onLayout,
  sides,
  side,
  onSide,
  loading,
  error,
  empty,
}: DiffViewerProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (path: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <section className="gt-diff-view" aria-label="Diff">
      <header className="gt-diff-toolbar">
        {sides && sides.length > 1 && (
          <div className="gt-segmented" role="tablist" aria-label="Which side to read">
            {sides.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                className="gt-segment"
                aria-selected={entry === side}
                onClick={() => onSide?.(entry)}
              >
                {SIDE_LABEL[entry]}
              </button>
            ))}
          </div>
        )}

        <span className="gt-review-spacer" />

        {onLayout && (
          <div className="gt-segmented" role="tablist" aria-label="Diff layout">
            <button
              type="button"
              role="tab"
              className="gt-segment"
              aria-selected={layout === 'unified'}
              onClick={() => onLayout('unified')}
            >
              Unified
            </button>
            <button
              type="button"
              role="tab"
              className="gt-segment"
              aria-selected={layout === 'split'}
              onClick={() => onLayout('split')}
            >
              Side by side
            </button>
          </div>
        )}
      </header>

      <div className="gt-diff-scroll">
        {error ? (
          <div className="gt-error" role="alert">
            <strong>Could not load the diff</strong>
            {/* Verbatim: git's own words are the diagnostic. */}
            <pre>{error}</pre>
          </div>
        ) : loading ? (
          <p className="gt-diff-note">Loading…</p>
        ) : files.length === 0 ? (
          <p className="gt-diff-note">{empty ?? 'Nothing to show.'}</p>
        ) : (
          files.map((file) => (
            <FilePatch
              key={file.path}
              file={file}
              layout={layout}
              collapsed={collapsed.has(file.path)}
              onToggle={() => toggle(file.path)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function FilePatch({
  file,
  layout,
  collapsed,
  onToggle,
}: {
  file: DiffFile;
  layout: DiffLayout;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <section className="gt-diff-file">
      <header className="gt-diff-file-header">
        <button
          type="button"
          className="gt-diff-file-toggle"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className="gt-disclosure" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="gt-diff-file-path">{file.path}</span>
        </button>

        {file.oldPath !== file.path && (
          <span className="gt-review-tag">from {file.oldPath}</span>
        )}

        <span className="gt-review-spacer" />

        <span className="gt-review-counts">
          <span className="gt-review-add">+{file.additions}</span>
          <span className="gt-review-del">−{file.deletions}</span>
        </span>
      </header>

      {!collapsed &&
        (file.binary ? (
          <p className="gt-diff-note">Binary file — no textual diff.</p>
        ) : (
          <div className="gt-diff">
            {file.hunks.map((hunk, index) => (
              <Hunk key={`${hunk.oldStart}:${index}`} hunk={hunk} layout={layout} />
            ))}
          </div>
        ))}
    </section>
  );
}

function Hunk({ hunk, layout }: { hunk: DiffHunk; layout: DiffLayout }): React.JSX.Element {
  return (
    <div className="gt-diff-hunk">
      <div className="gt-diff-hunk-header">{hunk.header}</div>

      {layout === 'split'
        ? splitRows(hunk.lines).map((row, index) => (
            <div className="gt-diff-row" key={index}>
              <SplitSide line={row.left} side="old" />
              <SplitSide line={row.right} side="new" />
            </div>
          ))
        : hunk.lines.map((line, index) => (
            <div className="gt-diff-line" data-kind={line.kind} key={index}>
              <span className="gt-diff-lineno">{line.oldNo ?? ''}</span>
              <span className="gt-diff-lineno">{line.newNo ?? ''}</span>
              <span className="gt-diff-text">
                {MARKER[line.kind]}
                {line.text}
                {line.noNewline && <NoNewline />}
              </span>
            </div>
          ))}
    </div>
  );
}

function SplitSide({
  line,
  side,
}: {
  line?: DiffLine;
  side: 'old' | 'new';
}): React.JSX.Element {
  return (
    // `empty` is the filler opposite a one-sided edit. It is tinted as its own
    // thing rather than left blank, so a five-line block replaced by three
    // reads as one change with a gap instead of three changes and two
    // unexplained holes.
    <div className="gt-diff-side" data-kind={line?.kind ?? 'empty'}>
      <span className="gt-diff-lineno">{(side === 'old' ? line?.oldNo : line?.newNo) ?? ''}</span>
      <span className="gt-diff-text">
        {line ? `${MARKER[line.kind]}${line.text}` : ''}
        {line?.noNewline && <NoNewline />}
      </span>
    </div>
  );
}

function NoNewline(): React.JSX.Element {
  return <span className="gt-diff-nonewline"> ⏎ no newline at end of file</span>;
}

/* ------------------------------------------------------------------------ */
/* Side-by-side pairing                                                     */
/* ------------------------------------------------------------------------ */

export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/**
 * Pairs a hunk's lines into side-by-side rows.
 *
 * A run of deletions followed by a run of additions is one edit, so the runs
 * are zipped rather than stacked: the first old line lands beside the first new
 * one. Unequal runs leave the shorter side empty, which is what makes a
 * five-line block replaced by three read as a single change.
 *
 * Exported for its own sake — the pairing is the only real logic in this file
 * and it is worth being able to assert on without a DOM.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;

    if (line.kind !== 'add' && line.kind !== 'delete') {
      // Context appears on both sides with its own two line numbers.
      rows.push({ left: line, right: line });
      index++;
      continue;
    }

    const deletions: DiffLine[] = [];
    while (index < lines.length) {
      const entry = lines[index];
      if (entry?.kind !== 'delete') break;
      deletions.push(entry);
      index++;
    }

    const additions: DiffLine[] = [];
    while (index < lines.length) {
      const entry = lines[index];
      if (entry?.kind !== 'add') break;
      additions.push(entry);
      index++;
    }

    const span = Math.max(deletions.length, additions.length);
    for (let i = 0; i < span; i++) rows.push({ left: deletions[i], right: additions[i] });
  }

  return rows;
}
