import type { Commit, Identity, RefDecoration, SignatureStatus } from '@shared/model';
import type { LogRequest } from '@shared/protocol';

/** Field separator inside one commit record — the NUL emitted by `%x00`. */
export const FIELD_SEP = '\u0000';
/** Record separator between commits — the RS emitted by `%x1e`. */
export const RECORD_SEP = '\u001e';

/**
 * Commit record layout.
 *
 * Two choices here do real work:
 *
 *  - `%x1e` terminates each record. Newline-delimited formats are ambiguous the
 *    moment a commit message wraps, and most messages wrap.
 *  - `%b` (body without subject) rather than `%B`, so the subject is not
 *    duplicated and the body needs no re-derivation.
 *
 * `%D` is paired with `--decorate=full` below, which yields unambiguous
 * `refs/heads/...` names instead of short names that require guessing whether
 * `origin/main` is a remote branch or a local branch literally named that.
 */
export const LOG_FORMAT =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%G?%x00%s%x00%b%x1e';

const FIELD_COUNT = 13;

/**
 * The format used for the history *list*.
 *
 * Eight fields instead of thirteen, and critically no `%b`. The list renders a
 * subject, an author, a date, and refs — it never shows a commit body, a
 * committer, or a signature, yet the full format streams all of those for every
 * commit. On a 20k-commit repository that is the difference between 6.5 MB and
 * 3.6 MB of output to produce, transfer, and parse, for data that is discarded.
 *
 * The inspector fetches the complete record for the one selected commit via
 * `commitDetails`, which is the only place the missing fields are wanted.
 */
export const LIST_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x1e';

const LIST_FIELD_COUNT = 8;

/** Builds the argv for a history walk that only fills the list. */
export function listArgs(
  request: Pick<LogRequest, 'refs' | 'limit' | 'paths' | 'search' | 'author'> & {
    order?: 'topo' | 'date';
    skip?: number;
  },
): string[] {
  const args = [
    'log',
    // Topological order guarantees a parent never precedes its child, which the
    // incremental lane assignment relies on. Date order is offered because it
    // is measurably faster on large histories and is what SourceTree defaults
    // to, at the cost of occasional rails that run against the flow.
    request.order === 'date' ? '--date-order' : '--topo-order',
    '--decorate=full',
    `--format=${LIST_FORMAT}`,
  ];

  if (request.skip !== undefined && request.skip > 0) args.push(`--skip=${request.skip}`);
  if (request.limit !== undefined) args.push(`--max-count=${request.limit}`);
  if (request.search) args.push(`--grep=${request.search}`);
  if (request.author) args.push(`--author=${request.author}`);

  if (request.refs && request.refs.length > 0) args.push(...request.refs);
  else args.push('--all');

  if (request.paths && request.paths.length > 0) args.push('--', ...request.paths);

  return args;
}

/**
 * Parses one record produced by `LIST_FORMAT`.
 *
 * The fields the list format omits are filled with empty values rather than
 * left undefined, so a list commit and a fully-loaded one share a single type
 * and the UI needs no special case.
 */
export function parseListRecord(record: string, repoId?: string): Commit | undefined {
  const trimmed = record.replace(/^[\r\n]+/, '');
  if (!trimmed) return undefined;

  const fields = trimmed.split(FIELD_SEP);
  if (fields.length < LIST_FIELD_COUNT) return undefined;

  const hash = fields[0] ?? '';
  if (!hash) return undefined;

  const parentField = fields[2] ?? '';
  const author = identity(fields[3], fields[4]);
  const authorDate = fields[5] ?? '';

  return {
    hash,
    shortHash: fields[1] ?? hash.slice(0, 7),
    parents: parentField.length > 0 ? parentField.split(' ').filter(Boolean) : [],
    author,
    authorDate,
    // The list sorts and displays by a single date; carrying the author date in
    // both slots avoids a second field for a value the list never distinguishes.
    committer: author,
    commitDate: authorDate,
    refs: parseDecorations(fields[6] ?? ''),
    signature: 'none',
    subject: fields[7] ?? '',
    body: '',
    ...(repoId ? { repoId } : {}),
  };
}

/** Builds the argv for a history walk. */
export function logArgs(request: Pick<LogRequest, 'refs' | 'limit' | 'paths' | 'search' | 'author'>): string[] {
  const args = [
    'log',
    // Topological order is required for the graph: date order can place a
    // child above its parent, which renders as a rail going backwards.
    '--topo-order',
    '--decorate=full',
    `--format=${LOG_FORMAT}`,
  ];

  if (request.limit !== undefined) args.push(`--max-count=${request.limit}`);
  if (request.search) args.push(`--grep=${request.search}`);
  if (request.author) args.push(`--author=${request.author}`);

  if (request.refs && request.refs.length > 0) {
    args.push(...request.refs);
  } else {
    args.push('--all');
  }

  if (request.paths && request.paths.length > 0) {
    args.push('--', ...request.paths);
  }

  return args;
}

/**
 * Parses one record produced by `LOG_FORMAT`.
 *
 * Returns undefined for records that are empty or malformed rather than
 * throwing: a single unparseable commit should leave a gap in history, not
 * abort the whole walk.
 */
export function parseCommitRecord(record: string, repoId?: string): Commit | undefined {
  // Each `--format` output is followed by a newline, so every record after the
  // first begins with the previous record's line terminator.
  const trimmed = record.replace(/^[\r\n]+/, '');
  if (!trimmed) return undefined;

  const fields = trimmed.split(FIELD_SEP);
  if (fields.length < FIELD_COUNT) return undefined;

  const hash = fields[0] ?? '';
  if (!hash) return undefined;

  const parentField = fields[2] ?? '';

  return {
    hash,
    shortHash: fields[1] ?? hash.slice(0, 7),
    parents: parentField.length > 0 ? parentField.split(' ').filter(Boolean) : [],
    author: identity(fields[3], fields[4]),
    authorDate: fields[5] ?? '',
    committer: identity(fields[6], fields[7]),
    commitDate: fields[8] ?? '',
    refs: parseDecorations(fields[9] ?? ''),
    signature: signatureStatus(fields[10] ?? ''),
    subject: fields[11] ?? '',
    // Trailing newlines are an artifact of the format, not part of the message.
    body: (fields[12] ?? '').replace(/\s+$/, ''),
    ...(repoId ? { repoId } : {}),
  };
}

/** Parses a whole stream of records at once. */
export function parseLog(records: readonly string[], repoId?: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of records) {
    const commit = parseCommitRecord(record, repoId);
    if (commit) commits.push(commit);
  }
  return commits;
}

/* ------------------------------------------------------------------------ */

function identity(name: string | undefined, email: string | undefined): Identity {
  return { name: name ?? '', email: email ?? '' };
}

/**
 * Parses `%D` under `--decorate=full`.
 *
 * Input looks like:
 *   `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0`
 */
export function parseDecorations(field: string): RefDecoration[] {
  if (!field) return [];

  const refs: RefDecoration[] = [];

  for (const raw of field.split(', ')) {
    const entry = raw.trim();
    if (!entry) continue;

    // `HEAD -> refs/heads/main` marks the checked-out branch.
    const arrow = entry.indexOf(' -> ');
    if (arrow !== -1) {
      const target = entry.slice(arrow + 4);
      const ref = decorate(target, true);
      if (ref) refs.push(ref);
      continue;
    }

    if (entry === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD', isHead: true });
      continue;
    }

    // `--decorate=full` still prefixes tags with a literal `tag: `.
    const ref = decorate(entry.startsWith('tag: ') ? entry.slice(5) : entry, false);
    if (ref) refs.push(ref);
  }

  return refs;
}

function decorate(fullRef: string, isHead: boolean): RefDecoration | undefined {
  if (fullRef.startsWith('refs/heads/')) {
    return { kind: 'localBranch', name: fullRef.slice('refs/heads/'.length), isHead };
  }

  if (fullRef.startsWith('refs/remotes/')) {
    const name = fullRef.slice('refs/remotes/'.length);
    const slash = name.indexOf('/');
    return {
      kind: 'remoteBranch',
      name,
      isHead,
      ...(slash > 0 ? { remote: name.slice(0, slash) } : {}),
    };
  }

  if (fullRef.startsWith('refs/tags/')) {
    return { kind: 'tag', name: fullRef.slice('refs/tags/'.length), isHead: false };
  }

  if (fullRef === 'refs/stash') {
    return { kind: 'stash', name: 'stash', isHead: false };
  }

  if (fullRef === 'HEAD') {
    return { kind: 'head', name: 'HEAD', isHead: true };
  }

  // An unrecognized namespace (refs/notes, refs/pull, a custom one) is still
  // worth showing rather than dropping.
  if (fullRef.startsWith('refs/')) {
    return { kind: 'localBranch', name: fullRef.slice('refs/'.length), isHead };
  }

  return undefined;
}

/** Maps `%G?` to a named status. */
function signatureStatus(code: string): SignatureStatus {
  switch (code) {
    case 'G':
      return 'good';
    case 'B':
      return 'bad';
    case 'U':
      return 'unknown-validity';
    case 'X':
      return 'expired';
    case 'Y':
      return 'expired-key';
    case 'R':
      return 'revoked-key';
    case 'E':
      return 'cannot-check';
    default:
      return 'none';
  }
}
