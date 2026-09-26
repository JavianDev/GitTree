import type { RefEntry, RefKind } from '@shared/model';
import { NUL } from '../separators';

/**
 * Ref record layout.
 *
 * `creatordate` rather than `committerdate`: it resolves through an annotated
 * tag to the object it points at, so lightweight and annotated tags both yield
 * a usable date instead of one silently coming back empty.
 */
export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(creatordate:iso-strict)',
  '%(contents:subject)',
].join('%00');

export const REF_ARGS: readonly string[] = [
  'for-each-ref',
  `--format=${REF_FORMAT}`,
  'refs/heads',
  'refs/remotes',
  'refs/tags',
  'refs/stash',
];

/** Parses newline-delimited `for-each-ref` output. */
export function parseRefs(output: string): RefEntry[] {
  const refs: RefEntry[] = [];

  for (const line of output.split('\n')) {
    const entry = parseRefLine(line);
    if (entry) refs.push(entry);
  }

  return refs;
}

function parseRefLine(line: string): RefEntry | undefined {
  const trimmed = line.replace(/[\r\n]+$/, '');
  if (!trimmed) return undefined;

  const fields = trimmed.split(NUL);
  const fullName = fields[0];
  const oid = fields[1];
  if (!fullName || !oid) return undefined;

  const classified = classify(fullName);
  if (!classified) return undefined;

  const track = parseTrack(fields[4] ?? '');
  const upstream = fields[3];

  return {
    kind: classified.kind,
    name: classified.name,
    fullName,
    oid,
    // `%(HEAD)` is `*` for the checked-out branch and a space otherwise.
    isHead: fields[2] === '*',
    ...(classified.remote ? { remote: classified.remote } : {}),
    ...(upstream ? { upstream } : {}),
    ...track,
    ...(fields[5] ? { committedAt: fields[5] } : {}),
    ...(fields[6] ? { subject: fields[6] } : {}),
  };
}

function classify(fullName: string): { kind: RefKind; name: string; remote?: string } | undefined {
  if (fullName.startsWith('refs/heads/')) {
    return { kind: 'localBranch', name: fullName.slice('refs/heads/'.length) };
  }

  if (fullName.startsWith('refs/remotes/')) {
    const name = fullName.slice('refs/remotes/'.length);
    // `origin/HEAD` is a symbolic pointer, not a branch someone can check out.
    if (name.endsWith('/HEAD')) return undefined;

    const slash = name.indexOf('/');
    return {
      kind: 'remoteBranch',
      name,
      ...(slash > 0 ? { remote: name.slice(0, slash) } : {}),
    };
  }

  if (fullName.startsWith('refs/tags/')) {
    return { kind: 'tag', name: fullName.slice('refs/tags/'.length) };
  }

  if (fullName === 'refs/stash') {
    return { kind: 'stash', name: 'stash' };
  }

  return undefined;
}

/**
 * Parses `%(upstream:track)`, which is `[ahead 3, behind 2]`, `[gone]`, or empty.
 */
function parseTrack(field: string): { ahead?: number; behind?: number; gone?: boolean } {
  if (!field) return {};
  if (field.includes('gone')) return { gone: true };

  const ahead = /ahead (\d+)/.exec(field)?.[1];
  const behind = /behind (\d+)/.exec(field)?.[1];

  return {
    ...(ahead ? { ahead: Number(ahead) } : {}),
    ...(behind ? { behind: Number(behind) } : {}),
  };
}
