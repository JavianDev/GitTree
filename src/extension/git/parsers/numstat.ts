import type { FileStats } from '@shared/model';
import { NUL } from '../separators';

/**
 * Arguments for the numstat invocation this parser expects.
 *
 * `-z` is what makes paths containing newlines survive, and it is also what
 * changes the rename record's shape — see `parseNumstat`.
 */
export const NUMSTAT_ARGS: readonly string[] = ['diff', '--numstat', '-z'];

export interface NumstatRequest {
  /** Count the index against HEAD (`--cached`) rather than the working tree. */
  staged?: boolean;
  /** Restrict counting to these paths. */
  paths?: readonly string[];
}

/** Builds the argv for a per-file line count. */
export function numstatArgs(request: NumstatRequest = {}): string[] {
  const args = [...NUMSTAT_ARGS];

  if (request.staged) args.push('--cached');

  // `--` keeps a path from being read as a revision. A branch and a file may
  // share a name, and git resolves that ambiguity in the revision's favour.
  if (request.paths && request.paths.length > 0) args.push('--', ...request.paths);

  return args;
}

/**
 * Parses NUL-delimited `diff --numstat -z` output.
 *
 * Two shapes catch every implementation:
 *
 *  - A **rename** does not carry both of its paths inside one record. The
 *    counts are followed by an *empty* path field, and the source and then the
 *    destination arrive as the next two NUL-terminated fields. This is the same
 *    off-by-one trap as a porcelain v2 rename in `status.ts`: a parser that
 *    treats every field as a record reads the two paths as bogus entries and
 *    everything after them shifts.
 *  - A **binary** file reports `-` for both counts rather than a number, so the
 *    obvious `Number(field)` yields NaN — and a single NaN poisons every total
 *    it is summed into, which is the header of the review pane.
 *
 * The whole output is taken at once rather than a record at a time, because a
 * rename spans three records and a per-record caller could not pair them.
 */
export function parseNumstat(output: string): FileStats[] {
  const fields = output.split(NUL);
  const stats: FileStats[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;

    const entry = parseRecord(field);
    // Malformed records are skipped rather than fatal, so one unreadable line
    // costs its own file's counts instead of every file's.
    if (!entry) continue;

    if (entry.path) {
      stats.push(entry);
      continue;
    }

    // Empty path field: source and destination follow as their own records.
    const oldPath = fields[i + 1];
    const path = fields[i + 2];
    if (!oldPath || !path) continue;

    i += 2;
    stats.push({ ...entry, path, oldPath });
  }

  return stats;
}

/* ------------------------------------------------------------------------ */

/** `<added>\t<deleted>\t<path>`, with an empty path on a rename or copy. */
function parseRecord(record: string): FileStats | undefined {
  const firstTab = record.indexOf('\t');
  if (firstTab === -1) return undefined;

  const secondTab = record.indexOf('\t', firstTab + 1);
  if (secondTab === -1) return undefined;

  const addedField = record.slice(0, firstTab);
  const deletedField = record.slice(firstTab + 1, secondTab);
  // Paths may contain tabs, so the remainder is never split further.
  const path = record.slice(secondTab + 1);

  // Binary is a state of its own, not a pair of unparseable numbers: the counts
  // are reported as zero so totals stay arithmetic, and `binary` says why.
  if (addedField === '-' || deletedField === '-') {
    return { path, added: 0, deleted: 0, binary: true };
  }

  const added = decimal(addedField);
  const deleted = decimal(deletedField);
  if (added === undefined || deleted === undefined) return undefined;

  return { path, added, deleted, binary: false };
}

/** Rejects anything that is not a plain decimal, so nothing becomes NaN. */
function decimal(field: string): number | undefined {
  return /^\d+$/.test(field) ? Number(field) : undefined;
}
