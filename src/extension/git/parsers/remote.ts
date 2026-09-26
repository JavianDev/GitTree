import type { GitRemote } from '@shared/model';

export const REMOTE_ARGS: readonly string[] = ['remote', '-v'];

type Direction = 'fetch' | 'push';

/**
 * One line of `remote -v`: name, whitespace, URL, then the direction marker.
 *
 * The URL is taken as everything up to the *final* marker rather than by
 * splitting on whitespace, because a local remote is an ordinary path and may
 * well contain spaces — `C:/My Repos/upstream.git` is a valid remote, not a
 * malformed line.
 */
const LINE = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/;

/** The URLs seen for one remote, before the two directions are collapsed. */
interface RemoteUrls {
  fetch?: string;
  push?: string;
  /** First URL seen, whichever direction announced it. */
  fallback: string;
}

/**
 * Collapses the two lines `remote -v` prints per remote into one entry each.
 *
 * The lines cannot simply be de-duplicated by name: a remote that fetches over
 * HTTPS and pushes over SSH is a real, common configuration, and flattening it
 * would present the push destination as the fetch one.
 *
 * When only one direction is listed the other mirrors it, which is what git
 * itself does — with no `remote.<name>.pushurl` set, pushes go to the fetch
 * URL. An empty field would instead read as "no push URL", which is the
 * opposite of the truth.
 */
export function parseRemotes(output: string): GitRemote[] {
  const collected = new Map<string, RemoteUrls>();

  for (const raw of output.split('\n')) {
    const match = LINE.exec(raw.replace(/[\r\n]+$/, ''));
    if (!match) continue;

    const name = match[1];
    const url = match[2];
    if (!name || !url) continue;

    // The pattern admits no third alternative.
    const direction: Direction = match[3] === 'push' ? 'push' : 'fetch';

    const existing = collected.get(name);
    if (!existing) {
      collected.set(name, {
        fallback: url,
        ...(direction === 'fetch' ? { fetch: url } : { push: url }),
      });
      continue;
    }

    // A remote may list several URLs for one direction — git pushes to all of
    // them — and the first is the one shown, so adding a mirror does not
    // change which URL an existing row displays.
    if (existing[direction] === undefined) existing[direction] = url;
  }

  return [...collected].map(([name, urls]) => ({
    name,
    fetchUrl: urls.fetch ?? urls.fallback,
    pushUrl: urls.push ?? urls.fallback,
  }));
}

/* ------------------------------------------------------------------------ */
/* Write argv                                                               */
/* ------------------------------------------------------------------------ */

export function remoteAddArgs(name: string, url: string): string[] {
  return ['remote', 'add', name, url];
}

/** Removing a remote also deletes its remote-tracking branches. */
export function remoteRemoveArgs(name: string): string[] {
  return ['remote', 'remove', name];
}

/**
 * Repoints one direction of a remote.
 *
 * `set-url` writes `remote.<name>.url`; only `--push` writes `pushurl`. A
 * remote with a distinct push URL therefore needs two invocations, and a single
 * call that "just sets the URL" would leave the push side aimed at the old host
 * — visibly correct in the settings sheet and wrong on the next push.
 */
export function remoteSetUrlArgs(name: string, url: string, push = false): string[] {
  return ['remote', 'set-url', ...(push ? ['--push'] : []), name, url];
}
