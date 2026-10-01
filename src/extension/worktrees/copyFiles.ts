import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { CopyReport } from '@shared/model';
import { type CompiledGlob, globCouldMatchInside, globMatches, partitionPatterns } from './glob';

export interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
  maxMs: number;
}

export const DEFAULT_COPY_LIMITS: CopyLimits = { maxFiles: 25_000, maxBytes: 1024 * 1024 * 1024, maxMs: 60_000 };

/** Folders a `**` pattern never walks into looking for a match: huge, and never what anyone means. */
const NEVER_WALK = new Set(['.git', 'node_modules']);

export interface CopyRequest {
  /** The worktree files are copied from. */
  sourceRoot: string;
  /** The new worktree; omitted for a dry run with no target yet. */
  targetRoot?: string;
  /** `git ls-files --others --directory` output: untracked and ignored entries, directories ending in `/`. */
  candidates: readonly string[];
  include: readonly string[];
  exclude: readonly string[];
  dryRun: boolean;
  caseInsensitive: boolean;
  limits?: CopyLimits;
}

type Entry = CopyReport['entries'][number];

/**
 * Copies untracked and ignored files — `.env`, `.venv/`, build caches — from one
 * worktree into a new one, or reports what it would copy.
 *
 * Safety comes first: only entries git lists as untracked or ignored are
 * candidates, so tracked files (which the new worktree already has) are never
 * touched; nothing is ever overwritten (`COPYFILE_EXCL`); `.git` is skipped at
 * any depth; symlinks are recreated, never followed; every destination must
 * stay inside the target; and the copy stops at the file, byte, or time limit
 * and says so rather than running away on a 40 GB folder.
 */
export async function copyWorktreeFiles(request: CopyRequest): Promise<CopyReport> {
  const limits = request.limits ?? DEFAULT_COPY_LIMITS;
  const { include, exclude, invalid } = partitionPatterns(request.include, request.exclude, request.caseInsensitive);
  const report: CopyReport = { entries: [], totalFiles: 0, totalBytes: 0, truncated: false, errors: [], invalidPatterns: invalid };
  if (include.length === 0) return report;

  const started = Date.now();
  const excluded = (relative: string, isDirectory: boolean) =>
    exclude.some((glob) => globMatches(glob, relative, isDirectory)) || relative.split('/').includes('.git');
  const included = (relative: string, isDirectory: boolean) => include.some((glob) => globMatches(glob, relative, isDirectory));
  const couldMatchInside = (dir: string) =>
    include.some((glob) => globCouldMatchInside(glob, dir, request.caseInsensitive)) &&
    !NEVER_WALK.has(dir.split('/').pop() ?? '');

  const overLimit = () =>
    report.totalFiles >= limits.maxFiles || report.totalBytes >= limits.maxBytes || Date.now() - started > limits.maxMs;

  /** Decides one path: copy it whole, walk into it, or leave it. */
  const visit = async (relative: string, isDirectory: boolean): Promise<void> => {
    if (excluded(relative, isDirectory)) return;
    if (included(relative, isDirectory)) {
      report.entries.push(await take(relative, isDirectory));
      return;
    }
    if (isDirectory && couldMatchInside(relative)) {
      const children = await readDirectory(path.join(request.sourceRoot, relative));
      for (const child of children) {
        if (overLimit()) break;
        await visit(`${relative}/${child.name}`, child.isDirectory());
      }
    }
  };

  /** Copies (or measures) one included file, folder, or symlink. */
  const take = async (relative: string, isDirectory: boolean): Promise<Entry> => {
    const entry: Entry = { path: relative + (isDirectory ? '/' : ''), kind: isDirectory ? 'dir' : 'file', files: 0, bytes: 0, status: 'planned' };
    if (overLimit()) {
      entry.status = 'skipped-limit';
      report.truncated = true;
      return entry;
    }

    const copyOne = async (rel: string): Promise<void> => {
      if (overLimit()) {
        report.truncated = true;
        entry.status = entry.files > 0 ? entry.status : 'skipped-limit';
        return;
      }
      const source = path.join(request.sourceRoot, rel);
      let info;
      try {
        info = await fs.lstat(source);
      } catch (error) {
        report.errors.push(`${rel}: ${describe(error)}`);
        return;
      }

      if (info.isSymbolicLink()) {
        if (!isDirectory) entry.kind = 'symlink';
        entry.files++;
        report.totalFiles++;
        if (request.dryRun || !request.targetRoot) return;
        const destination = safeDestination(request.targetRoot, rel);
        if (!destination) return;
        try {
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.symlink(await fs.readlink(source), destination);
          if (entry.status === 'planned') entry.status = 'copied';
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          entry.status = code === 'EEXIST' ? 'skipped-exists' : 'skipped-symlink';
          entry.note = code === 'EPERM' ? 'Creating symlinks needs Developer Mode or admin rights on Windows.' : describe(error);
        }
        return;
      }

      if (info.isDirectory()) {
        for (const child of await readDirectory(source)) {
          if (overLimit()) {
            report.truncated = true;
            return;
          }
          const childRel = `${rel}/${child.name}`;
          if (excluded(childRel, child.isDirectory())) continue;
          await copyOne(childRel);
        }
        return;
      }

      entry.files++;
      entry.bytes += info.size;
      report.totalFiles++;
      report.totalBytes += info.size;
      if (request.dryRun || !request.targetRoot) return;

      const destination = safeDestination(request.targetRoot, rel);
      if (!destination) {
        report.errors.push(`${rel}: would land outside the new worktree`);
        return;
      }
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
        if (entry.status === 'planned') entry.status = 'copied';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          entry.status = 'skipped-exists';
          entry.note = 'Already exists in the new worktree; left as it is.';
        } else {
          entry.status = 'error';
          report.errors.push(`${rel}: ${describe(error)}`);
        }
      }
    };

    await copyOne(relative);
    return entry;
  };

  for (const candidate of request.candidates) {
    if (overLimit()) {
      report.truncated = true;
      break;
    }
    const isDirectory = candidate.endsWith('/');
    const relative = candidate.replace(/\/+$/, '');
    if (!relative) continue;
    await visit(relative, isDirectory);
  }

  return report;
}

async function readDirectory(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The destination for `relative`, or undefined when it would escape the target. */
function safeDestination(targetRoot: string, relative: string): string | undefined {
  const destination = path.resolve(targetRoot, relative);
  const back = path.relative(targetRoot, destination);
  if (back.startsWith('..') || path.isAbsolute(back)) return undefined;
  return destination;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exposed for tests: which compiled include matched. */
export type { CompiledGlob };
