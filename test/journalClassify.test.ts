import { describe, expect, it } from 'vitest';
import { isMutating } from '../src/extension/git/CommandJournal';

/** Classifies a command written the way it would be typed. */
function classify(command: string): boolean {
  const args = command.split(' ').filter(Boolean);
  return isMutating(args.find((arg) => !arg.startsWith('-')), args);
}

describe('isMutating — plain subcommands', () => {
  it('treats the read-only set as reads', () => {
    for (const command of [
      'status --porcelain=v2 -z',
      'log --topo-order',
      'diff --cached',
      'for-each-ref',
      'rev-parse HEAD',
      'show --no-patch abc123',
      'cat-file --batch',
    ]) {
      expect(classify(command), command).toBe(false);
    }
  });

  it('treats everything that changes the repository as a write', () => {
    for (const command of ['commit -F -', 'push origin main', 'add -- file.ts', 'merge feature']) {
      expect(classify(command), command).toBe(true);
    }
  });

  it('errs toward mutating for an unrecognised subcommand', () => {
    // Dimming a command nobody classified would understate what it did; the safe
    // direction to be wrong in is "this changed something".
    expect(classify('bisect start')).toBe(true);
    expect(isMutating(undefined, [])).toBe(true);
  });
});

describe('isMutating — the verb is in the flags, not the name', () => {
  // Both directions of this were wrong at once: settings writes were dimmed as
  // reads because `config` was on the read-only list, while every `remote -v`
  // listing was lit up as a mutation because `remote` was not.
  it('separates config reads from config writes', () => {
    expect(classify('config --local --get user.name')).toBe(false);
    expect(classify('config --global --get user.email')).toBe(false);
    expect(classify('config --list')).toBe(false);

    expect(classify('config --local user.name Ada')).toBe(true);
    expect(classify('config --local --unset user.email')).toBe(true);
    expect(classify('config --add remote.origin.fetch refs/heads/*')).toBe(true);
  });

  it('separates listing remotes from changing them', () => {
    expect(classify('remote -v')).toBe(false);
    expect(classify('remote')).toBe(false);

    expect(classify('remote add origin https://example.com/r.git')).toBe(true);
    expect(classify('remote remove origin')).toBe(true);
    expect(classify('remote set-url origin https://example.com/r.git')).toBe(true);
  });

  it('separates listing worktrees from changing them', () => {
    expect(classify('worktree list --porcelain -z')).toBe(false);
    for (const verb of ['add -b x -- p main', 'remove -- p', 'move -- a b', 'lock -- p', 'unlock -- p', 'prune --verbose', 'repair']) {
      expect(classify(`worktree ${verb}`), verb).toBe(true);
    }
  });

  it('separates stash listing from stashing', () => {
    expect(classify('stash list')).toBe(false);
    expect(classify('stash show')).toBe(false);

    expect(classify('stash push --include-untracked')).toBe(true);
    expect(classify('stash pop')).toBe(true);
    expect(classify('stash')).toBe(true);
  });
});
