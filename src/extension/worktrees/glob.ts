/**
 * The glob subset worktree copy patterns use. No dependency: the host bundle
 * may only require Node built-ins, and VS Code's Node has no `fs.glob`.
 *
 * Patterns are relative to the repository root, with forward slashes:
 *  - `*` and `?` match within one path segment; `**` matches any number of segments;
 *  - `[abc]` / `[!abc]` match one character; `{a,b}` matches either word (no nesting);
 *  - a trailing `/` matches directories only; a leading `/` is allowed and ignored;
 *  - no implicit "any depth": `.env` is the root `.env`, `**\/.env` is every `.env`.
 * Patterns that climb out (`..`) or are absolute are rejected.
 */

export interface CompiledGlob {
  pattern: string;
  /** Leading segments with no wildcard: a directory that cannot contain a match can be skipped. */
  prefix: string;
  /** Starts with `**`, so it can match at any depth. */
  anyDepth: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

export type GlobResult = { ok: true; glob: CompiledGlob } | { ok: false; pattern: string; error: string };

const SPECIAL = /[.+^$()|\\]/g;

export function compileGlob(input: string, caseInsensitive: boolean): GlobResult {
  let pattern = input.trim().replace(/\\/g, '/');
  if (!pattern) return { ok: false, pattern: input, error: 'empty pattern' };
  if (/^[A-Za-z]:/.test(pattern)) return { ok: false, pattern: input, error: 'patterns are relative to the repository' };

  const dirOnly = pattern.endsWith('/');
  pattern = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = pattern.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return { ok: false, pattern: input, error: 'empty pattern' };
  if (segments.includes('..') || segments.includes('.')) {
    return { ok: false, pattern: input, error: 'patterns cannot contain . or .. segments' };
  }

  let source = '^';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segmentSource(segment) + (last ? '' : '/');
  });
  source += '$';

  const prefixSegments: string[] = [];
  for (const segment of segments) {
    if (/[*?[{]/.test(segment)) break;
    prefixSegments.push(segment);
  }

  return {
    ok: true,
    glob: {
      pattern: input,
      prefix: prefixSegments.join('/'),
      anyDepth: segments[0] === '**',
      dirOnly,
      regex: new RegExp(source, caseInsensitive ? 'i' : ''),
    },
  };
}

function segmentSource(segment: string): string {
  let out = '';
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!;
    if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '[') {
      const close = segment.indexOf(']', index + 1);
      if (close === -1) {
        out += '\\[';
        continue;
      }
      let body = segment.slice(index + 1, close).replace(/\\/g, '\\\\');
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body}]`;
      index = close;
    } else if (char === '{') {
      const close = segment.indexOf('}', index + 1);
      if (close === -1) {
        out += '\\{';
        continue;
      }
      const words = segment.slice(index + 1, close).split(',').map((word) => word.replace(SPECIAL, '\\$&').replace(/\*/g, '[^/]*'));
      out += `(?:${words.join('|')})`;
      index = close;
    } else {
      out += char.replace(SPECIAL, '\\$&');
    }
  }
  return out;
}

/** True when `path` (relative, forward slashes, no trailing slash) matches. */
export function globMatches(glob: CompiledGlob, path: string, isDirectory: boolean): boolean {
  if (glob.dirOnly && !isDirectory) return false;
  return glob.regex.test(path);
}

/**
 * Whether anything inside directory `dir` could match: decides whether a copy
 * walks into a folder git listed as one collapsed entry.
 */
export function globCouldMatchInside(glob: CompiledGlob, dir: string, caseInsensitive: boolean): boolean {
  if (glob.anyDepth) return true;
  const a = caseInsensitive ? glob.prefix.toLowerCase() : glob.prefix;
  const d = caseInsensitive ? dir.toLowerCase() : dir;
  return a.startsWith(`${d}/`) || (a === d && glob.prefix !== '');
}

/** Splits include patterns from `!` negations, which behave as excludes. */
export function partitionPatterns(
  include: readonly string[],
  exclude: readonly string[],
  caseInsensitive: boolean,
): { include: CompiledGlob[]; exclude: CompiledGlob[]; invalid: string[] } {
  const result = { include: [] as CompiledGlob[], exclude: [] as CompiledGlob[], invalid: [] as string[] };

  const add = (pattern: string, into: CompiledGlob[]) => {
    const compiled = compileGlob(pattern, caseInsensitive);
    if (compiled.ok) into.push(compiled.glob);
    else result.invalid.push(`${pattern} — ${compiled.error}`);
  };

  for (const pattern of include) {
    if (pattern.trim().startsWith('!')) add(pattern.trim().slice(1), result.exclude);
    else add(pattern, result.include);
  }
  for (const pattern of exclude) add(pattern, result.exclude);
  return result;
}
