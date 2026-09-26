import { describe, expect, it } from 'vitest';
import {
  REMOTE_ARGS,
  parseRemotes,
  remoteAddArgs,
  remoteRemoveArgs,
  remoteSetUrlArgs,
} from '../src/extension/git/parsers/remote';

/** One `remote -v` line: name, TAB, URL, then the direction marker. */
const line = (name: string, url: string, direction: 'fetch' | 'push') =>
  `${name}\t${url} (${direction})\n`;

/** The pair git prints for a remote with no separate push URL. */
const remote = (name: string, url: string) => line(name, url, 'fetch') + line(name, url, 'push');

describe('REMOTE_ARGS', () => {
  it('asks for the verbose form, which is the only one carrying URLs', () => {
    expect([...REMOTE_ARGS]).toEqual(['remote', '-v']);
  });
});

describe('parseRemotes — collapsing the two lines per remote', () => {
  it('merges the fetch and push lines into one entry', () => {
    const remotes = parseRemotes(remote('origin', 'https://example.com/repo.git'));

    expect(remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://example.com/repo.git',
        pushUrl: 'https://example.com/repo.git',
      },
    ]);
  });

  it('keeps a push URL that differs from the fetch URL', () => {
    // Fetch over HTTPS, push over SSH: a real configuration, and one that a
    // parser de-duplicating by name alone would silently flatten.
    const remotes = parseRemotes(
      line('origin', 'https://example.com/repo.git', 'fetch') +
        line('origin', 'ssh://git@example.com/repo.git', 'push'),
    );

    expect(remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://example.com/repo.git',
        pushUrl: 'ssh://git@example.com/repo.git',
      },
    ]);
  });

  it('keeps several remotes apart, in the order git listed them', () => {
    const remotes = parseRemotes(
      remote('origin', 'https://example.com/fork.git') +
        remote('upstream', 'https://example.com/canonical.git'),
    );

    expect(remotes.map((entry) => entry.name)).toEqual(['origin', 'upstream']);
    expect(remotes[1]?.fetchUrl).toBe('https://example.com/canonical.git');
  });

  it('does not let one remote inherit another remote’s URL', () => {
    const remotes = parseRemotes(
      line('origin', 'https://example.com/a.git', 'fetch') +
        line('mirror', 'https://example.com/b.git', 'push'),
    );

    expect(remotes).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
      { name: 'mirror', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);
  });
});

describe('parseRemotes — a single line for a remote', () => {
  // git falls back to the fetch URL when no `pushurl` is set, so mirroring the
  // one URL that is present is the truthful reading. An empty field would say
  // "no push URL configured", which is the opposite.
  it('mirrors a lone fetch line into the push URL', () => {
    expect(parseRemotes(line('origin', 'https://example.com/repo.git', 'fetch'))[0]).toEqual({
      name: 'origin',
      fetchUrl: 'https://example.com/repo.git',
      pushUrl: 'https://example.com/repo.git',
    });
  });

  it('mirrors a lone push line into the fetch URL', () => {
    expect(parseRemotes(line('origin', 'ssh://git@example.com/repo.git', 'push'))[0]).toEqual({
      name: 'origin',
      fetchUrl: 'ssh://git@example.com/repo.git',
      pushUrl: 'ssh://git@example.com/repo.git',
    });
  });

  it('lets the missing direction arrive later without losing the first URL', () => {
    const remotes = parseRemotes(
      line('origin', 'https://example.com/repo.git', 'fetch') +
        remote('upstream', 'https://example.com/other.git') +
        line('origin', 'ssh://git@example.com/repo.git', 'push'),
    );

    expect(remotes.find((entry) => entry.name === 'origin')).toEqual({
      name: 'origin',
      fetchUrl: 'https://example.com/repo.git',
      pushUrl: 'ssh://git@example.com/repo.git',
    });
  });
});

describe('parseRemotes — URLs that are not tidy', () => {
  it('keeps a URL containing spaces intact', () => {
    const remotes = parseRemotes(remote('backup', 'C:/My Repos/upstream.git'));

    expect(remotes[0]).toMatchObject({
      fetchUrl: 'C:/My Repos/upstream.git',
      pushUrl: 'C:/My Repos/upstream.git',
    });
  });

  it('keeps a push URL containing spaces distinct from the fetch URL', () => {
    const remotes = parseRemotes(
      line('backup', '//server/team share/repo.git', 'fetch') +
        line('backup', 'D:/local mirror/repo.git', 'push'),
    );

    expect(remotes[0]).toEqual({
      name: 'backup',
      fetchUrl: '//server/team share/repo.git',
      pushUrl: 'D:/local mirror/repo.git',
    });
  });

  it('keeps a non-ASCII URL intact', () => {
    expect(parseRemotes(remote('origin', 'https://example.com/日本語/repo.git'))[0]?.fetchUrl).toBe(
      'https://example.com/日本語/repo.git',
    );
  });

  it('tolerates CRLF line endings', () => {
    const remotes = parseRemotes(
      'origin\thttps://example.com/repo.git (fetch)\r\norigin\thttps://example.com/repo.git (push)\r\n',
    );

    expect(remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://example.com/repo.git',
        pushUrl: 'https://example.com/repo.git',
      },
    ]);
  });

  it('shows the first URL when a direction lists several', () => {
    // Multiple `remote.<name>.url` values are legal; the row must not change
    // which URL it displays because a mirror was appended.
    const remotes = parseRemotes(
      line('origin', 'https://example.com/first.git', 'fetch') +
        line('origin', 'https://example.com/second.git', 'fetch'),
    );

    expect(remotes).toHaveLength(1);
    expect(remotes[0]?.fetchUrl).toBe('https://example.com/first.git');
  });
});

describe('parseRemotes — resilience', () => {
  it('returns nothing for a repository with no remotes', () => {
    expect(parseRemotes('')).toEqual([]);
  });

  it('returns nothing for output that is only a newline', () => {
    expect(parseRemotes('\n')).toEqual([]);
  });

  it('skips a line with no direction marker rather than throwing', () => {
    // Without the marker there is nothing to say which direction the URL
    // serves, and guessing would let a push-only URL be shown as the fetch one.
    const remotes = parseRemotes(
      'origin\thttps://example.com/repo.git\n' + remote('upstream', 'https://example.com/other.git'),
    );

    expect(remotes.map((entry) => entry.name)).toEqual(['upstream']);
  });

  it('skips a line with no URL at all', () => {
    expect(parseRemotes('origin\n')).toEqual([]);
  });

  it('skips a malformed line without dropping the remotes around it', () => {
    const remotes = parseRemotes(
      remote('origin', 'https://example.com/a.git') +
        'error: something went wrong\n' +
        remote('upstream', 'https://example.com/b.git'),
    );

    expect(remotes.map((entry) => entry.name)).toEqual(['origin', 'upstream']);
  });
});

describe('remote write argv', () => {
  it('adds a remote by name and URL', () => {
    expect(remoteAddArgs('upstream', 'https://example.com/repo.git')).toEqual([
      'remote',
      'add',
      'upstream',
      'https://example.com/repo.git',
    ]);
  });

  it('removes a remote by name', () => {
    expect(remoteRemoveArgs('upstream')).toEqual(['remote', 'remove', 'upstream']);
  });

  it('sets the fetch URL by default', () => {
    expect(remoteSetUrlArgs('origin', 'https://example.com/repo.git')).toEqual([
      'remote',
      'set-url',
      'origin',
      'https://example.com/repo.git',
    ]);
  });

  it('needs --push to touch the push URL, which set-url otherwise leaves alone', () => {
    expect(remoteSetUrlArgs('origin', 'ssh://git@example.com/repo.git', true)).toEqual([
      'remote',
      'set-url',
      '--push',
      'origin',
      'ssh://git@example.com/repo.git',
    ]);
  });

  it('passes a URL containing spaces as one argument, never as a command line', () => {
    expect(remoteAddArgs('backup', 'C:/My Repos/upstream.git')).toHaveLength(4);
    expect(remoteAddArgs('backup', 'C:/My Repos/upstream.git')[3]).toBe('C:/My Repos/upstream.git');
  });
});
