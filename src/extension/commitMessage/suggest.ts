import * as vscode from 'vscode';
import type { GitService } from '../git/GitService';
import { type ChangedFile, type SuggestedMessage, parseModelReply, suggestFromFiles } from './heuristic';

/** Enough diff for a model to see what changed; more only costs time and tokens. */
const MAX_DIFF_CHARS = 24_000;

export interface CommitSuggestion extends SuggestedMessage {
  /** `model`: written by a language model. `files`: drafted from the file list alone. */
  source: 'model' | 'files';
  /** The model's name, when one wrote it. */
  model?: string;
  /** Why no model was used, when that is worth telling the user. */
  note?: string;
}

const INSTRUCTIONS = `Write a git commit message for the changes below.

Rules:
- First line: an imperative summary under 72 characters. Use a conventional-commit prefix
  (feat:, fix:, docs:, refactor:, test:, chore:, perf:, style:) when one clearly applies.
- Then, only if it adds information: a blank line and a short body (1-4 lines or bullets)
  saying what changed and why.
- Reply with the commit message only — no code fences, no quotes, no commentary.`;

/**
 * Drafts a commit message for what would be committed: the staged changes, or
 * every change when nothing is staged yet.
 *
 * Uses VS Code's language model API — whatever chat model the user already has
 * (GitHub Copilot, or another provider's extension) — so Git Tree needs no API
 * key of its own. VS Code asks the user once before allowing it. Without a
 * model, or if the user declines, the message is drafted from the file list.
 */
export async function suggestCommitMessage(
  git: GitService,
  cancellation?: vscode.CancellationToken,
): Promise<CommitSuggestion> {
  const status = await git.status();
  const staged = status.files.filter((file) => file.staged && !file.conflicted);
  const scope = staged.length > 0 ? staged : status.files.filter((file) => !file.conflicted && file.kind !== 'ignored');

  const files: ChangedFile[] = scope.map((file) => ({
    path: file.path,
    kind: file.kind,
    ...(file.origPath ? { origPath: file.origPath } : {}),
  }));
  const fallback = suggestFromFiles(files);
  if (files.length === 0) return { ...fallback, source: 'files', note: 'There are no changes to describe.' };

  let model: vscode.LanguageModelChat | undefined;
  try {
    const models = await vscode.lm.selectChatModels();
    model = models.find((candidate) => candidate.vendor === 'copilot') ?? models[0];
  } catch {
    model = undefined;
  }
  if (!model) {
    return {
      ...fallback,
      source: 'files',
      note: 'No AI model is available in VS Code (for example GitHub Copilot), so this was drafted from the changed files.',
    };
  }

  const diff = await git.diffText(staged.length > 0, MAX_DIFF_CHARS);
  const fileList = files.map((file) => `${file.kind}: ${file.path}`).join('\n');
  const prompt = `${INSTRUCTIONS}\n\nChanged files:\n${fileList}\n\nDiff${diff.truncated ? ' (truncated)' : ''}:\n${diff.text}`;

  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      { justification: 'Git Tree drafts a commit message from your changes.' },
      cancellation,
    );

    let reply = '';
    for await (const chunk of response.text) reply += chunk;

    const parsed = parseModelReply(reply);
    if (!parsed.summary) return { ...fallback, source: 'files', note: 'The AI model returned no message.' };
    return { ...parsed, source: 'model', model: model.name };
  } catch (error) {
    const declined = error instanceof vscode.LanguageModelError && error.code === vscode.LanguageModelError.NoPermissions.name;
    return {
      ...fallback,
      source: 'files',
      note: declined
        ? 'Git Tree was not given access to an AI model, so this was drafted from the changed files.'
        : `The AI model could not be reached (${error instanceof Error ? error.message : String(error)}), so this was drafted from the changed files.`,
    };
  }
}
