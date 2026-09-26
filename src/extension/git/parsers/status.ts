import type {
  BranchInfo,
  ConflictStages,
  FileChangeKind,
  FileStatus,
  StatusLetter,
  SubmoduleState,
} from '@shared/model';

/**
 * Arguments for the status invocation this parser expects.
 *
 * `-z` is what makes paths containing newlines survive, and it is also what
 * changes the rename record's shape — see `parseStatus`.
 */
export const STATUS_ARGS: readonly string[] = [
  'status',
  '--porcelain=v2',
  '-z',
  '--branch',
  '--untracked-files=all',
];

export interface ParsedStatus {
  branch: BranchInfo;
  files: FileStatus[];
}

const EMPTY_BRANCH: BranchInfo = { detached: false, ahead: 0, behind: 0 };

/**
 * Parses NUL-delimited `status --porcelain=v2 -z` records.
 *
 * The one shape that catches every implementation: under `-z`, a rename or copy
 * record (`2 ...`) does **not** carry its original path tab-separated inside
 * the record. The record ends after the new path, and the original path arrives
 * as the *next* NUL-terminated field. A parser that treats every field as one
 * record silently reads the original path as a bogus status entry, and every
 * subsequent record is off by one.
 */
export function parseStatus(records: readonly string[]): ParsedStatus {
  let branch: BranchInfo = { ...EMPTY_BRANCH };
  const files: FileStatus[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    switch (record[0]) {
      case '#': {
        branch = applyHeader(branch, record);
        break;
      }

      case '1': {
        const entry = parseOrdinary(record);
        if (entry) files.push(entry);
        break;
      }

      case '2': {
        // Consume the following field as the rename/copy source.
        const origPath = records[i + 1];
        const entry = parseRenamed(record, origPath ?? '');
        if (entry) {
          files.push(entry);
          i++;
        }
        break;
      }

      case 'u': {
        const entry = parseUnmerged(record);
        if (entry) files.push(entry);
        break;
      }

      case '?':
      case '!': {
        const path = record.slice(2);
        if (!path) break;
        const untracked = record[0] === '?';
        // Untracked and ignored entries have no XY code of their own; `kind`
        // carries the distinction and both positions stay unmodified.
        files.push({
          path,
          index: '.',
          worktree: '.',
          kind: untracked ? 'untracked' : 'ignored',
          staged: false,
          unstaged: untracked,
          conflicted: false,
        });
        break;
      }

      default:
        // Unknown record types are skipped rather than fatal, so a future git
        // adding a line type degrades to "not shown" instead of "no status".
        break;
    }
  }

  return { branch, files };
}

/* ------------------------------------------------------------------------ */

function applyHeader(branch: BranchInfo, record: string): BranchInfo {
  const space = record.indexOf(' ', 2);
  const key = space === -1 ? record.slice(2) : record.slice(2, space);
  const value = space === -1 ? '' : record.slice(space + 1);

  switch (key) {
    case 'branch.oid':
      // `(initial)` means an unborn branch — a repo with no commits yet.
      return value === '(initial)' ? branch : { ...branch, oid: value };

    case 'branch.head':
      return value === '(detached)'
        ? { ...branch, detached: true, head: undefined }
        : { ...branch, detached: false, head: value };

    case 'branch.upstream':
      return { ...branch, upstream: value };

    case 'branch.ab': {
      const match = /^\+(\d+) -(\d+)$/.exec(value);
      if (!match) return branch;
      return { ...branch, ahead: Number(match[1]), behind: Number(match[2]) };
    }

    default:
      return branch;
  }
}

/**
 * Splits the first `count` space-delimited fields, returning the untouched
 * remainder. Paths may contain spaces, so the tail is never split.
 */
function splitFields(record: string, count: number): { fields: string[]; rest: string } | undefined {
  const fields: string[] = [];
  let pos = 0;

  for (let i = 0; i < count; i++) {
    const next = record.indexOf(' ', pos);
    if (next === -1) return undefined;
    fields.push(record.slice(pos, next));
    pos = next + 1;
  }

  return { fields, rest: record.slice(pos) };
}

/** `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` */
function parseOrdinary(record: string): FileStatus | undefined {
  const split = splitFields(record, 8);
  if (!split || !split.rest) return undefined;

  const xy = split.fields[1] ?? '..';
  const sub = split.fields[2] ?? 'N...';
  const index = letter(xy[0]);
  const worktree = letter(xy[1]);

  return {
    path: split.rest,
    index,
    worktree,
    kind: kindFor(index, worktree),
    staged: index !== '.',
    unstaged: worktree !== '.',
    conflicted: false,
    ...withSubmodule(sub),
  };
}

/** `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` + NUL + `<origPath>` */
function parseRenamed(record: string, origPath: string): FileStatus | undefined {
  const split = splitFields(record, 9);
  if (!split || !split.rest) return undefined;

  const xy = split.fields[1] ?? '..';
  const sub = split.fields[2] ?? 'N...';
  const rename = split.fields[8] ?? 'R100';
  const index = letter(xy[0]);
  const worktree = letter(xy[1]);
  const score = Number(rename.slice(1));

  return {
    path: split.rest,
    origPath,
    index,
    worktree,
    kind: rename[0] === 'C' ? 'copied' : 'renamed',
    staged: index !== '.',
    unstaged: worktree !== '.',
    conflicted: false,
    score: Number.isFinite(score) ? score : undefined,
    ...withSubmodule(sub),
  };
}

/**
 * `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
 *
 * All three stages are surfaced, including the absent ones: an add/add conflict
 * has no merge base, and a resolver that assumes stage 1 exists will crash on
 * exactly the conflicts users most need help with.
 */
function parseUnmerged(record: string): FileStatus | undefined {
  const split = splitFields(record, 10);
  if (!split || !split.rest) return undefined;

  const xy = split.fields[1] ?? 'UU';
  const sub = split.fields[2] ?? 'N...';

  const conflict: ConflictStages = { code: xy };
  const stages = [
    { key: 'base', mode: split.fields[3], oid: split.fields[7] },
    { key: 'ours', mode: split.fields[4], oid: split.fields[8] },
    { key: 'theirs', mode: split.fields[5], oid: split.fields[9] },
  ] as const;

  for (const stage of stages) {
    // Mode `000000` means the stage is absent from the index.
    if (!stage.mode || stage.mode === '000000' || !stage.oid) continue;
    conflict[stage.key] = { mode: stage.mode, oid: stage.oid };
  }

  return {
    path: split.rest,
    index: letter(xy[0]),
    worktree: letter(xy[1]),
    kind: 'conflicted',
    staged: false,
    unstaged: true,
    conflicted: true,
    conflict,
    ...withSubmodule(sub),
  };
}

/** `N...` means "not a submodule"; `S<c><m><u>` describes one. */
function parseSubmodule(field: string): SubmoduleState | undefined {
  if (field[0] !== 'S') return undefined;
  return {
    commitChanged: field[1] === 'C',
    hasModifiedTracked: field[2] === 'M',
    hasUntracked: field[3] === 'U',
  };
}

function withSubmodule(field: string): { submodule?: SubmoduleState } {
  const submodule = parseSubmodule(field);
  return submodule ? { submodule } : {};
}

function letter(char: string | undefined): StatusLetter {
  switch (char) {
    case 'M':
    case 'T':
    case 'A':
    case 'D':
    case 'R':
    case 'C':
    case 'U':
      return char;
    default:
      return '.';
  }
}

/**
 * Reduces the two-position `XY` code to a single primary change.
 *
 * The index position wins when both are set: a file staged as added and then
 * modified in the worktree reads as "added", which is what the user did to it.
 */
function kindFor(index: StatusLetter, worktree: StatusLetter): FileChangeKind {
  const primary = index !== '.' ? index : worktree;
  switch (primary) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case 'U':
      return 'conflicted';
    default:
      return 'modified';
  }
}
