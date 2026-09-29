import type { StashEntry } from '@shared/model';
import { NUL, RS } from '../separators';

/**
 * Stash record layout — mirrors `log.ts`'s `LIST_FORMAT` convention: NUL between
 * fields, RS terminates each record so a multi-line `-m` message never merges
 * two stashes into one.
 *
 * Written as git's `%x00` / `%x1e` escapes, which git expands in its *output*.
 * The literal characters cannot go in the argument itself: Node refuses to
 * spawn a process whose argv contains a NUL byte, so a format built from real
 * NULs made every `git stash list` throw before git ever ran — and the stash
 * list came back empty with no visible error.
 */
export const STASH_FORMAT = ['%gd', '%H', '%h', '%an', '%ae', '%aI', '%s'].join('%x00') + '%x1e';

const FIELD_COUNT = 7;

export const STASH_ARGS: readonly string[] = ['stash', 'list', `--format=${STASH_FORMAT}`];

/** `WIP on <branch>: <rest>` or `On <branch>: <rest>` — git's default stash subject. */
const SUBJECT_PATTERN = /^(?:WIP on|On) ([^:]+): (.*)$/;

/** Parses `git stash list --format=...` output built from {@link STASH_FORMAT}. */
export function parseStashes(output: string): StashEntry[] {
  const stashes: StashEntry[] = [];

  for (const record of output.split(RS)) {
    const entry = parseStashRecord(record);
    if (entry) stashes.push(entry);
  }

  return stashes;
}

function parseStashRecord(record: string): StashEntry | undefined {
  const trimmed = record.replace(/^\n+/, '');
  if (!trimmed) return undefined;

  const fields = trimmed.split(NUL);
  if (fields.length < FIELD_COUNT) return undefined;

  const [ref, oid, shortOid, authorName, authorEmail, createdAt, subject] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!ref || !oid) return undefined;

  const indexMatch = /^stash@\{(\d+)\}$/.exec(ref);
  const index = indexMatch?.[1] ? Number(indexMatch[1]) : 0;

  const match = SUBJECT_PATTERN.exec(subject);

  return {
    ref,
    index,
    oid,
    shortOid: shortOid || oid.slice(0, 7),
    author: { name: authorName, email: authorEmail },
    createdAt,
    ...(match?.[1] ? { branch: match[1] } : {}),
    message: match?.[2] ?? subject,
  };
}
