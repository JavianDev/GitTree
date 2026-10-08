import { describe, expect, it } from 'vitest';
import { COMMANDS, type CommandId, renderCommand, tokenize } from '../src/shared/commands';
import type { RefEntry, RepoState } from '../src/shared/model';
import { toolbarActions } from '../src/webview/app/toolbarActions';
import { createPlan, defaultTarget } from '../src/webview/features/pullRequests/createPlan';

const state = (over: Partial<RepoState['branch']> = {}, staged = 0): Pick<RepoState, 'branch' | 'counts'> => ({
  branch: { oid: 'a'.repeat(40), head: 'main', detached: false, upstream: 'origin/main', ahead: 0, behind: 0, ...over },
  counts: { staged, unstaged: 0, untracked: 0, conflicted: 0 },
});
const argvOf = (id: CommandId, actions: ReturnType<typeof toolbarActions>) => {
  const action = actions[id]!;
  return action.spec.build(action.context);
};

describe('toolbar defaults', () => {
  it('Pull rebases but does not autostash unless asked', () => {
    const actions = toolbarActions(state(), 0, []);
    expect(argvOf('pull', actions)).toEqual(['pull', '--rebase', 'origin', 'main']);
    expect(actions.pull!.context.autostash).toBeUndefined();
  });

  it('Pull is unavailable without an upstream; Push sets one on a new branch', () => {
    const actions = toolbarActions(state({ upstream: undefined }), 0, []);
    expect(actions.pull!.disabledReason).toMatch(/no upstream/);
    expect(argvOf('push', actions)).toEqual(['push', '--set-upstream', 'origin', 'main']);
  });

  it('Push shows how many commits it sends and refuses on a detached HEAD', () => {
    expect(toolbarActions(state({ ahead: 3 }), 0, []).push!.badge).toBe('3');
    expect(toolbarActions(state({ detached: true, head: undefined }), 0, []).push!.disabledReason).toMatch(/detached/);
  });

  it('Fetch prunes; Stash includes untracked files; Tag is annotated; New Branch checks out', () => {
    const actions = toolbarActions(state(), 2, []);
    expect(argvOf('fetch', actions)).toEqual(['fetch', '--prune', 'origin']);
    expect(argvOf('stash.push', actions)).toEqual(['stash', 'push', '--include-untracked']);
    expect(argvOf('tag.create', actions)).toEqual(['tag', '-a', '-m', '', '<name>']);
    expect(argvOf('branch.create', actions)).toEqual(['switch', '--create', '<name>']);
  });

  it('Commit needs something staged, Stash something changed, Discard a selection', () => {
    const idle = toolbarActions(state(), 0, []);
    expect(idle.commit!.disabledReason).toBeDefined();
    expect(idle['stash.push']!.disabledReason).toBeDefined();
    expect(idle.discard!.disabledReason).toBeDefined();
    const busy = toolbarActions(state({}, 1), 1, ['a.txt']);
    expect(busy.commit!.disabledReason).toBeUndefined();
    expect(busy['stash.push']!.disabledReason).toBeUndefined();
    expect(argvOf('discard', busy)).toEqual(['restore', '--worktree', '--', 'a.txt']);
  });
});

const ref = (name: string, over: Partial<RefEntry> = {}): RefEntry => ({
  kind: 'localBranch',
  name,
  fullName: `refs/heads/${name}`,
  oid: name.padEnd(40, '0'),
  isHead: false,
  ...over,
});

describe('New Pull Request plan', () => {
  const branches = [
    ref('main', { upstream: 'origin/main' }),
    ref('master', { upstream: 'origin/master' }),
    ref('feature/new'),
    ref('feature/ahead', { upstream: 'origin/feature/ahead', ahead: 2 }),
    ref('feature/same', { oid: ref('main').oid, upstream: 'origin/feature/same' }),
    ref('feature/gone', { upstream: 'origin/feature/gone', gone: true }),
  ];

  it('pushes a branch that is not on the remote, with --set-upstream', () => {
    const plan = createPlan(branches, 'feature/new', 'main', 'T');
    expect(plan.needsPush && plan.unpublished).toBe(true);
    expect(plan.pushArgv).toEqual(['push', '--set-upstream', 'origin', 'feature/new']);
    expect(plan.blocked).toBeUndefined();
  });

  it('pushes unpushed commits on a published branch, and a branch whose remote was deleted', () => {
    expect(createPlan(branches, 'feature/ahead', 'main', 'T')).toMatchObject({ needsPush: true, unpushed: 2, pushArgv: ['push', 'origin', 'feature/ahead'] });
    expect(createPlan(branches, 'feature/gone', 'main', 'T')).toMatchObject({ unpublished: true });
  });

  it('says why Create is unavailable', () => {
    expect(createPlan(branches, '', 'main', 'T').blocked).toMatch(/Choose the branch with your changes/);
    expect(createPlan(branches, 'feature/new', '', 'T').blocked).toMatch(/merge into/);
    expect(createPlan(branches, 'main', 'main', 'T').blocked).toMatch(/same branch/);
    expect(createPlan(branches, 'feature/same', 'main', 'T').blocked).toMatch(/no commits/);
    expect(createPlan(branches, 'feature/new', 'main', '  ').blocked).toMatch(/title/);
  });

  it('never defaults the target to the source branch', () => {
    expect(defaultTarget(branches, 'feature/new')).toBe('main');
    expect(defaultTarget(branches, 'main')).toBe('master');
    expect(defaultTarget([ref('main')], 'main')).toBeUndefined();
  });
});

describe('every command in the registry', () => {
  const full = {
    remote: 'origin', branch: 'feature/x', paths: ['a b.txt'], message: 'm', tagName: 'v1', commitish: 'abc1234',
    startPoint: 'abc1234', stashRef: 'stash@{0}', worktreePath: 'C:/w t/x', newPath: 'C:/w t/y', newBranch: 'nb',
    lockReason: 'qa', branches: ['g1', 'g2'], outputPath: 'C:/o u/t.zip', resetMode: 'soft' as const,
  };

  it.each(Object.keys(COMMANDS) as CommandId[])('%s builds a git argv that survives the editable text', (id) => {
    const spec = COMMANDS[id];
    const argv = spec.build(full);
    expect(argv.length).toBeGreaterThan(0);
    expect(argv.every((arg) => typeof arg === 'string')).toBe(true);
    expect(tokenize(renderCommand(spec, full))).toEqual(argv);
    expect(spec.summary.length).toBeGreaterThan(10);
    // Every path-taking command keeps paths after `--`.
    if (argv.includes('a b.txt')) expect(argv.indexOf('--')).toBeLessThan(argv.indexOf('a b.txt'));
  });
});
