import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyWorktreeFiles } from '../src/extension/worktrees/copyFiles';
import { compileGlob, globCouldMatchInside, globMatches, partitionPatterns } from '../src/extension/worktrees/glob';

const glob = (pattern: string, ci = false) => {
  const compiled = compileGlob(pattern, ci);
  if (!compiled.ok) throw new Error(compiled.error);
  return compiled.glob;
};

describe('glob subset', () => {
  it('anchors at the repository root unless ** is used', () => {
    expect(globMatches(glob('.env'), '.env', false)).toBe(true);
    expect(globMatches(glob('.env'), 'app/.env', false)).toBe(false);
    expect(globMatches(glob('**/.env'), 'app/.env', false)).toBe(true);
    expect(globMatches(glob('**/.env'), '.env', false)).toBe(true);
  });

  it('supports *, ?, [..], {a,b}, and a trailing / for directories only', () => {
    expect(globMatches(glob('.env*'), '.env.local', false)).toBe(true);
    expect(globMatches(glob('.env?'), '.envx', false)).toBe(true);
    expect(globMatches(glob('log[0-9].txt'), 'log7.txt', false)).toBe(true);
    expect(globMatches(glob('log[!0-9].txt'), 'log7.txt', false)).toBe(false);
    expect(globMatches(glob('*.{pem,key}'), 'tls.key', false)).toBe(true);
    expect(globMatches(glob('docs/tmp/'), 'docs/tmp', true)).toBe(true);
    expect(globMatches(glob('docs/tmp/'), 'docs/tmp', false)).toBe(false);
    expect(globMatches(glob('docs/tmp/**'), 'docs/tmp/a/b.md', false)).toBe(true);
  });

  it('is case-insensitive only when asked (Windows)', () => {
    expect(globMatches(glob('.ENV', true), '.env', false)).toBe(true);
    expect(globMatches(glob('.ENV'), '.env', false)).toBe(false);
  });

  it('rejects patterns that climb out or are absolute, and treats ! as exclude', () => {
    expect(compileGlob('../secrets', false).ok).toBe(false);
    expect(compileGlob('C:/x', false).ok).toBe(false);
    const parts = partitionPatterns(['.env', '!.env.prod', '../x'], ['tmp'], false);
    expect(parts.include.map((g) => g.pattern)).toEqual(['.env']);
    expect(parts.exclude.map((g) => g.pattern)).toEqual(['.env.prod', 'tmp']);
    expect(parts.invalid[0]).toMatch(/\.\.\/x/);
  });

  it('knows when a pattern could match inside a directory', () => {
    expect(globCouldMatchInside(glob('docs/tmp/**'), 'docs', false)).toBe(true);
    expect(globCouldMatchInside(glob('docs/tmp/**'), 'src', false)).toBe(false);
    expect(globCouldMatchInside(glob('**/.env'), 'anything', false)).toBe(true);
  });
});

describe('copyWorktreeFiles', () => {
  let root: string;
  let source: string;
  let target: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gittree-copy-'));
    source = path.join(root, 'source');
    target = path.join(root, 'target');
    mkdirSync(path.join(source, '.venv', 'lib'), { recursive: true });
    mkdirSync(path.join(source, 'docs', 'tmp'), { recursive: true });
    mkdirSync(path.join(source, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(source, '.env'), 'SECRET=1\n');
    writeFileSync(path.join(source, '.env.local'), 'LOCAL=1\n');
    writeFileSync(path.join(source, '.venv', 'lib', 'site.py'), 'print(1)\n');
    writeFileSync(path.join(source, '.venv', 'pyvenv.cfg'), 'home=x\n');
    writeFileSync(path.join(source, 'docs', 'tmp', 'draft.md'), '# draft\n');
    writeFileSync(path.join(source, 'node_modules', 'pkg', '.env'), 'NOPE\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const candidates = ['.env', '.env.local', '.venv/', 'docs/', 'node_modules/'];

  it('reports what a dry run would copy, without copying', async () => {
    const report = await copyWorktreeFiles({
      sourceRoot: source, targetRoot: target, candidates, include: ['.env*', '.venv'], exclude: [], dryRun: true, caseInsensitive: false,
    });
    expect(report.entries.map((e) => e.path).sort()).toEqual(['.env', '.env.local', '.venv/']);
    expect(report.totalFiles).toBe(4);
    expect(existsSync(path.join(target, '.env'))).toBe(false);
  });

  it('copies matches, walks into a collapsed folder for a deeper pattern, and honours excludes', async () => {
    const report = await copyWorktreeFiles({
      sourceRoot: source, targetRoot: target, candidates,
      include: ['.env', '.venv', 'docs/tmp/**', '**/.env'], exclude: ['.venv/pyvenv.cfg'], dryRun: false, caseInsensitive: false,
    });
    expect(readFileSync(path.join(target, '.env'), 'utf8')).toBe('SECRET=1\n');
    expect(existsSync(path.join(target, '.venv', 'lib', 'site.py'))).toBe(true);
    expect(existsSync(path.join(target, '.venv', 'pyvenv.cfg'))).toBe(false);
    expect(existsSync(path.join(target, 'docs', 'tmp', 'draft.md'))).toBe(true);
    // `**` never walks into node_modules looking for a match.
    expect(existsSync(path.join(target, 'node_modules'))).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('never overwrites a file the new worktree already has', async () => {
    writeFileSync(path.join(target, '.env'), 'KEEP\n');
    const report = await copyWorktreeFiles({
      sourceRoot: source, targetRoot: target, candidates, include: ['.env'], exclude: [], dryRun: false, caseInsensitive: false,
    });
    expect(readFileSync(path.join(target, '.env'), 'utf8')).toBe('KEEP\n');
    expect(report.entries[0]!.status).toBe('skipped-exists');
  });

  it('skips .git at any depth', async () => {
    mkdirSync(path.join(source, '.venv', '.git'), { recursive: true });
    writeFileSync(path.join(source, '.venv', '.git', 'HEAD'), 'ref\n');
    await copyWorktreeFiles({ sourceRoot: source, targetRoot: target, candidates, include: ['.venv'], exclude: [], dryRun: false, caseInsensitive: false });
    expect(existsSync(path.join(target, '.venv', '.git'))).toBe(false);
  });

  it('stops at the file limit and says so', async () => {
    const report = await copyWorktreeFiles({
      sourceRoot: source, targetRoot: target, candidates, include: ['.env', '.env.local', '.venv'], exclude: [], dryRun: false,
      caseInsensitive: false, limits: { maxFiles: 2, maxBytes: 1e9, maxMs: 60_000 },
    });
    expect(report.truncated).toBe(true);
    expect(report.totalFiles).toBe(2);
  });

  it('recreates symlinks rather than following them, where the OS allows it', async () => {
    let linked = true;
    try {
      symlinkSync(path.join(source, '.env'), path.join(source, '.env.link'));
    } catch {
      linked = false; // Windows without Developer Mode
    }
    if (!linked) return;
    const report = await copyWorktreeFiles({
      sourceRoot: source, targetRoot: target, candidates: ['.env.link'], include: ['.env.link'], exclude: [], dryRun: false, caseInsensitive: false,
    });
    expect(['copied', 'skipped-symlink']).toContain(report.entries[0]!.status);
  });
});
