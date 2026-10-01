import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitService } from '../src/extension/git/GitService';
import type { FileStatus } from '../src/shared/model';

/*
 * `suggest.ts` talks to VS Code's language model API. These stand-ins model
 * the parts it uses — `lm.selectChatModels`, `sendRequest`'s streamed text,
 * `LanguageModelChatMessage.User`, and `LanguageModelError.NoPermissions` —
 * closely enough to drive every path: a model's draft, no model, permission
 * declined, an error, and an empty reply.
 */
const mocks = vi.hoisted(() => ({ selectChatModels: vi.fn() }));

vi.mock('vscode', () => {
  class LanguageModelError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
    static NoPermissions(message = 'denied'): LanguageModelError {
      return new LanguageModelError(message, 'NoPermissions');
    }
  }
  return {
    lm: { selectChatModels: mocks.selectChatModels },
    LanguageModelChatMessage: { User: (content: string) => ({ role: 'user', content }) },
    LanguageModelError,
  };
});

const { suggestCommitMessage } = await import('../src/extension/commitMessage/suggest');
const vscode = (await import('vscode')) as unknown as {
  LanguageModelError: { NoPermissions: (message?: string) => Error };
};

function file(path: string, kind: FileStatus['kind'], staged: boolean): FileStatus {
  return { path, kind, staged, unstaged: !staged, conflicted: false, index: staged ? 'M' : '.', worktree: staged ? '.' : 'M' };
}

function fakeGit(files: FileStatus[]) {
  const diffText = vi.fn(async (_staged: boolean, _max: number) => ({ text: 'diff --git a/x b/x\n+added', truncated: false }));
  const git = {
    status: async () => ({ repoId: 'r', branch: { detached: false, ahead: 0, behind: 0, head: 'main' }, files }),
    diffText,
  } as unknown as GitService;
  return { git, diffText };
}

function model(name: string, vendor: string, reply: string[] | Error) {
  const sendRequest = vi.fn(async (messages: { content: string }[]) => {
    if (reply instanceof Error) throw reply;
    return {
      text: (async function* () {
        yield* reply;
      })(),
      messages,
    };
  });
  return { name, vendor, sendRequest };
}

describe('suggestCommitMessage', () => {
  beforeEach(() => mocks.selectChatModels.mockReset());

  it("drafts with the user's model, preferring Copilot, from the staged diff", async () => {
    const copilot = model('GPT-4.1', 'copilot', ['```\nfix(graph): end conv', 'erging lanes\n\n- release lanes\n```']);
    mocks.selectChatModels.mockResolvedValue([model('Other', 'acme', ['nope']), copilot]);
    const { git, diffText } = fakeGit([file('src/lanes.ts', 'modified', true), file('README.md', 'modified', false)]);

    const result = await suggestCommitMessage(git);

    expect(result).toEqual({
      summary: 'fix(graph): end converging lanes',
      description: '- release lanes',
      source: 'model',
      model: 'GPT-4.1',
    });
    // Only what would be committed: the staged diff and the staged file.
    expect(diffText).toHaveBeenCalledWith(true, expect.any(Number));
    const prompt = copilot.sendRequest.mock.calls[0]?.[0][0]?.content ?? '';
    expect(prompt).toContain('modified: src/lanes.ts');
    expect(prompt).not.toContain('README.md');
    expect(prompt).toContain('+added');
  });

  it('describes every change when nothing is staged', async () => {
    mocks.selectChatModels.mockResolvedValue([model('GPT-4.1', 'copilot', ['docs: update readme'])]);
    const { git, diffText } = fakeGit([file('README.md', 'modified', false)]);

    const result = await suggestCommitMessage(git);
    expect(result.summary).toBe('docs: update readme');
    expect(diffText).toHaveBeenCalledWith(false, expect.any(Number));
  });

  it('falls back to the changed files when VS Code has no model', async () => {
    mocks.selectChatModels.mockResolvedValue([]);
    const { git } = fakeGit([file('src/lanes.ts', 'modified', true)]);

    const result = await suggestCommitMessage(git);
    expect(result.source).toBe('files');
    expect(result.summary).toContain('lanes.ts');
    expect(result.note).toMatch(/No AI model is available/);
  });

  it('says so when the user declines access', async () => {
    mocks.selectChatModels.mockResolvedValue([model('GPT-4.1', 'copilot', vscode.LanguageModelError.NoPermissions())]);
    const { git } = fakeGit([file('src/lanes.ts', 'modified', true)]);

    const result = await suggestCommitMessage(git);
    expect(result.source).toBe('files');
    expect(result.note).toMatch(/not given access/);
  });

  it('names the error when the model cannot be reached', async () => {
    mocks.selectChatModels.mockResolvedValue([model('GPT-4.1', 'copilot', new Error('rate limited'))]);
    const { git } = fakeGit([file('src/lanes.ts', 'modified', true)]);

    const result = await suggestCommitMessage(git);
    expect(result.source).toBe('files');
    expect(result.note).toContain('rate limited');
  });

  it('falls back when the model replies with nothing usable', async () => {
    mocks.selectChatModels.mockResolvedValue([model('GPT-4.1', 'copilot', ['```\n```'])]);
    const { git } = fakeGit([file('src/lanes.ts', 'modified', true)]);

    const result = await suggestCommitMessage(git);
    expect(result.source).toBe('files');
    expect(result.note).toMatch(/returned no message/);
  });

  it('does not ask a model when there is nothing to describe', async () => {
    const { git } = fakeGit([]);

    const result = await suggestCommitMessage(git);
    expect(result.note).toMatch(/no changes/);
    expect(mocks.selectChatModels).not.toHaveBeenCalled();
  });
});
