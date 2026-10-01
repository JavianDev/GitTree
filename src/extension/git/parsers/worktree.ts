import { NUL } from '../separators';

/**
 * `git worktree list --porcelain -z` (git 2.36+).
 *
 * `-z` ends every attribute with NUL instead of a newline and ends each record
 * with an empty attribute, so a lock reason containing a newline survives.
 */
export const WORKTREE_LIST_ARGS: readonly string[] = ['worktree', 'list', '--porcelain', '-z'];

/** The same listing for git older than 2.36: newline-separated, blank line between records. */
export const WORKTREE_LIST_ARGS_LEGACY: readonly string[] = ['worktree', 'list', '--porcelain'];

/**
 * One `git status` per worktree row. `--untracked-files=normal` collapses an
 * untracked directory to one entry, which keeps a row's count cheap to read.
 */
export const WORKTREE_SUMMARY_ARGS: readonly string[] = [
  'status',
  '--porcelain=v2',
  '-z',
  '--branch',
  '--untracked-files=normal',
];

/**
 * Untracked and ignored entries, collapsed to directories: what a worktree copy
 * may take. With no exclude options, `--others` lists ignored files too, which
 * is the point — `.env` and `.venv` are usually ignored.
 */
export const UNTRACKED_ENTRIES_ARGS: readonly string[] = ['ls-files', '-z', '--others', '--directory'];

export interface WorktreeRecord {
  /** As git printed it (forward slashes on Windows too). */
  path: string;
  head?: string;
  /** Full ref, e.g. `refs/heads/feature/login`. */
  branchRef?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  prunableReason?: string;
}

/**
 * Parses either listing format.
 *
 * The first record is always the main worktree (or, for a bare repository, the
 * repository itself). Unknown attributes are ignored, so a newer git adding
 * one does not break the list.
 */
export function parseWorktreeList(output: string, nulTerminated: boolean): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | undefined;

  const fields = nulTerminated ? output.split(NUL) : output.replace(/\r/g, '').split('\n');

  for (const field of fields) {
    if (field === '') {
      if (current) records.push(current);
      current = undefined;
      continue;
    }

    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? undefined : field.slice(space + 1);

    if (key === 'worktree') {
      if (current) records.push(current);
      current = { path: value ?? '', bare: false, detached: false, locked: false, prunable: false };
      continue;
    }
    if (!current) continue;

    switch (key) {
      case 'HEAD':
        if (value) current.head = value;
        break;
      case 'branch':
        if (value) current.branchRef = value;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        if (value) current.lockReason = nulTerminated ? value : unquote(value);
        break;
      case 'prunable':
        current.prunable = true;
        if (value) current.prunableReason = nulTerminated ? value : unquote(value);
        break;
      default:
        break;
    }
  }

  if (current) records.push(current);
  return records;
}

/** `refs/heads/feature/login` → `feature/login`. */
export function shortBranch(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

/**
 * Undoes git's C-style quoting, used in the newline format for a reason that
 * contains a newline or quote: `"line one\nline two"`.
 */
function unquote(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) return value;

  const body = value.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };

  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const next = body[index + 1] ?? '';
    if (/[0-7]/.test(next)) {
      const octal = body.slice(index + 1, index + 4);
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}
