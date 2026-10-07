import { rpc } from '../../rpc/client';
import { useMemo, useRef, useState } from 'react';
import type { FileChangeKind } from '@shared/model';
import { FileIcon } from './FileIcon';
import { ContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';
import {
  type FileNode,
  type FileSortMode,
  type ReviewFile,
  buildFileTree,
  flattenFiles,
  sortFiles,
} from './fileTree';
import type { FileSelection } from './useFileSelection';
import './review.css';

/**
 * The review pane's file list: folder rows, per-file line counts, the two-cell
 * state pill, a Viewed checkbox, multi-select, and drag-and-drop staging.
 *
 * The structural work lives in `fileTree.ts` and `useFileSelection.ts`; this
 * file is the shell over them plus the two things that only exist in a DOM —
 * the HTML5 drag payload and the keyboard equivalents of dragging.
 *
 * Named `FileTreeView` rather than `FileTree` because a `FileTree.tsx` beside
 * `fileTree.ts` is unresolvable on a case-insensitive filesystem: TypeScript
 * tries `.ts` before `.tsx`, so `./FileTree` would resolve to the pure module
 * on Windows and this component would never be reachable. The house pattern
 * already separates the two names anyway — `BranchTree.ts` is the model,
 * `ObjectSidebar.tsx` the shell.
 */

/** Single-character glyph per change kind, as the status list has always shown. */
const GLYPH: Record<FileChangeKind, string> = {
  added: 'A',
  copied: 'C',
  conflicted: '!',
  deleted: 'D',
  ignored: 'I',
  modified: 'M',
  renamed: 'R',
  typechange: 'T',
  untracked: '?',
};

const GROUP_IDS = ['conflicted', 'staged', 'unstaged', 'untracked', 'commit'] as const;

/** The working-tree groups a file can be staged into or out of. */
function isWorkingGroup(group: FileGroupId): boolean {
  return group === 'staged' || group === 'unstaged' || group === 'untracked';
}

/**
 * Which list a row belongs to.
 *
 * Part of every row key, because a partially staged file is rendered in *both*
 * working-tree groups. Keyed by path alone the same string would appear twice
 * in the display order, and a shift-range ending on the second copy would stop
 * short at the first.
 */
export type FileGroupId = (typeof GROUP_IDS)[number];

export interface FileGroupInput {
  id: FileGroupId;
  title: string;
  files: readonly ReviewFile[];
}

export interface FileGroupView extends FileGroupInput {
  nodes: FileNode[];
  /** Row keys in display order — the order a shift-range walks. */
  keys: string[];
  additions: number;
  deletions: number;
}

export interface FileRow {
  key: string;
  group: FileGroupId;
  file: ReviewFile;
}

export function rowKey(group: FileGroupId, path: string): string {
  return `${group}:${path}`;
}

/** Strips the group prefix. Stage and unstage take paths, never row keys. */
export function rowPath(key: string): string {
  const separator = key.indexOf(':');
  return separator === -1 ? key : key.slice(separator + 1);
}

/**
 * Turns file lists into renderable groups.
 *
 * `tree` nests by folder; the other sorts render flat, because a list ordered
 * by status and then nested by folder would show neither order. The two agree
 * where they overlap: `sortFiles(files, 'tree')` is exactly the nested order
 * flattened, so switching between them never moves a row past another.
 */
export function buildGroups(
  inputs: readonly FileGroupInput[],
  sort: FileSortMode,
): FileGroupView[] {
  return inputs.map((input) => {
    const nodes: FileNode[] =
      sort === 'tree'
        ? buildFileTree(input.files)
        : sortFiles(input.files, sort).map((file) => ({
            kind: 'leaf',
            // Flat rows carry the whole path: the folder row that would
            // otherwise supply the context is not rendered in this mode.
            name: file.path,
            path: file.path,
            file,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
          }));

    let additions = 0;
    let deletions = 0;
    for (const file of input.files) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }

    return {
      ...input,
      nodes,
      keys: flattenFiles(nodes).map((file) => rowKey(input.id, file.path)),
      additions,
      deletions,
    };
  });
}

/** Every row key across every group, flat and in display order. */
export function groupKeys(groups: readonly FileGroupView[]): string[] {
  return groups.flatMap((group) => group.keys);
}

/** Every folder row's key, for collapse-all. */
export function folderKeys(groups: readonly FileGroupView[]): string[] {
  const keys: string[] = [];
  const walk = (groupId: FileGroupId, nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      keys.push(rowKey(groupId, node.path));
      walk(groupId, node.children);
    }
  };
  for (const group of groups) walk(group.id, group.nodes);
  return keys;
}

export function findRow(
  groups: readonly FileGroupView[],
  key: string | undefined,
): FileRow | undefined {
  if (key === undefined) return undefined;

  for (const group of groups) {
    const file = group.files.find((entry) => rowKey(group.id, entry.path) === key);
    if (file) return { key, group: group.id, file };
  }

  return undefined;
}

/** The first row on screen, for selecting something rather than showing nothing. */
export function firstRow(groups: readonly FileGroupView[]): FileRow | undefined {
  for (const group of groups) {
    const key = group.keys[0];
    if (key !== undefined) return findRow(groups, key);
  }

  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Drag and drop                                                            */
/* ------------------------------------------------------------------------ */

const DRAG_TYPE = 'application/x-gittree-files';

const GITLINK_NOTE =
  'Staging one records an empty gitlink rather than its contents — add it as a submodule instead.';

const NESTED_REASON = `This is a separate repository. ${GITLINK_NOTE}`;

interface DragPayload {
  source: FileGroupId;
  paths: string[];
}

/**
 * The drag in flight.
 *
 * `dataTransfer.getData` is deliberately inert during `dragover` — only the
 * list of types is readable — so a drop target cannot ask what it is being
 * offered until the drop itself. Deciding whether to highlight therefore needs
 * the payload kept alongside, and module scope is the right scope for it
 * because a document can only have one drag in flight.
 */
let inFlight: DragPayload | undefined;

function isGroupId(value: unknown): value is FileGroupId {
  return typeof value === 'string' && GROUP_IDS.some((id) => id === value);
}

function readPayload(event: React.DragEvent<HTMLElement>): DragPayload | undefined {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const candidate: { source?: unknown; paths?: unknown } = parsed;
    if (!isGroupId(candidate.source) || !Array.isArray(candidate.paths)) return undefined;

    return {
      source: candidate.source,
      paths: candidate.paths.filter((entry): entry is string => typeof entry === 'string'),
    };
  } catch {
    // Anything can claim our MIME type. A malformed payload is a dropped drag,
    // not an exception in a webview with no console anyone is watching.
    return undefined;
  }
}

function refusalMessage(paths: readonly string[]): string {
  const subject =
    paths.length === 1
      ? `${paths[0] ?? 'That path'} is`
      : `${paths.length} of those paths are`;

  return `${subject} a separate repository. ${GITLINK_NOTE}`;
}

/* ------------------------------------------------------------------------ */
/* Component                                                                */
/* ------------------------------------------------------------------------ */

export interface FileTreeProps {
  groups: readonly FileGroupView[];
  selection: FileSelection;
  /** The row whose diff is showing. */
  activeKey?: string;
  /** Collapsed folder rows, keyed like file rows so two groups stay independent. */
  collapsed: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
  /** Viewed rows, keyed by row: the staged and unstaged sides are read separately. */
  viewed: ReadonlySet<string>;
  onToggleViewed: (key: string) => void;
  onActivate: (row: FileRow) => void;
  onStage: (paths: readonly string[]) => void;
  onUnstage: (paths: readonly string[]) => void;
  /** Reports a refused drop, with the reason, so it is never silent. */
  onRefuse: (message: string) => void;
  /** Right-click menu actions */
  onDiscard?: (paths: readonly string[]) => void;
  onRemove?: (paths: readonly string[]) => void;
  onStopTracking?: (paths: readonly string[]) => void;
  onIgnore?: (paths: readonly string[]) => void;
  onReveal?: (path: string) => void;
  /** Checks out one side of a conflict wholesale, then stages it as resolved. */
  onResolveOurs?: (paths: readonly string[]) => void;
  onResolveTheirs?: (paths: readonly string[]) => void;
  /** Opens a conflicted file in a normal editor tab for manual resolution. */
  onOpenEditor?: (path: string) => void;
  /** Short branch/ref names for the conflicted-row menu — see `ReviewPane.tsx`'s
   * `mineTheirsLabels`, which gets this right even though the meaning of
   * "mine"/"theirs" reverses during a rebase. Omitted, the menu falls back to
   * generic "Resolve Using Mine"/"Resolve Using Theirs" with no ref name. */
  mineLabel?: string;
  theirsLabel?: string;
  busy?: boolean;
}

export function FileTree({
  groups,
  selection,
  activeKey,
  collapsed,
  onToggleFolder,
  viewed,
  onToggleViewed,
  onActivate,
  onStage,
  onUnstage,
  onRefuse,
  onDiscard,
  onRemove,
  onStopTracking,
  onIgnore,
  onReveal,
  onResolveOurs,
  onResolveTheirs,
  onOpenEditor,
  mineLabel,
  theirsLabel,
  busy,
}: FileTreeProps): React.JSX.Element {
  const treeRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<FileGroupId | undefined>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    key: string;
    group: FileGroupId;
  } | undefined>();

  const byPath = useMemo(() => {
    const map = new Map<string, ReviewFile>();
    for (const group of groups) {
      for (const file of group.files) if (!map.has(file.path)) map.set(file.path, file);
    }
    return map;
  }, [groups]);

  /**
   * Stages, minus anything git would record as an empty gitlink.
   *
   * The nested paths are dropped rather than the whole gesture: refusing all
   * five files because one of them is a nested repository costs the user the
   * selection they just made, and the refusal is reported either way.
   */
  const stage = (paths: readonly string[]): void => {
    const refused = paths.filter((path) => byPath.get(path)?.nestedRepoId !== undefined);
    const allowed = paths.filter((path) => byPath.get(path)?.nestedRepoId === undefined);

    if (refused.length > 0) onRefuse(refusalMessage(refused));
    if (allowed.length > 0) onStage(allowed);
  };

  /**
   * What a gesture on this row acts on: the whole selection when the row is
   * part of it, otherwise just the row — the file-manager rule. Restricted to
   * the row's own group, so dragging out of Unstaged never carries the staged
   * copies of the same paths along with it.
   */
  const actOn = (key: string, group: FileGroupId): string[] => {
    const prefix = `${group}:`;
    const keys = selection.dragging(key).filter((candidate) => candidate.startsWith(prefix));
    return [...new Set((keys.length > 0 ? keys : [key]).map(rowPath))];
  };

  const acceptsDrop = (group: FileGroupId): boolean =>
    isWorkingGroup(group) &&
    inFlight !== undefined &&
    inFlight.source !== group &&
    // Untracked and Changes are the same side of the index: moving between
    // them is not a staging change, so neither accepts the other's drop.
    !(group !== 'staged' && inFlight.source !== 'staged');

  const dragOver = (group: FileGroupId) => (event: React.DragEvent<HTMLElement>) => {
    if (!acceptsDrop(group)) return;

    // preventDefault is what makes an element a drop target at all; without it
    // the browser refuses the drop and shows the "no entry" cursor over it.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== group) setDropTarget(group);
  };

  const dragLeave = (event: React.DragEvent<HTMLElement>): void => {
    // dragleave also fires when the pointer crosses into a child, so clearing
    // unconditionally would flicker the highlight off over every row inside.
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDropTarget(undefined);
  };

  const drop = (group: FileGroupId) => (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropTarget(undefined);

    const payload = readPayload(event) ?? inFlight;
    inFlight = undefined;

    // A drop back onto the group it came from is a no-op rather than a
    // redundant git call, so a mis-aimed drag costs nothing.
    if (!payload || payload.source === group) return;

    if (group === 'staged') stage(payload.paths);
    else if (group === 'unstaged' || group === 'untracked') onUnstage(payload.paths);
  };

  /**
   * Moves focus to the next or previous row.
   *
   * Without it the arrow keys that stage and unstage are only reachable by
   * tabbing through every row above them, which is not keyboard parity.
   */
  const step = (from: HTMLElement, direction: number): void => {
    const root = treeRef.current;
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row-key]'));
    rows[rows.indexOf(from) + direction]?.focus();
  };

  const rowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, row: FileRow): void => {
    switch (event.key) {
      case ' ':
        // Toggle rather than replace: Space is the keyboard's ctrl-click.
        event.preventDefault();
        selection.click(row.key, { ctrl: true });
        return;

      case 'Enter':
        event.preventDefault();
        onActivate(row);
        return;

      // On a file row the horizontal arrows stage and unstage instead of
      // walking the tree. A file has no children to open, and this is the
      // keyboard equivalent of dragging it between the two groups.
      case 'ArrowRight':
        event.preventDefault();
        stage(actOn(row.key, row.group));
        return;

      case 'ArrowLeft':
        event.preventDefault();
        onUnstage(actOn(row.key, row.group));
        return;

      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        step(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        return;

      default:
        return;
    }
  };

  const folderKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    key: string,
    isCollapsed: boolean,
  ): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      // Only in the direction that changes something, so ArrowLeft on an open
      // folder closes it and ArrowLeft again does not reopen it.
      if (isCollapsed === (event.key === 'ArrowRight')) onToggleFolder(key);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleFolder(key);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const renderNodes = (
    group: FileGroupView,
    nodes: readonly FileNode[],
    depth: number,
  ): React.JSX.Element[] =>
    nodes.map((node) => {
      const key = rowKey(group.id, node.path);

      if (node.kind === 'folder') {
        const isCollapsed = collapsed.has(key);

        return (
          <div key={key} role="none">
            <div
              className="gt-review-row gt-review-folder"
              role="treeitem"
              aria-expanded={!isCollapsed}
              // A folder is a row in a multi-selectable tree but is never itself
              // selected: the selection model holds files, which is what stage
              // and unstage take.
              aria-selected={false}
              aria-label={node.path}
              tabIndex={0}
              data-row-key={key}
              style={indent(depth)}
              onClick={() => onToggleFolder(key)}
              onKeyDown={(event) => folderKeyDown(event, key, isCollapsed)}
            >
              <span className="gt-disclosure" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span className="gt-review-name" data-fit>
                {node.name}
              </span>
              <span className="gt-group-count">{node.count}</span>
              <span className="gt-review-spacer" />
              <LineCounts additions={node.additions} deletions={node.deletions} />
            </div>

            {!isCollapsed && renderNodes(group, node.children, depth + 1)}
          </div>
        );
      }

      const file = node.file;
      const row: FileRow = { key, group: group.id, file };
      const staging = isWorkingGroup(group.id);
      const isViewed = viewed.has(key);

      // The cross-reference tag: the same path in the other group is the same
      // file in its other state, not a duplicate row and not a bug.
      const also =
        group.id === 'staged' && file.unstaged
          ? 'also unstaged'
          : (group.id === 'unstaged' || group.id === 'untracked') && file.staged
            ? 'also staged'
            : undefined;

      return (
        <div
          key={key}
          className="gt-review-row"
          role="treeitem"
          aria-selected={selection.isSelected(key)}
          aria-label={file.path}
          tabIndex={0}
          data-row-key={key}
          data-active={activeKey === key ? 'true' : undefined}
          data-viewed={isViewed ? 'true' : undefined}
          style={indent(depth)}
          title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
          // Conflicts and committed files are not draggable: neither has a
          // staging gesture that means what dropping would imply.
          draggable={staging}
          onClick={(event) => {
            selection.click(key, {
              ctrl: event.ctrlKey || event.metaKey,
              shift: event.shiftKey,
            });
            onActivate(row);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!selection.isSelected(key)) selection.click(key);
            setContextMenu({ x: event.clientX, y: event.clientY, key, group: group.id });
          }}
          onDragStart={(event) => {
            const payload: DragPayload = { source: group.id, paths: actOn(key, group.id) };
            inFlight = payload;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
            // A plain-text flavour so the drag still means something when it
            // lands in an editor or a terminal outside the panel.
            event.dataTransfer.setData('text/plain', payload.paths.join('\n'));
          }}
          onDragEnd={() => {
            inFlight = undefined;
            setDropTarget(undefined);
          }}
          onKeyDown={(event) => rowKeyDown(event, row)}
        >
          {staging && (
            <input
              type="checkbox"
              className="gt-stage-check"
              checked={group.id === 'staged'}
              disabled={busy === true || file.nestedRepoId !== undefined}
              title={
                file.nestedRepoId !== undefined
                  ? NESTED_REASON
                  : group.id === 'staged'
                    ? 'Staged — untick to unstage'
                    : 'Tick to stage'
              }
              aria-label={`${group.id === 'staged' ? 'Unstage' : 'Stage'} ${file.path}`}
              onClick={(event) => event.stopPropagation()}
              onChange={() => (group.id === 'staged' ? onUnstage([file.path]) : stage([file.path]))}
            />
          )}

          {group.id === 'conflicted' && (
            <span className="gt-status-glyph" data-kind="conflicted" title="Conflicted" aria-hidden="true">
              {GLYPH.conflicted}
            </span>
          )}

          <FileIcon path={file.path} />
          <span className="gt-review-name" data-kind={file.kind} title={`${file.path} — ${file.kind}`} data-fit>
            {node.name}
          </span>
          {also && <span className="gt-review-tag">{also}</span>}

          <span className="gt-review-spacer" />
          {staging && (group.id === 'staged' || group.id === 'unstaged' || group.id === 'untracked') && file.nestedRepoId === undefined && (
            <button
              type="button"
              className="gt-row-stage"
              data-action={group.id === 'staged' ? 'unstage' : 'stage'}
              disabled={busy === true}
              title={
                group.id === 'staged'
                  ? 'Unstage — take it out of the next commit (also every selected file)'
                  : 'Stage — put it in the next commit (also every selected file)'
              }
              onClick={(event) => {
                event.stopPropagation();
                // A selected row acts for the whole selection, like the context menu.
                const paths = selection.isSelected(key) ? actOn(key, group.id) : [file.path];
                if (group.id === 'staged') onUnstage(paths);
                else stage(paths);
              }}
            >
              {group.id === 'staged' ? '− Unstage' : '+ Stage'}
            </button>
          )}
          {staging && onDiscard && (group.id === 'unstaged' || group.id === 'untracked') && file.nestedRepoId === undefined && (
            <button
              type="button"
              className="gt-row-stage"
              data-action="discard"
              disabled={busy === true}
              title={group.id === 'untracked' ? 'Discard — delete this new file (asks first)' : 'Discard — throw away these changes (asks first)'}
              aria-label={`Discard ${file.path}`}
              onClick={(event) => {
                event.stopPropagation();
                onDiscard(selection.isSelected(key) ? actOn(key, group.id) : [file.path]);
              }}
            >
              ↺ Discard
            </button>
          )}
          <LineCounts additions={node.additions} deletions={node.deletions} />

          {group.id === 'commit' && (
            <label className="gt-review-viewed" title="Mark as viewed">
              <input
                type="checkbox"
                checked={isViewed}
                aria-label={`Mark ${file.path} viewed`}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onToggleViewed(key)}
              />
            </label>
          )}
        </div>
      );
    });

  return (
    <div className="gt-review-groups" ref={treeRef}>
      {groups.map((group) => {
        const bulk = bulkAction(group, stage, onUnstage);

        return (
          <section
            key={group.id}
            className="gt-review-group"
            data-group={group.id}
            data-drop={dropTarget === group.id ? 'true' : undefined}
            aria-label={group.title}
            // The whole group is the drop target, not just its header: a header
            // is a 24px band to aim at, and the highlight tells you which group
            // you are over either way.
            onDragOver={dragOver(group.id)}
            onDragLeave={dragLeave}
            onDrop={drop(group.id)}
          >
            <header className="gt-review-group-header">
              {bulk && (
                <input
                  type="checkbox"
                  className="gt-stage-check"
                  checked={group.id === 'staged' && group.files.length > 0}
                  disabled={busy === true || group.files.length === 0}
                  title={bulk.label}
                  aria-label={bulk.label}
                  onChange={bulk.run}
                />
              )}
              <span className="gt-review-group-title">{group.title}</span>
              <LineCounts additions={group.additions} deletions={group.deletions} />
              <span className="gt-review-spacer" />
              {bulk && group.files.length > 0 && (
                <button
                  type="button"
                  className="gt-group-stage"
                  data-action={group.id === 'staged' ? 'unstage' : 'stage'}
                  disabled={busy === true}
                  onClick={bulk.run}
                >
                  {group.id === 'staged' ? '− ' : '+ '}
                  {bulk.label}
                </button>
              )}
              {onDiscard && (group.id === 'unstaged' || group.id === 'untracked') && group.files.length > 0 && (
                <button
                  type="button"
                  className="gt-group-stage"
                  data-action="discard"
                  disabled={busy === true}
                  title={group.id === 'untracked' ? 'Delete every new file in this section (asks first)' : 'Throw away every change in this section (asks first)'}
                  onClick={() => onDiscard(group.files.map((f) => f.path))}
                >
                  ↺ Discard All
                </button>
              )}
              <span className="gt-review-group-files">
                {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
              </span>
            </header>

            {group.nodes.length === 0 ? (
              <p className="gt-review-group-empty">{EMPTY_TEXT[group.id]}</p>
            ) : (
              <div role="tree" aria-multiselectable="true" aria-label={`${group.title} files`}>
                {renderNodes(group, group.nodes, 0)}
              </div>
            )}
          </section>
        );
      })}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(
            contextMenu.key,
            contextMenu.group,
            groups,
            byPath,
            actOn,
            onStage,
            onUnstage,
            onDiscard,
            onRemove,
            onStopTracking,
            onIgnore,
            onReveal,
            onResolveOurs,
            onResolveTheirs,
            onOpenEditor,
            mineLabel,
            theirsLabel,
          )}
          onClose={() => setContextMenu(undefined)}
        />
      )}
    </div>
  );
}

/** What an empty group says. The staged one doubles as the drop target's label. */
const EMPTY_TEXT: Record<FileGroupId, string> = {
  conflicted: 'No conflicts.',
  staged: 'Nothing staged — tick a file below, or drag it here.',
  unstaged: 'No changes to tracked files.',
  untracked: 'No untracked files.',
  commit: 'This commit changed nothing.',
};

function bulkAction(
  group: FileGroupView,
  stage: (paths: readonly string[]) => void,
  unstage: (paths: readonly string[]) => void,
): { label: string; run: () => void } | undefined {
  // The group's *filtered* files, so "Stage All" under an active filter stages
  // what is on screen. Staging the hidden files too would be a surprise with
  // no undo beyond unstaging them again one by one.
  const all = group.files.map((file) => file.path);

  if (group.id === 'staged') return { label: 'Unstage All', run: () => unstage(all) };
  if (group.id === 'unstaged' || group.id === 'untracked') return { label: 'Stage All', run: () => stage(all) };
  return undefined;
}

function buildContextMenuItems(
  key: string,
  group: FileGroupId,
  groups: readonly FileGroupView[],
  byPath: Map<string, ReviewFile>,
  actOn: (key: string, group: FileGroupId) => string[],
  onStage?: (paths: readonly string[]) => void,
  onUnstage?: (paths: readonly string[]) => void,
  onDiscard?: (paths: readonly string[]) => void,
  onRemove?: (paths: readonly string[]) => void,
  onStopTracking?: (paths: readonly string[]) => void,
  onIgnore?: (paths: readonly string[]) => void,
  onReveal?: (path: string) => void,
  onResolveOurs?: (paths: readonly string[]) => void,
  onResolveTheirs?: (paths: readonly string[]) => void,
  onOpenEditor?: (path: string) => void,
  mineLabel?: string,
  theirsLabel?: string,
): ContextMenuItem[] {
  const paths = actOn(key, group);
  const singlePath = paths.length === 1 ? paths[0] : undefined;
  const files = paths.map((p) => byPath.get(p)).filter((f) => f !== undefined) as ReviewFile[];

  if (files.length === 0) return [];

  if (group === 'conflicted') {
    return buildConflictMenuItems(paths, singlePath, onStage, onResolveOurs, onResolveTheirs, onOpenEditor, mineLabel, theirsLabel);
  }

  const items: ContextMenuItem[] = [];

  // Open (single file only)
  if (singlePath && onOpenEditor) {
    items.push({
      label: 'Open',
      run: () => onOpenEditor(singlePath),
    });
  }

  // Copy Path(s)
  if (paths.length > 0) {
    items.push({
      label: paths.length === 1 ? 'Copy Path' : `Copy Paths`,
      // Through the host: the webview's own clipboard API is not reliable here.
      run: () => void rpc.request('clipboard/write', { text: paths.join('\n'), label: paths.length === 1 ? 'Copied path' : `Copied ${paths.length} paths` }),
    });
  }

  items.push({ label: '', run: () => {}, separator: true });

  // Stage
  if (onStage && files.some((f) => f.unstaged || f.kind === 'untracked')) {
    items.push({
      label: 'Stage',
      run: () => onStage(paths),
    });
  }

  // Unstage
  if (onUnstage && files.some((f) => f.staged)) {
    items.push({
      label: 'Unstage',
      run: () => onUnstage(paths),
    });
  }

  // Discard Changes
  if (onDiscard && files.some((f) => f.unstaged || f.kind === 'untracked')) {
    items.push({
      label: files.every((f) => f.kind === 'untracked') ? 'Discard (Delete)…' : 'Discard Changes…',
      destructive: true,
      // The pane asks before anything is thrown away.
      run: () => onDiscard(paths.filter((p) => { const f = byPath.get(p); return f !== undefined && (f.unstaged || f.kind === 'untracked'); })),
    });
  }

  // Remove
  if (onRemove) {
    items.push({
      label: 'Remove…',
      destructive: true,
      run: () => onRemove(paths),
    });
  }

  // Stop Tracking
  if (onStopTracking && files.every((f) => f.kind !== 'untracked')) {
    items.push({
      label: 'Stop Tracking',
      run: () => onStopTracking(paths),
    });
  }

  // Add to .gitignore
  if (onIgnore && files.every((f) => f.kind === 'untracked')) {
    items.push({
      label: 'Add to .gitignore',
      run: () => onIgnore(paths),
    });
  }

  // Reveal in File Explorer
  if (singlePath && onReveal && paths.length === 1) {
    items.push({
      label: 'Reveal in File Explorer',
      run: () => onReveal(singlePath),
    });
  }

  return items.filter((item) => item.label !== '' || item.separator);
}

/**
 * The conflicted-row menu — deliberately its own item set rather than the
 * generic one above with a few conditions bolted on. "Discard Changes…"
 * would error today (git refuses `restore --worktree` on an unmerged path
 * without `--ours`/`--theirs`/`--merge`) and "Stage" reads oddly for a
 * conflict even though `git add` is in fact the correct resolve-mark, so
 * dropping through to the shared branch was actively wrong here, not just
 * unpolished.
 */
function buildConflictMenuItems(
  paths: readonly string[],
  singlePath: string | undefined,
  onStage: ((paths: readonly string[]) => void) | undefined,
  onResolveOurs: ((paths: readonly string[]) => void) | undefined,
  onResolveTheirs: ((paths: readonly string[]) => void) | undefined,
  onOpenEditor: ((path: string) => void) | undefined,
  mineLabel: string | undefined,
  theirsLabel: string | undefined,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (onResolveOurs) {
    items.push({
      label: mineLabel ? `Resolve Using Mine (${mineLabel})` : 'Resolve Using Mine',
      hint: 'Keeps your side of this conflict and discards the other.',
      run: () => onResolveOurs(paths),
    });
  }

  if (onResolveTheirs) {
    items.push({
      label: theirsLabel ? `Resolve Using Theirs (${theirsLabel})` : 'Resolve Using Theirs',
      hint: 'Keeps the incoming side of this conflict and discards yours.',
      run: () => onResolveTheirs(paths),
    });
  }

  if (singlePath && onOpenEditor) {
    items.push({ label: '', run: () => undefined, separator: true });
    items.push({
      label: 'Open to Resolve Manually',
      hint: 'Edit the conflict markers yourself — VS Code shows Accept Current/Incoming/Both above them.',
      run: () => onOpenEditor(singlePath),
    });
  }

  if (onStage) {
    items.push({ label: '', run: () => undefined, separator: true });
    items.push({
      label: 'Mark as Resolved',
      hint: 'Stages this file as-is — use after editing the conflict markers by hand.',
      run: () => onStage(paths),
    });
  }

  items.push({ label: '', run: () => undefined, separator: true });
  items.push({
    label: paths.length === 1 ? 'Copy Path' : 'Copy Paths',
    run: () => navigator.clipboard.writeText(paths.join('\n')),
  });

  return items.filter((item) => item.label !== '' || item.separator);
}

function LineCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element | null {
  // A row with nothing counted — a binary file, a mode change, or counts that
  // have not arrived from `stats/get` yet — shows nothing rather than a
  // confidently wrong "+0 −0".
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="gt-review-counts">
      <span className="gt-review-add">+{additions}</span>
      <span className="gt-review-del">−{deletions}</span>
    </span>
  );
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `calc(var(--gt-space-3) + ${depth * 12}px)` };
}
