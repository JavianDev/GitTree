import { describe, expect, it } from 'vitest';
import {
  BINDINGS,
  type KeyEventLike,
  bindingGroups,
  canonicalKey,
  collisions,
  formatKey,
  matchBinding,
} from '../src/webview/app/keymap';

/** A KeyboardEvent-shaped literal; modifiers default to off. */
function press(key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('canonicalKey', () => {
  it('lowercases a plain letter', () => {
    expect(canonicalKey(press('p'))).toBe('p');
  });

  it('prefixes shift for a shifted letter', () => {
    // The browser reports the uppercase character; the table names it shift+p.
    expect(canonicalKey(press('P', { shiftKey: true }))).toBe('shift+p');
  });

  it('does not prefix shift for punctuation, which already encodes it', () => {
    // `?` is the shifted `/`. A shift+? token could never match a binding.
    expect(canonicalKey(press('?', { shiftKey: true }))).toBe('?');
  });

  it('folds meta into ctrl so one table serves both platforms', () => {
    expect(canonicalKey(press('Enter', { metaKey: true }))).toBe('ctrl+enter');
    expect(canonicalKey(press('Enter', { ctrlKey: true }))).toBe('ctrl+enter');
  });

  it('orders modifiers ctrl, alt, shift', () => {
    expect(canonicalKey(press('T', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'ctrl+alt+shift+t',
    );
  });

  it('names the space bar', () => {
    expect(canonicalKey(press(' '))).toBe('space');
  });

  it('lowercases named keys', () => {
    expect(canonicalKey(press('ArrowDown'))).toBe('arrowdown');
    expect(canonicalKey(press('Escape'))).toBe('escape');
    expect(canonicalKey(press('F6', { shiftKey: true }))).toBe('shift+f6');
  });
});

describe('matchBinding — plain keys', () => {
  it('resolves a bare letter', () => {
    expect(matchBinding(press('f'))).toEqual({ kind: 'command', id: 'git.fetch' });
  });

  it('distinguishes a letter from its shifted form', () => {
    expect(matchBinding(press('p'))).toEqual({ kind: 'command', id: 'git.pull' });
    expect(matchBinding(press('P', { shiftKey: true }))).toEqual({ kind: 'command', id: 'git.push' });
  });

  it('resolves modifier combinations', () => {
    expect(matchBinding(press('Enter', { ctrlKey: true }))).toEqual({ kind: 'command', id: 'commit' });
    expect(matchBinding(press('Enter', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'command',
      id: 'commit.amend',
    });
  });

  it('accepts either alias for the same command', () => {
    expect(matchBinding(press('j'))).toEqual({ kind: 'command', id: 'list.next' });
    expect(matchBinding(press('ArrowDown'))).toEqual({ kind: 'command', id: 'list.next' });
  });

  it('returns none for an unbound key', () => {
    expect(matchBinding(press('q'))).toEqual({ kind: 'none' });
    expect(matchBinding(press('z', { ctrlKey: true }))).toEqual({ kind: 'none' });
  });

  it('binds refresh to both a letter and F5', () => {
    // Auto-refresh can be switched off, and a watcher can miss a change made
    // outside the workspace, so the manual path must always be one key away.
    expect(matchBinding(press('r'))).toEqual({ kind: 'command', id: 'repo.refresh' });
    expect(matchBinding(press('F5'))).toEqual({ kind: 'command', id: 'repo.refresh' });
    expect(matchBinding(press('R', { shiftKey: true }))).toEqual({ kind: 'command', id: 'repo.rescan' });
  });
});

describe('matchBinding — the typing guard', () => {
  // A bare letter belongs to the text field being typed in. Getting this wrong
  // means the user cannot type "fix" into a commit message without firing
  // Fetch, and it is invisible until someone tries.
  it('suppresses bare letters while a text field has focus', () => {
    expect(matchBinding(press('f'), { typing: true })).toEqual({ kind: 'none' });
    expect(matchBinding(press('s'), { typing: true })).toEqual({ kind: 'none' });
    expect(matchBinding(press('?'), { typing: true })).toEqual({ kind: 'none' });
  });

  it('still fires combinations while typing', () => {
    expect(matchBinding(press('Enter', { ctrlKey: true }), { typing: true })).toEqual({
      kind: 'command',
      id: 'commit',
    });
    expect(matchBinding(press('f', { ctrlKey: true }), { typing: true })).toEqual({
      kind: 'command',
      id: 'search.focus',
    });
  });

  it('still fires Escape while typing, which is how a filter gets cleared', () => {
    expect(matchBinding(press('Escape'), { typing: true })).toEqual({ kind: 'command', id: 'dismiss' });
  });

  it('does not arm a chord prefix while typing', () => {
    expect(matchBinding(press('g'), { typing: true })).toEqual({ kind: 'none' });
  });
});

describe('matchBinding — chords', () => {
  it('arms a prefix rather than firing it', () => {
    expect(matchBinding(press('g'))).toEqual({ kind: 'pending', prefix: 'g' });
  });

  it('completes a chord', () => {
    expect(matchBinding(press('c'), { chord: 'g' })).toEqual({ kind: 'command', id: 'mode.changes' });
    expect(matchBinding(press('h'), { chord: 'g' })).toEqual({ kind: 'command', id: 'mode.history' });
    expect(matchBinding(press('u'), { chord: 'g' })).toEqual({
      kind: 'command',
      id: 'goto.uncommitted',
    });
  });

  it('cancels on a miss instead of falling through to the single-key binding', () => {
    // `g` then `f` must not fire Fetch: the user was mid-chord and mistyped, and
    // silently running an unrelated command is the worst possible recovery.
    expect(matchBinding(press('f'), { chord: 'g' })).toEqual({ kind: 'none' });
    expect(matchBinding(press('Escape'), { chord: 'g' })).toEqual({ kind: 'none' });
  });
});

describe('the binding table', () => {
  it('has no key claimed by two different commands', () => {
    // The symptom of a collision is one shortcut silently shadowing another,
    // which no amount of manual testing reliably catches.
    expect(collisions()).toEqual([]);
  });

  it('uses no Alt+letter binding, which would open the Windows menu bar', () => {
    for (const binding of BINDINGS) {
      for (const key of binding.keys) {
        const parts = key.split('+');
        const isAltLetter =
          parts.includes('alt') && !parts.includes('ctrl') && (parts[parts.length - 1] ?? '').length === 1;
        expect(isAltLetter, `${binding.id} binds ${key}`).toBe(false);
      }
    }
  });

  it('uses no Ctrl+Shift+letter binding, which VS Code already claims', () => {
    for (const binding of BINDINGS) {
      for (const key of binding.keys) {
        const parts = key.split('+');
        const tail = parts[parts.length - 1] ?? '';
        const isCtrlShiftLetter =
          parts.includes('ctrl') && parts.includes('shift') && tail.length === 1 && /[a-z]/.test(tail);
        expect(isCtrlShiftLetter, `${binding.id} binds ${key}`).toBe(false);
      }
    }
  });

  it('marks only non-letter keys as safe while typing', () => {
    for (const binding of BINDINGS.filter((entry) => entry.whileTyping)) {
      for (const key of binding.keys) {
        const bare = /^[a-z0-9?/[\]\\]$/.test(key);
        expect(bare, `${binding.id} binds bare ${key} but claims whileTyping`).toBe(false);
      }
    }
  });

  it('gives every binding a label and a group', () => {
    for (const binding of BINDINGS) {
      expect(binding.label.length, binding.id).toBeGreaterThan(2);
      expect(binding.group.length, binding.id).toBeGreaterThan(0);
      expect(binding.keys.length, binding.id).toBeGreaterThan(0);
    }
  });

  it('groups every binding for the shortcuts sheet, losing none', () => {
    // The sheet is generated from this, so a binding missing from the grouping
    // is a shortcut that exists but is undocumented.
    const grouped = bindingGroups().flatMap((entry) => entry.bindings);
    expect(grouped).toHaveLength(BINDINGS.length);
  });
});

describe('formatKey', () => {
  it('renders a combination as separate keycaps', () => {
    expect(formatKey('ctrl+enter')).toEqual(['Ctrl', 'Enter']);
    expect(formatKey('ctrl+alt+1')).toEqual(['Ctrl', 'Alt', '1']);
  });

  it('renders a chord as "prefix then key"', () => {
    expect(formatKey('g c')).toEqual(['g', 'then', 'c']);
  });

  it('renders arrows and named keys legibly', () => {
    expect(formatKey('shift+arrowdown')).toEqual(['Shift', '↓']);
    expect(formatKey('escape')).toEqual(['Esc']);
    expect(formatKey('pagedown')).toEqual(['PgDn']);
  });
});
