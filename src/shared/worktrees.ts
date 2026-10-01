import type { WorktreeEntry, WorktreeLocationSettings, WorktreeSummary } from './model';

/**
 * Worktree rules shared by the extension host and the webview.
 *
 * Pure on purpose: the Create sheet previews a path on every keystroke, and the
 * host must arrive at exactly the same path when it creates the folder. One
 * implementation, compiled into both, is what keeps the preview honest. No
 * `node:` imports and no DOM types — `src/shared` is built by both tsconfigs.
 *
 * Paths here are in display form: forward slashes, drive letter uppercased.
 */

export type PathPlatform = 'win32' | 'posix';

export interface TemplateVars {
  userHome: string;
  repoName: string;
  repoParent: string;
  repoRoot: string;
}

/* ---------------------------------------------------------------------- */
/* Path arithmetic                                                         */
/* ---------------------------------------------------------------------- */

export function isAbsolutePath(input: string): boolean {
  return /^[A-Za-z]:\//.test(input) || input.startsWith('/');
}

/** Forward slashes, `.` and `..` resolved, no trailing slash, drive letter uppercased. */
export function normalizePath(input: string): string {
  let value = input.replace(/\\/g, '/');
  const unc = value.startsWith('//') ? '//' : '';
  value = value.slice(unc.length);

  const drive = /^([A-Za-z]):/.exec(value);
  let prefix = unc;
  if (drive) {
    prefix += `${drive[1]!.toUpperCase()}:`;
    value = value.slice(2);
  }
  const absolute = value.startsWith('/');

  const out: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }

  const body = out.join('/');
  if (absolute) return `${prefix}/${body}`;
  return prefix ? `${prefix}${body}` : body;
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((part) => part !== '').join('/'));
}

export function dirname(input: string): string {
  const normalized = normalizePath(input);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : normalized;
  // Keep `C:/` rather than reducing it to `C:`.
  if (index === 2 && /^[A-Z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, index);
}

export function basename(input: string): string {
  const normalized = normalizePath(input);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function comparable(input: string, platform: PathPlatform): string {
  const normalized = normalizePath(input);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function samePath(a: string, b: string, platform: PathPlatform): boolean {
  return comparable(a, platform) === comparable(b, platform);
}

/** True when `child` is `parent` or lies beneath it. */
export function isInsidePath(child: string, parent: string, platform: PathPlatform): boolean {
  const c = comparable(child, platform);
  const p = comparable(parent, platform);
  return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/** `child` relative to `parent`, or undefined when it is not inside. Empty when equal. */
export function relativeInside(child: string, parent: string, platform: PathPlatform): string | undefined {
  if (!isInsidePath(child, parent, platform)) return undefined;
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c.length === p.length ? '' : c.slice(p.length + (p.endsWith('/') ? 0 : 1));
}

/* ---------------------------------------------------------------------- */
/* Folder names                                                            */
/* ---------------------------------------------------------------------- */

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Makes one path segment safe on every OS.
 *
 * The same rules apply everywhere, not just on Windows, so a path suggested on
 * a Mac is the path a teammate on Windows would get for the same branch.
 */
export function sanitizeSegment(segment: string): string {
  let value = segment
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f\\]/g, '-')
    .replace(/[. ]+$/, '')
    .replace(/-{2,}/g, '-');
  if (WINDOWS_DEVICE.test(value)) value = `${value}_`;
  return value === '' || value === '.' || value === '..' ? 'worktree' : value;
}

/** `feature/login` → `feature/login` (hierarchy kept) or `feature-login`. */
export function folderNameFor(name: string, preserveHierarchy: boolean): string {
  const segments = name
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(sanitizeSegment);
  if (segments.length === 0) return 'worktree';
  return preserveHierarchy ? segments.join('/') : segments.join('-');
}

/* ---------------------------------------------------------------------- */
/* Location                                                                */
/* ---------------------------------------------------------------------- */

const VARIABLE = /\$\{([A-Za-z]+)\}/g;
const KNOWN_VARIABLES = ['userHome', 'repoName', 'repoParent', 'repoRoot', 'branch'];

export interface SuggestedPath {
  /** The full path the new worktree would get, before any uniqueness suffix. */
  path?: string;
  /** The folder it goes in. */
  base?: string;
  /** The branch-derived folder name. */
  folder: string;
  warnings: string[];
  error?: string;
}

/**
 * Where a new worktree for `name` goes.
 *
 * Order of precedence: a sub-folder inside the repository, then the configured
 * directory template, then the default `<repoParent>/<repoName>.worktrees`.
 * Variables resolve against the **main** worktree, so creating from inside a
 * linked worktree still lands beside the main one rather than nesting.
 */
export function suggestWorktreePath(
  name: string,
  settings: WorktreeLocationSettings,
  vars: TemplateVars,
  platform: PathPlatform,
): SuggestedPath {
  const folder = folderNameFor(name, settings.preserveBranchHierarchy);
  const warnings: string[] = [];

  let path: string;
  let base: string;

  const subfolder = settings.subfolder.trim();
  const directory = settings.directory.trim();

  if (subfolder) {
    const normalized = normalizePath(subfolder);
    if (isAbsolutePath(normalized) || normalized.split('/').includes('..')) {
      return { folder, warnings, error: 'The sub-folder must be a folder inside the repository, like .worktrees.' };
    }
    base = joinPath(vars.repoRoot, normalized);
    path = joinPath(base, folder);
  } else if (!directory) {
    base = joinPath(vars.repoParent, `${vars.repoName}.worktrees`);
    path = joinPath(base, folder);
  } else {
    const unknown = [...directory.matchAll(VARIABLE)].map((match) => match[1]!).filter((key) => !KNOWN_VARIABLES.includes(key));
    if (unknown.length > 0) {
      return {
        folder,
        warnings,
        error: `Unknown variable \${${unknown[0]}}. Use ${KNOWN_VARIABLES.map((key) => `\${${key}}`).join(', ')}.`,
      };
    }

    const values: Record<string, string> = { ...vars, branch: folder };
    let expanded = directory.replace(VARIABLE, (_, key: string) => values[key] ?? '');
    if (expanded === '~' || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
      expanded = vars.userHome + expanded.slice(1);
    }
    expanded = normalizePath(expanded);
    if (!expanded) return { folder, warnings, error: 'The worktree folder is empty.' };
    if (!isAbsolutePath(expanded)) expanded = joinPath(vars.repoParent, expanded);

    if (directory.includes('${branch}')) {
      path = expanded;
      base = dirname(expanded);
    } else {
      base = expanded;
      path = joinPath(base, folder);
    }

    if (isInsidePath(path, vars.repoRoot, platform)) {
      warnings.push(
        'This is inside the repository, so the repository will list it as an untracked folder. ' +
          'The sub-folder option adds it to .git/info/exclude for you.',
      );
    }
  }

  if (platform === 'win32' && path.length > 200) {
    warnings.push('This path is long. If git fails with "Filename too long", run git config core.longpaths true.');
  }

  return { path, base, folder, warnings };
}

/** `path`, or `path-2` … `path-99`: the first candidate `taken` does not reject. */
export function uniquePath(path: string, taken: (candidate: string) => boolean): string | undefined {
  if (!taken(path)) return path;
  for (let n = 2; n < 100; n++) {
    const candidate = `${path}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* Branch names                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Why `name` is not a valid branch name, following `git check-ref-format`.
 * Undefined when it is valid.
 */
export function validateBranchName(name: string): string | undefined {
  if (name.length === 0) return 'Enter a branch name.';
  if (name === '@') return 'A branch cannot be named "@".';
  if (name.startsWith('-')) return 'A branch name cannot start with "-".';
  // eslint-disable-next-line no-control-regex
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return 'Branch names cannot contain spaces or any of ~ ^ : ? * [ \\.';
  if (name.includes('..')) return 'A branch name cannot contain "..".';
  if (name.includes('@{')) return 'A branch name cannot contain "@{".';
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return 'Slashes must separate non-empty parts.';
  if (name.endsWith('.')) return 'A branch name cannot end with ".".';
  for (const part of name.split('/')) {
    if (part.startsWith('.')) return 'No part of a branch name can start with ".".';
    if (part.endsWith('.lock')) return 'No part of a branch name can end with ".lock".';
  }
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* Commands                                                                */
/* ---------------------------------------------------------------------- */

export interface WorktreeTarget {
  verb: string;
  path?: string;
  newPath?: string;
  commitish?: string;
  newBranch?: string;
}

/** Options of `git worktree <verb>` that take a value, which is not a path. */
const VALUE_OPTIONS = new Set(['-b', '-B', '--reason', '--expire', '--orphan']);

/**
 * Which worktree a `worktree` command (argv without `git`) acts on.
 *
 * Used after the user may have edited the command by hand, so the steps that
 * follow a create, and the watcher release before a remove, act on the folder
 * the command actually names rather than the one the form suggested.
 */
export function worktreeTargetOf(argv: readonly string[]): WorktreeTarget | undefined {
  if (argv[0] !== 'worktree' || !argv[1]) return undefined;

  const verb = argv[1];
  const positional: string[] = [];
  let newBranch: string | undefined;
  let afterSeparator = false;

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!afterSeparator && arg === '--') {
      afterSeparator = true;
      continue;
    }
    if (!afterSeparator && arg.startsWith('-')) {
      if (VALUE_OPTIONS.has(arg)) {
        const value = argv[++index];
        if ((arg === '-b' || arg === '-B') && value) newBranch = value;
      }
      continue;
    }
    positional.push(arg);
  }

  const target: WorktreeTarget = { verb };
  if (positional[0]) target.path = positional[0];
  if (verb === 'move' && positional[1]) target.newPath = positional[1];
  if (verb === 'add' && positional[1]) target.commitish = positional[1];
  if (newBranch) target.newBranch = newBranch;
  return target;
}

/* ---------------------------------------------------------------------- */
/* Presentation and safety                                                 */
/* ---------------------------------------------------------------------- */

/**
 * The fewest trailing segments that tell each path apart, e.g.
 * `GitTree.worktrees/feature-login` beside `Other.worktrees/feature-login`.
 */
export function shortestUniquePaths(paths: readonly string[], platform: PathPlatform): Map<string, string> {
  const split = paths.map((path) => normalizePath(path).split('/'));
  const result = new Map<string, string>();

  paths.forEach((path, index) => {
    const segments = split[index]!;
    for (let take = 1; take <= segments.length; take++) {
      const tail = segments.slice(-take).join('/');
      const clash = split.some(
        (other, otherIndex) =>
          otherIndex !== index && comparable(other.slice(-take).join('/'), platform) === comparable(tail, platform),
      );
      if (!clash || take === segments.length) {
        result.set(path, tail);
        break;
      }
    }
  });

  return result;
}

/** Why a worktree cannot be removed from here, or undefined when it can. */
export function removeBlocker(entry: WorktreeEntry): string | undefined {
  if (entry.bare) return 'This is the bare repository itself.';
  if (entry.isMain) return 'This is the main worktree: it holds the repository itself.';
  if (entry.isCurrent) return 'This tab is showing it. Switch to another repository tab first.';
  if (entry.openInWindow) return 'It is open in this VS Code window. Close the folder first.';
  if (entry.missing) return 'Its folder is gone. Prune clears git’s record of it.';
  return undefined;
}

/** Why a worktree cannot be moved or locked, or undefined when it can. */
export function moveBlocker(entry: WorktreeEntry): string | undefined {
  if (entry.bare || entry.isMain) return 'git cannot move or lock the main worktree.';
  if (entry.missing) return 'Its folder is gone.';
  if (entry.isCurrent) return 'This tab is showing it. Switch to another repository tab first.';
  if (entry.openInWindow) return 'It is open in this VS Code window.';
  return undefined;
}

/**
 * How many `--force` flags `git worktree remove` needs: one to discard
 * uncommitted changes, two for a locked worktree (whatever its changes).
 */
export function requiredForce(entry: WorktreeEntry, summary?: WorktreeSummary): 0 | 1 | 2 {
  if (entry.locked) return 2;
  if (!summary) return 0;
  return summary.staged + summary.unstaged + summary.untracked + summary.conflicted > 0 ? 1 : 0;
}

/** Changes counted on a row: everything not yet committed. */
export function changeCount(summary: WorktreeSummary | undefined): number {
  if (!summary) return 0;
  return summary.staged + summary.unstaged + summary.untracked + summary.conflicted;
}

/**
 * The sub-folder to reopen in another worktree: where the user is now, relative
 * to the repository they are in. Empty for the root, undefined when the folder
 * open in the window is not inside that repository (e.g. a parent folder).
 */
export function preservedSubfolder(sourceRoot: string, openFolder: string, platform: PathPlatform): string | undefined {
  return relativeInside(openFolder, sourceRoot, platform);
}

/** The name a worktree row shows: its branch's last segment, or its folder name. */
export function worktreeLabel(entry: WorktreeEntry): string {
  if (entry.bare) return 'bare repository';
  if (entry.branch) return entry.branch;
  return basename(entry.path);
}
