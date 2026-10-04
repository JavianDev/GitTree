import { describe, expect, it } from 'vitest';
import { fixesFor, headlineFor } from '../src/webview/app/gitFailure';

const OVERWRITE = `error: Your local changes to the following files would be overwritten by checkout:
\tsrc/lanes.ts
Please commit your changes or stash them before you switch branches.
Aborting`;

describe('git failure fixes', () => {
  it('offers stash & retry for local changes in the way, when the command can be retried', () => {
    expect(fixesFor({ text: OVERWRITE, retry: ['switch', 'x'] })).toEqual(['stashAndRetry', 'reviewChanges', 'openLog']);
    expect(fixesFor({ text: OVERWRITE })).toEqual(['reviewChanges', 'openLog']);
    expect(headlineFor(OVERWRITE)).toBe('Your uncommitted changes are in the way');
  });
  it('offers pull for a rejected push and set-upstream for a new branch', () => {
    expect(fixesFor({ text: ' ! [rejected]        main -> main (fetch first)' })).toEqual(['pull', 'openLog']);
    expect(fixesFor({ text: 'fatal: The current branch x has no upstream branch.' })).toEqual(['pushSetUpstream', 'openLog']);
  });
  it('offers the changes view for conflicts, and only the log otherwise', () => {
    expect(fixesFor({ text: 'CONFLICT (content): Merge conflict in a.txt' })).toEqual(['reviewChanges', 'openLog']);
    expect(fixesFor({ text: 'fatal: something odd' })).toEqual(['openLog']);
    expect(headlineFor('fatal: something odd')).toBe('Git reported a problem');
  });
});
