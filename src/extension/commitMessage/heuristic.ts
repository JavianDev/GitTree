import type { FileChangeKind } from '@shared/model';

export interface ChangedFile {
  path: string;
  kind: FileChangeKind;
  origPath?: string;
}

export interface SuggestedMessage {
  summary: string;
  description: string;
}

const MAX_LISTED = 12;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Documentation, tests, and build config get the conventional-commit type they obviously are. */
function conventionalType(files: readonly ChangedFile[]): string | undefined {
  const all = (test: (path: string) => boolean) => files.length > 0 && files.every((file) => test(file.path));

  if (all((path) => /\.(md|mdx|rst|txt)$/i.test(path) || path.startsWith('docs/'))) return 'docs';
  if (all((path) => /(^|\/)(tests?|__tests__|spec)\//i.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path))) {
    return 'test';
  }
  if (
    all((path) =>
      /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.github\/|\.gitignore$|\.vscodeignore$|esbuild\.[mc]?js$|vite\.config)/i.test(
        path,
      ),
    )
  ) {
    return 'chore';
  }
  return undefined;
}

function verbFor(files: readonly ChangedFile[]): string {
  const kinds = new Set(files.map((file) => (file.kind === 'untracked' ? 'added' : file.kind)));
  if (kinds.size === 1) {
    if (kinds.has('added')) return 'Add';
    if (kinds.has('deleted')) return 'Remove';
    if (kinds.has('renamed')) return 'Rename';
  }
  return 'Update';
}

function describe(file: ChangedFile): string {
  switch (file.kind) {
    case 'added':
    case 'untracked':
      return `Add ${file.path}`;
    case 'deleted':
      return `Remove ${file.path}`;
    case 'renamed':
      return file.origPath ? `Rename ${file.origPath} to ${file.path}` : `Rename ${file.path}`;
    default:
      return `Update ${file.path}`;
  }
}

/**
 * A commit message written from the changed files alone — used when no language
 * model is available, and as the starting point the user edits either way.
 *
 * Deliberately plain: it states what changed, never why, because "why" is the
 * one thing a file list cannot know. The summary stays under 72 characters.
 */
export function suggestFromFiles(files: readonly ChangedFile[]): SuggestedMessage {
  if (files.length === 0) return { summary: '', description: '' };

  const type = conventionalType(files);
  const verb = verbFor(files);
  const first = files[0]!;

  let subject: string;
  if (files.length === 1) {
    subject =
      first.kind === 'renamed' && first.origPath
        ? `Rename ${baseName(first.origPath)} to ${baseName(first.path)}`
        : `${verb} ${baseName(first.path)}`;
  } else if (files.length === 2) {
    subject = `${verb} ${baseName(first.path)} and ${baseName(files[1]!.path)}`;
  } else {
    subject = `${verb} ${baseName(first.path)} and ${files.length - 1} other files`;
  }

  let summary = type ? `${type}: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}` : subject;
  if (summary.length > 72) summary = `${summary.slice(0, 71).trimEnd()}…`;

  const listed = files.slice(0, MAX_LISTED).map((file) => `- ${describe(file)}`);
  if (files.length > MAX_LISTED) listed.push(`- …and ${files.length - MAX_LISTED} more`);

  return { summary, description: files.length > 1 ? listed.join('\n') : '' };
}

/**
 * Splits a model's reply into summary and body: first non-empty line, then the
 * rest. Strips the wrapping a chat model tends to add — code fences, quotes, a
 * leading "Commit message:" label — so what lands in the box is only the message.
 */
export function parseModelReply(reply: string): SuggestedMessage {
  const cleaned = reply
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const lines = cleaned.split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex < 0) return { summary: '', description: '' };

  const summary = lines[firstIndex]!
    .trim()
    .replace(/^(commit message|summary|subject)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  const description = lines
    .slice(firstIndex + 1)
    .join('\n')
    .replace(/^(description|body)\s*:\s*/im, '')
    .trim();

  return { summary, description };
}
