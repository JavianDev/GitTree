import type { DiffFile, DiffHunk, DiffLine, FileDiffStatus } from '@shared/model';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parses unified diff output into structured files and hunks.
 *
 * Paths are read from the `---` / `+++` / `rename from` / `rename to` lines
 * rather than the `diff --git a/x b/y` header. That header is genuinely
 * ambiguous when a path contains a space — there is no way to know where the
 * `a/` side ends and the `b/` side begins — while the single-path lines are
 * unambiguous by construction.
 */
export function parseDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  // Content lines can legitimately end in \r (a CRLF file diffed on Windows),
  // so only \n terminates a line; the \r belongs to the content.
  const lines = patch.split('\n');

  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;

  const finishFile = () => {
    if (file) files.push(file);
    file = undefined;
    hunk = undefined;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      // Seed from the header so binary diffs and pure mode changes — neither
      // of which emit `---`/`+++` lines — still carry a path. The unambiguous
      // lines below overwrite this whenever they are present.
      const header = parseGitHeaderPaths(line.slice('diff --git '.length));
      file = {
        path: header?.newPath ?? '',
        oldPath: header?.oldPath ?? '',
        status: 'modified',
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!file) continue;

    // Inside a hunk, content lines take precedence: a line of removed source
    // code can legitimately start with "diff --git" or "index ".
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
      const kind: DiffLine['kind'] =
        line[0] === '+' ? 'add' : line[0] === '-' ? 'delete' : 'context';
      const text = line.slice(1);

      const entry: DiffLine = { kind, text };
      if (kind !== 'add') entry.oldNo = oldNo++;
      if (kind !== 'delete') entry.newNo = newNo++;

      if (kind === 'add') file.additions++;
      if (kind === 'delete') file.deletions++;

      hunk.lines.push(entry);
      continue;
    }

    if (line.startsWith('\\')) {
      // `\ No newline at end of file` annotates the line just emitted.
      const last = hunk?.lines[hunk.lines.length - 1];
      if (last) last.noNewline = true;
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      const oldStart = Number(header[1]);
      const oldLines = header[2] === undefined ? 1 : Number(header[2]);
      const newStart = Number(header[3]);
      const newLines = header[4] === undefined ? 1 : Number(header[4]);

      hunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] };
      file.hunks.push(hunk);
      oldNo = oldStart;
      newNo = newStart;
      continue;
    }

    // Everything below is file-level metadata, which only appears before the
    // first hunk.
    if (line.startsWith('--- ')) {
      const path = stripPrefix(line.slice(4));
      if (path !== undefined) file.oldPath = path;
      continue;
    }

    if (line.startsWith('+++ ')) {
      const path = stripPrefix(line.slice(4));
      if (path !== undefined) file.path = path;
      continue;
    }

    if (line.startsWith('rename from ')) {
      file.oldPath = unquotePath(line.slice('rename from '.length));
      file.status = 'renamed';
      continue;
    }

    if (line.startsWith('rename to ')) {
      file.path = unquotePath(line.slice('rename to '.length));
      file.status = 'renamed';
      continue;
    }

    if (line.startsWith('copy from ')) {
      file.oldPath = unquotePath(line.slice('copy from '.length));
      file.status = 'copied';
      continue;
    }

    if (line.startsWith('copy to ')) {
      file.path = unquotePath(line.slice('copy to '.length));
      file.status = 'copied';
      continue;
    }

    if (line.startsWith('new file mode ')) {
      file.status = 'added';
      file.newMode = line.slice('new file mode '.length).trim();
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      file.status = 'deleted';
      file.oldMode = line.slice('deleted file mode '.length).trim();
      continue;
    }

    if (line.startsWith('old mode ')) {
      file.oldMode = line.slice('old mode '.length).trim();
      continue;
    }

    if (line.startsWith('new mode ')) {
      file.newMode = line.slice('new mode '.length).trim();
      if (file.status === 'modified') file.status = 'typechange';
      continue;
    }

    if (line.startsWith('similarity index ') || line.startsWith('dissimilarity index ')) {
      const score = Number(/(\d+)%/.exec(line)?.[1]);
      if (Number.isFinite(score)) file.score = score;
      continue;
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
      continue;
    }
  }

  finishFile();

  for (const entry of files) normalizePaths(entry);
  return files;
}

/**
 * Fills in whichever side `/dev/null` left empty, so consumers always have a
 * usable path for an added or deleted file.
 */
function normalizePaths(file: DiffFile): void {
  if (!file.path && file.oldPath) file.path = file.oldPath;
  if (!file.oldPath && file.path) file.oldPath = file.path;
}

/**
 * Recovers both paths from a `diff --git a/x b/y` header.
 *
 * This header is the one genuinely ambiguous place in the format: with a path
 * like `my file.ts` there is no way to know from delimiters alone where the
 * `a/` side ends. Two cases are resolvable and cover everything in practice:
 *
 *  - Both paths equal, which holds for every non-rename diff. The header is
 *    then `a/P b/P`, so the length of P is fixed by the header length.
 *  - Otherwise fall back to the last ` b/` boundary, which is correct unless a
 *    path literally contains ` b/`.
 *
 * Renames — the case where the two paths genuinely differ — are re-read from
 * the unambiguous `rename from` / `rename to` lines, so a wrong guess here is
 * always corrected.
 */
function parseGitHeaderPaths(rest: string): { oldPath: string; newPath: string } | undefined {
  if (rest.startsWith('"')) {
    // A quoted header; both sides are quoted, so split between `" "`.
    const boundary = rest.indexOf('" "');
    if (boundary === -1) return undefined;
    return {
      oldPath: dropSidePrefix(unquotePath(rest.slice(0, boundary + 1))),
      newPath: dropSidePrefix(unquotePath(rest.slice(boundary + 2))),
    };
  }

  // `a/P b/P` — 5 characters of fixture (`a/`, space, `b/`) plus P twice.
  if ((rest.length - 5) % 2 === 0) {
    const size = (rest.length - 5) / 2;
    const left = rest.slice(0, 2 + size);
    const right = rest.slice(2 + size + 1);
    if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) {
      return { oldPath: left.slice(2), newPath: right.slice(2) };
    }
  }

  const boundary = rest.lastIndexOf(' b/');
  if (boundary === -1) return undefined;

  return {
    oldPath: dropSidePrefix(rest.slice(0, boundary)),
    newPath: dropSidePrefix(rest.slice(boundary + 1)),
  };
}

function dropSidePrefix(value: string): string {
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
}

/**
 * Strips the `a/` or `b/` prefix from a `---` / `+++` path line.
 * Returns undefined for `/dev/null`, which carries no path.
 */
function stripPrefix(raw: string): string | undefined {
  // A tab separates the path from an optional timestamp git never emits, but
  // other producers do.
  const tab = raw.indexOf('\t');
  const value = unquotePath(tab === -1 ? raw : raw.slice(0, tab));

  if (value === '/dev/null') return undefined;
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2);
  return value;
}

/**
 * Reverses git's C-style quoting.
 *
 * With `core.quotepath=false` this only triggers for paths containing control
 * characters, quotes, or backslashes — rare, but a path with a newline in it
 * would otherwise silently truncate.
 */
export function unquotePath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;

  const body = value.slice(1, -1);
  let out = '';

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }

    const next = body[++i];
    switch (next) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case 'a': out += '\x07'; break;
      case '\\': out += '\\'; break;
      case '"': out += '"'; break;
      default: {
        // \NNN octal escape, used for raw bytes.
        const octal = body.slice(i, i + 3);
        if (/^[0-7]{3}$/.test(octal)) {
          out += String.fromCharCode(parseInt(octal, 8));
          i += 2;
        } else if (next !== undefined) {
          out += next;
        }
      }
    }
  }

  return out;
}
