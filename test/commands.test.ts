import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  COMMAND_LIST,
  activeFlags,
  renderCommand,
  renderArgv,
  tokenize,
} from '../src/shared/commands';

describe('command fidelity', () => {
  // GitTree's premise is that the GUI teaches you git. That only holds if the
  // string shown is the command that runs, so both sides call `build()` and
  // there is no second rendering path that could drift.
  it('renders every command from the same argv it would execute', () => {
    for (const spec of COMMAND_LIST) {
      const argv = spec.build({});
      expect(renderCommand(spec, {}), spec.id).toBe(renderArgv(argv));
    }
  });

  it('gives every command a summary and at least one argument', () => {
    for (const spec of COMMAND_LIST) {
      expect(spec.summary.length, spec.id).toBeGreaterThan(10);
      expect(spec.build({}).length, spec.id).toBeGreaterThan(0);
    }
  });

  it('glosses only the flags the current options actually produce', () => {
    // A plain fetch must not explain --prune it is not passing.
    expect(activeFlags(COMMANDS.fetch, {}).map((f) => f.flag)).not.toContain('--prune');
    expect(activeFlags(COMMANDS.fetch, { prune: true }).map((f) => f.flag)).toContain('--prune');
  });

  it('marks the commands that can lose work', () => {
    expect(COMMANDS.discard.destructive).toBe(true);
    expect(COMMANDS['branch.delete'].destructive).toBe(true);
    expect(COMMANDS['stash.drop'].destructive).toBe(true);
    expect(COMMANDS.fetch.destructive).toBeFalsy();
  });
});

describe('build — options change the command', () => {
  it('composes pull options in a stable order', () => {
    expect(COMMANDS.pull.build({ rebase: true, autostash: true, remote: 'origin', branch: 'main' })).toEqual([
      'pull',
      '--rebase',
      '--autostash',
      'origin',
      'main',
    ]);
  });

  it('prefers --force-with-lease over a bare force', () => {
    // A plain --force silently discards whatever landed since your last fetch.
    expect(COMMANDS.push.build({ force: true })).toContain('--force-with-lease');
    expect(COMMANDS.push.build({ force: true })).not.toContain('--force');
  });

  it('switches branch creation between branch and switch --create', () => {
    expect(COMMANDS['branch.create'].build({ branch: 'x' })).toEqual(['branch', 'x']);
    expect(COMMANDS['branch.create'].build({ branch: 'x', checkoutAfterCreate: true })).toEqual([
      'switch',
      '--create',
      'x',
    ]);
  });

  it('chooses -d or -D for branch deletion', () => {
    expect(COMMANDS['branch.delete'].build({ branch: 'x' })).toContain('-d');
    expect(COMMANDS['branch.delete'].build({ branch: 'x', forceDelete: true })).toContain('-D');
  });

  it('terminates path lists with -- so a leading dash cannot become a flag', () => {
    const argv = COMMANDS.discard.build({ paths: ['--weird-name.ts'] });
    expect(argv[argv.indexOf('--weird-name.ts') - 1]).toBe('--');
  });

  it('reads the commit message from stdin rather than an argument', () => {
    // -m would have to survive quoting; -F - cannot be misread whatever it holds.
    expect(COMMANDS.commit.build({})).toEqual(['commit', '-F', '-']);
  });
});

describe('renderCommand', () => {
  it('quotes arguments containing spaces so the string can be pasted verbatim', () => {
    const rendered = renderCommand(COMMANDS.discard, { paths: ['src/my file.ts'] });
    expect(rendered).toBe('git restore --worktree -- "src/my file.ts"');
  });

  it('leaves ordinary arguments unquoted', () => {
    expect(renderCommand(COMMANDS.fetch, { prune: true, remote: 'origin' })).toBe(
      'git fetch --prune origin',
    );
  });
});

describe('tokenize — the edited command becomes an argument list', () => {
  // The sheet lets the user edit the command before applying it. That string is
  // split here and handed to spawn with shell:false — there is no shell to
  // reinterpret it, which is what makes editing safe.
  it('splits on whitespace', () => {
    expect(tokenize('fetch --prune origin')).toEqual(['fetch', '--prune', 'origin']);
  });

  it('drops a leading git, which the UI shows separately', () => {
    expect(tokenize('git fetch --prune')).toEqual(['fetch', '--prune']);
    expect(tokenize('fetch --prune')).toEqual(['fetch', '--prune']);
  });

  it('keeps a quoted argument containing spaces as one token', () => {
    expect(tokenize('commit -m "two words here"')).toEqual(['commit', '-m', 'two words here']);
    expect(tokenize("commit -m 'single quoted'")).toEqual(['commit', '-m', 'single quoted']);
  });

  it('treats shell metacharacters as ordinary text', () => {
    // Nothing here is a separator, a pipe, or a substitution: it is one argument
    // that happens to contain punctuation.
    expect(tokenize('commit -m "fix; rm -rf / && echo $(whoami)"')).toEqual([
      'commit',
      '-m',
      'fix; rm -rf / && echo $(whoami)',
    ]);
  });

  it('does not split on a semicolon or ampersand outside quotes either', () => {
    expect(tokenize('log;status')).toEqual(['log;status']);
    expect(tokenize('log&&status')).toEqual(['log&&status']);
  });

  it('handles escaped quotes inside double quotes', () => {
    expect(tokenize('commit -m "say \\"hi\\""')).toEqual(['commit', '-m', 'say "hi"']);
  });

  it('treats a backslash literally inside single quotes', () => {
    expect(tokenize("log --format='a\\b'")).toEqual(['log', '--format=a\\b']);
  });

  it('preserves an empty quoted argument', () => {
    expect(tokenize('commit -m ""')).toEqual(['commit', '-m', '']);
  });

  it('collapses runs of whitespace', () => {
    expect(tokenize('  fetch   --prune  \t origin \n')).toEqual(['fetch', '--prune', 'origin']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('git')).toEqual([]);
  });

  it('round-trips a rendered command', () => {
    for (const spec of COMMAND_LIST) {
      const argv = spec.build({ paths: ['a file.ts'], branch: 'feature/x', message: 'a message' });
      expect(tokenize(renderArgv(argv)), spec.id).toEqual(argv);
    }
  });
});
