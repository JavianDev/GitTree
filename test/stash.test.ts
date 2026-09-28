import { describe, expect, it } from 'vitest';
import { STASH_ARGS, parseStashes } from '../src/extension/git/parsers/stash';

const NUL = '\u0000';
const RS = '\u001e';

/** One stash record, built from {@link STASH_FORMAT}'s field order. */
const record = (
  ref: string,
  oid: string,
  shortOid: string,
  name: string,
  email: string,
  date: string,
  subject: string,
) => [ref, oid, shortOid, name, email, date, subject].join(NUL) + RS;

describe('STASH_ARGS', () => {
  it('asks for the list subcommand with the NUL/RS-delimited format', () => {
    expect(STASH_ARGS[0]).toBe('stash');
    expect(STASH_ARGS[1]).toBe('list');
    expect(STASH_ARGS[2]).toMatch(/^--format=/);
  });
});

describe('parseStashes', () => {
  it('parses git\'s default "WIP on <branch>: <subject>" form', () => {
    const output = record(
      'stash@{0}',
      'abc1234567890abc1234567890abc1234567890',
      'abc1234',
      'Ada Lovelace',
      'ada@example.com',
      '2024-01-01T12:00:00-05:00',
      'WIP on feature/sched-fix: quick fix before demo',
    );

    expect(parseStashes(output)).toEqual([
      {
        ref: 'stash@{0}',
        index: 0,
        oid: 'abc1234567890abc1234567890abc1234567890',
        shortOid: 'abc1234',
        author: { name: 'Ada Lovelace', email: 'ada@example.com' },
        createdAt: '2024-01-01T12:00:00-05:00',
        branch: 'feature/sched-fix',
        message: 'quick fix before demo',
      },
    ]);
  });

  it('parses the custom "On <branch>: <message>" form from `stash push -m`', () => {
    const output = record(
      'stash@{0}',
      'def4567890def4567890def4567890def456789',
      'def4567',
      'Ada Lovelace',
      'ada@example.com',
      '2024-01-02T09:00:00-05:00',
      'On main: before risky rebase',
    );

    const [entry] = parseStashes(output);
    expect(entry?.branch).toBe('main');
    expect(entry?.message).toBe('before risky rebase');
  });

  it('falls back to the raw subject when it does not match either form', () => {
    const output = record(
      'stash@{0}',
      '1111111111111111111111111111111111111a',
      '1111111',
      'Ada Lovelace',
      'ada@example.com',
      '2024-01-03T09:00:00-05:00',
      'a hand-crafted commit used as a stash',
    );

    const [entry] = parseStashes(output);
    expect(entry?.branch).toBeUndefined();
    expect(entry?.message).toBe('a hand-crafted commit used as a stash');
  });

  it('parses multiple stashes in index order and reads each index from its ref', () => {
    const output =
      record(
        'stash@{0}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaa',
        'Ada Lovelace',
        'ada@example.com',
        '2024-01-03T09:00:00-05:00',
        'WIP on main: newest',
      ) +
      record(
        'stash@{1}',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'bbbbbbb',
        'Ada Lovelace',
        'ada@example.com',
        '2024-01-02T09:00:00-05:00',
        'WIP on develop: older',
      );

    const stashes = parseStashes(output);
    expect(stashes).toHaveLength(2);
    expect(stashes[0]).toMatchObject({ ref: 'stash@{0}', index: 0, message: 'newest' });
    expect(stashes[1]).toMatchObject({ ref: 'stash@{1}', index: 1, message: 'older' });
  });

  it('returns an empty list for empty output', () => {
    expect(parseStashes('')).toEqual([]);
  });
});
