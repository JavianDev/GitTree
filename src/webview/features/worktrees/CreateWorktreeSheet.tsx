import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, type CommandContext, type CommandSpec, renderArgv, tokenize } from '@shared/commands';
import type {
  CopyReport,
  RefEntry,
  WorktreeColor,
  WorktreeConfig,
  WorktreeList,
  WorktreeOpenBehavior,
} from '@shared/model';
import { WORKTREE_COLORS } from '@shared/model';
import { folderNameFor, isAbsolutePath, isInsidePath, joinPath, validateBranchName, worktreeTargetOf } from '@shared/worktrees';
import { RpcRequestError, rpc } from '../../rpc/client';
import { COLOR_LABEL, colorVar } from './actions';
import { ChipsEditor } from './ChipsEditor';
import { type PlanStep, PlanList, usePlanRunner } from './PlanRunner';
import './worktrees.css';

export interface CreateWorktreeSheetProps {
  repoId: string;
  /** The branch checked out in the active worktree — the default base. */
  currentBranch?: string;
  initialMode?: 'new' | 'existing';
  initialBase?: RefEntry;
  onExplain: (spec: CommandSpec) => void;
  onClose: () => void;
  /** Called once the worktree exists, with git's work done; `refresh` reloads the shell. */
  onCreated: () => void;
}

type Mode = 'new' | 'existing';

const describe = (error: unknown) => (error instanceof RpcRequestError ? error.displayText : String(error));

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Waits for a value to settle before acting on it — path checks and copy previews run git. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * New Worktree.
 *
 * Two ways in, like the Visual Studio extension's dialog: a **new branch**
 * based on any branch, tag, or commit; or an **existing** branch (local, or a
 * remote one tracked as a new local branch), or a tag/commit detached. The
 * folder is suggested from the repository's worktree settings and stays
 * editable. Every step that will run is listed before anything runs, the git
 * command itself is editable, and each step's output is shown as it happens.
 */
export function CreateWorktreeSheet({
  repoId,
  currentBranch,
  initialMode,
  initialBase,
  onExplain,
  onClose,
  onCreated,
}: CreateWorktreeSheetProps): React.JSX.Element {
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [list, setList] = useState<WorktreeList | undefined>();
  const [config, setConfig] = useState<WorktreeConfig | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();

  const [mode, setMode] = useState<Mode>(initialMode ?? 'new');
  const [branchName, setBranchName] = useState('');
  const [base, setBase] = useState(initialBase && initialMode !== 'existing' ? initialBase.name : currentBranch ?? 'HEAD');
  const [trackBase, setTrackBase] = useState(true);
  const [existing, setExisting] = useState<RefEntry | undefined>(initialMode === 'existing' ? initialBase : undefined);
  const [existingQuery, setExistingQuery] = useState('');
  const [localName, setLocalName] = useState('');

  const [path, setPath] = useState('');
  const [pathEdited, setPathEdited] = useState(false);
  const [pathNote, setPathNote] = useState<{ error?: string; warnings: string[]; suffixed: boolean }>({ warnings: [], suffixed: false });
  const [pathCheck, setPathCheck] = useState<string | undefined>();

  const [openAfter, setOpenAfter] = useState<WorktreeOpenBehavior>('gitTreeTab');
  const [color, setColor] = useState<WorktreeColor | undefined>();
  const [copyOn, setCopyOn] = useState(false);
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [preview, setPreview] = useState<CopyReport | undefined>();
  const [pull, setPull] = useState(false);
  const [push, setPush] = useState(false);
  const [lock, setLock] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [edited, setEdited] = useState<string | undefined>();
  const runner = usePlanRunner();
  const seeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.request('refs/list', { repoId }),
      rpc.request('worktrees/list', { repoId }),
      rpc.request('worktrees/config', { repoId }),
    ])
      .then(([refResult, nextList, nextConfig]) => {
        if (cancelled) return;
        setRefs(refResult.refs);
        setList(nextList);
        setConfig(nextConfig);
        if (!seeded.current) {
          seeded.current = true;
          const effective = nextConfig.effective;
          setOpenAfter(effective.openBehavior);
          setInclude(effective.copyInclude);
          setExclude(effective.copyExclude);
          setCopyOn(effective.copyInclude.length > 0);
          setPull(effective.autoPull);
          setPush(effective.autoPush);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describe(error));
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  /** Local branches some worktree already has checked out: git refuses a second checkout. */
  const held = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of list?.worktrees ?? []) if (entry.branch) map.set(entry.branch, entry.path);
    return map;
  }, [list]);

  const locals = refs.filter((ref) => ref.kind === 'localBranch');
  const remotes = refs.filter((ref) => ref.kind === 'remoteBranch');
  const tags = refs.filter((ref) => ref.kind === 'tag');
  const remoteNames = useMemo(() => [...new Set(remotes.map((ref) => ref.remote).filter((name): name is string => Boolean(name)))], [remotes]);
  const baseRef = refs.find((ref) => ref.name === base);

  // The name the folder is derived from, and the branch that ends up checked out.
  const remoteLocal = existing?.kind === 'remoteBranch' ? localName || existing.name.slice((existing.remote?.length ?? 0) + 1) : undefined;
  const folderSource =
    mode === 'new'
      ? branchName
      : existing?.kind === 'localBranch'
        ? existing.name
        : existing?.kind === 'remoteBranch'
          ? remoteLocal ?? ''
          : existing?.name ?? (/^[0-9a-f]{7,40}$/i.test(existingQuery.trim()) ? existingQuery.trim().slice(0, 12) : '');

  const checkedOutBranch = mode === 'new' ? branchName : existing?.kind === 'localBranch' ? existing.name : remoteLocal;
  const detached = mode === 'existing' && (existing?.kind === 'tag' || (!existing && folderSource !== ''));
  const commitish = mode === 'new' ? base : existing ? existing.name : existingQuery.trim();

  // Suggest a folder until the user types their own.
  const debouncedSource = useDebounced(folderSource, 250);
  useEffect(() => {
    if (pathEdited || !debouncedSource || !config) return;
    let cancelled = false;
    rpc
      .request('worktrees/suggestPath', { repoId, name: debouncedSource })
      .then((result) => {
        if (cancelled) return;
        if (result.path) setPath(result.path);
        setPathNote({ ...(result.error ? { error: result.error } : {}), warnings: result.warnings, suffixed: result.suffixed });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoId, debouncedSource, pathEdited, config]);

  const debouncedPath = useDebounced(path, 300);
  useEffect(() => {
    if (!debouncedPath) return setPathCheck(undefined);
    let cancelled = false;
    rpc
      .request('worktrees/checkPath', { repoId, path: debouncedPath })
      .then((result) => {
        if (!cancelled) setPathCheck(result.error);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoId, debouncedPath]);

  // What a copy would take: a dry run, refreshed as the patterns change.
  const patternKey = `${include.join('\n')}|${exclude.join('\n')}|${copyOn}`;
  const debouncedPatterns = useDebounced(patternKey, 400);
  useEffect(() => {
    if (!copyOn || include.length === 0) return setPreview(undefined);
    let cancelled = false;
    rpc
      .request('worktrees/copyFiles', { repoId, include, exclude, dryRun: true })
      .then((report) => {
        if (!cancelled) setPreview(report);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `debouncedPatterns` stands for include/exclude/copyOn once they settle.
  }, [repoId, debouncedPatterns]);

  const context: CommandContext = {
    worktreePath: path || '<path>',
    ...(commitish ? { commitish } : {}),
    ...(mode === 'new' && branchName ? { newBranch: branchName } : {}),
    ...(mode === 'new' && baseRef?.kind === 'remoteBranch' ? (trackBase ? { track: true } : { noTrack: true }) : {}),
    ...(mode === 'existing' && existing?.kind === 'remoteBranch' && remoteLocal ? { newBranch: remoteLocal, track: true } : {}),
    ...(detached ? { detach: true } : {}),
  };
  const builtArgv = COMMANDS['worktree.add'].build(context);
  const commandText = edited ?? renderArgv(builtArgv).replace(/^git /, '');
  const argv = edited !== undefined ? tokenize(edited) : builtArgv;
  const target = worktreeTargetOf(argv);
  const targetPath = target?.path && isAbsolutePath(target.path.replace(/\\/g, '/')) ? target.path : undefined;

  // Validation, most fundamental first.
  const branchError =
    mode === 'new'
      ? validateBranchName(branchName) ?? (locals.some((ref) => ref.name === branchName) ? 'exists' : undefined)
      : undefined;
  const existingError =
    mode === 'existing'
      ? !existing && !folderSource
        ? 'Choose a branch, tag, or commit.'
        : existing?.kind === 'localBranch' && held.has(existing.name)
          ? `Already checked out in ${held.get(existing.name)}.`
          : existing?.kind === 'remoteBranch' && remoteLocal && locals.some((ref) => ref.name === remoteLocal)
            ? `A local branch named ${remoteLocal} already exists; pick it from Local instead.`
            : undefined
      : undefined;
  const pathError = !path ? 'Choose a folder.' : !isAbsolutePath(path.replace(/\\/g, '/')) ? 'Enter a full path.' : pathNote.error ?? pathCheck;
  const blocker = edited !== undefined ? (targetPath ? undefined : 'The edited command must name a full folder path.') : branchError === 'exists' ? 'That branch already exists.' : branchError ?? existingError ?? pathError;

  const hasUpstream =
    mode === 'existing' &&
    ((existing?.kind === 'localBranch' && Boolean(existing.upstream)) || existing?.kind === 'remoteBranch');
  const pushRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0];
  const canPush = mode === 'new' && Boolean(pushRemote) && Boolean(checkedOutBranch);
  const insideSubfolder =
    config && config.effective.subfolder.trim() && targetPath
      ? isInsidePath(targetPath, joinPath(config.vars.repoRoot, config.effective.subfolder), config.platform)
      : false;

  /* ---- The plan ------------------------------------------------------- */

  let newRepoId: string | undefined;
  const run = async (step: string[], inRepo: () => string | undefined) => {
    const id = inRepo();
    if (!id) return { ok: false, output: 'The new worktree could not be registered.' };
    const result = await rpc.request('commands/run', { repoId: id, argv: step });
    return { ok: result.exitCode === 0, output: (result.stderr || result.stdout).trim() };
  };

  const steps: PlanStep[] = [
    { id: 'add', label: 'Create the worktree', command: `git ${commandText}`, run: () => run(argv, () => repoId) },
  ];
  if (targetPath) {
    steps.push({
      id: 'register',
      label: 'Open it in Git Tree’s list',
      run: async () => {
        const result = await rpc.request('worktrees/register', { repoId, path: targetPath });
        newRepoId = result.repoId;
        return { ok: true };
      },
    });
    if (insideSubfolder && config) {
      steps.push({
        id: 'exclude',
        label: `Add /${config.effective.subfolder.trim()}/ to .git/info/exclude`,
        run: async () => {
          await rpc.request('worktrees/excludeFolder', { repoId, folder: config.effective.subfolder.trim() });
          return { ok: true };
        },
      });
    }
    if (copyOn && include.length > 0) {
      steps.push({
        id: 'copy',
        label: preview ? `Copy ${preview.entries.length} item${preview.entries.length === 1 ? '' : 's'} (${formatBytes(preview.totalBytes)}) into the new worktree` : 'Copy the chosen files into the new worktree',
        run: async () => {
          const report = await rpc.request('worktrees/copyFiles', { repoId, targetPath, include, exclude, dryRun: false });
          const skipped = report.entries.filter((entry) => entry.status !== 'copied').map((entry) => `${entry.path}: ${entry.status}${entry.note ? ` — ${entry.note}` : ''}`);
          const output = [...report.errors, ...skipped, report.truncated ? 'Stopped at the copy limit.' : ''].filter(Boolean).join('\n');
          return { ok: report.errors.length === 0, ...(output ? { output } : {}) };
        },
      });
    }
    if (lock) {
      const lockArgv = COMMANDS['worktree.lock'].build({ worktreePath: targetPath, ...(lockReason.trim() ? { lockReason: lockReason.trim() } : {}) });
      steps.push({ id: 'lock', label: 'Lock it', command: renderArgv(lockArgv), run: () => run(lockArgv, () => repoId) });
    }
    if (pull && hasUpstream) {
      const pullArgv = COMMANDS.pull.build({ ffOnly: true });
      steps.push({ id: 'pull', label: '(in the new worktree)', command: renderArgv(pullArgv), run: () => run(pullArgv, () => newRepoId) });
    }
    if (push && canPush && pushRemote && checkedOutBranch) {
      const pushArgv = COMMANDS.push.build({ remote: pushRemote, branch: checkedOutBranch, setUpstream: true });
      steps.push({ id: 'push', label: '(in the new worktree)', command: renderArgv(pushArgv), run: () => run(pushArgv, () => newRepoId) });
    }
    if (color) {
      steps.push({
        id: 'color',
        label: `Label it ${COLOR_LABEL[color].toLowerCase()}`,
        run: async () => {
          await rpc.request('worktrees/setColor', { repoId, path: targetPath, color });
          return { ok: true };
        },
      });
    }
    if (openAfter !== 'none') {
      const where = openAfter === 'gitTreeTab' ? 'in a Git Tree tab' : openAfter === 'newWindow' ? 'in a new VS Code window' : 'in this VS Code window';
      steps.push({
        id: 'open',
        label: `Open it ${where}`,
        run: async () => {
          await rpc.request('worktrees/open', { repoId, path: targetPath, target: openAfter });
          return { ok: true };
        },
      });
    }
  }

  const create = async () => {
    const ok = await runner.run(steps);
    if (ok || steps.length > 1) onCreated();
    if (ok) onClose();
  };

  const saveCopyDefaults = () => {
    if (!config) return;
    void rpc
      .request('worktrees/setOverride', { repoId, override: { ...config.override, copyInclude: include, copyExclude: exclude } })
      .then(setConfig)
      .catch(() => undefined);
  };

  const pickFolder = () => {
    void rpc.request('dialog/pickFolder', { title: 'Folder for the new worktree', ...(path ? { defaultPath: path } : {}) }).then((result) => {
      if (result.path) {
        setPath(joinPath(result.path, folderSourceFolder(folderSource, config)));
        setPathEdited(true);
      }
    });
  };

  const existingMatches = (items: RefEntry[]) => {
    const query = existingQuery.trim().toLowerCase();
    return query ? items.filter((ref) => ref.name.toLowerCase().includes(query)) : items;
  };

  const pickerRow = (ref: RefEntry) => {
    const holder = ref.kind === 'localBranch' ? held.get(ref.name) : undefined;
    return (
      <button
        key={ref.fullName}
        type="button"
        className="gt-wt-pick"
        aria-pressed={existing?.fullName === ref.fullName}
        disabled={holder !== undefined}
        title={holder ? `Checked out in ${holder}` : ref.subject ?? ref.name}
        onClick={() => {
          setExisting(ref);
          setLocalName('');
          setPathEdited(false);
        }}
      >
        <span className="gt-wt-pick-name">{ref.name}</span>
        {holder && <span className="gt-wt-pick-note">in {holder.split('/').pop()}</span>}
      </button>
    );
  };

  const busy = runner.running;

  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div className="gt-sheet gt-sheet-wide gt-wt-sheet" role="dialog" aria-modal="true" aria-labelledby="gt-wt-create-title" onClick={(event) => event.stopPropagation()}>
        <h2 className="gt-sheet-title" id="gt-wt-create-title">
          New Worktree
        </h2>
        <p className="gt-sheet-summary">A second working folder on the same repository: two branches at once, no stashing, no switching.</p>

        {loadError && (
          <div className="gt-cmd-result" data-failed="true">
            <pre>{loadError}</pre>
          </div>
        )}

        <div className="gt-segmented" role="tablist" aria-label="Worktree source">
          <button type="button" role="tab" className="gt-segment" aria-selected={mode === 'new'} onClick={() => { setMode('new'); setPathEdited(false); setEdited(undefined); }}>
            New branch
          </button>
          <button type="button" role="tab" className="gt-segment" aria-selected={mode === 'existing'} onClick={() => { setMode('existing'); setPathEdited(false); setEdited(undefined); }}>
            Existing branch or tag
          </button>
        </div>

        <div className="gt-wt-form">
          {mode === 'new' ? (
            <>
              <label className="gt-wt-field">
                <span className="gt-wt-label">Branch name</span>
                <input
                  type="text"
                  className="gt-text-input"
                  placeholder="feature/login"
                  autoFocus
                  value={branchName}
                  onChange={(event) => {
                    setBranchName(event.target.value);
                    setEdited(undefined);
                  }}
                />
                <span className="gt-wt-hint" data-tone={branchName && branchError ? 'error' : undefined}>
                  {!branchName ? '' : branchError === 'exists' ? (
                    <>
                      That branch exists.{' '}
                      <button type="button" className="gt-link" onClick={() => { setMode('existing'); setExisting(locals.find((ref) => ref.name === branchName)); }}>
                        Use it instead
                      </button>
                    </>
                  ) : branchError ?? '✓ available'}
                </span>
              </label>

              <label className="gt-wt-field">
                <span className="gt-wt-label">Based on</span>
                <input
                  type="text"
                  className="gt-text-input"
                  list="gt-wt-bases"
                  value={base}
                  onChange={(event) => {
                    setBase(event.target.value);
                    setEdited(undefined);
                  }}
                />
                <datalist id="gt-wt-bases">
                  {[...locals, ...remotes, ...tags].map((ref) => (
                    <option key={ref.fullName} value={ref.name} />
                  ))}
                </datalist>
                <span className="gt-wt-hint">A branch, remote branch, tag, or commit.</span>
              </label>

              {baseRef?.kind === 'remoteBranch' && (
                <label className="gt-checkbox">
                  <input type="checkbox" checked={trackBase} onChange={(event) => setTrackBase(event.target.checked)} />
                  Track {baseRef.name} as the new branch’s upstream
                </label>
              )}
            </>
          ) : (
            <div className="gt-wt-field">
              <span className="gt-wt-label">Branch, tag, or commit</span>
              <input
                type="search"
                className="gt-text-input"
                placeholder="Search, or paste a commit SHA"
                value={existingQuery}
                autoFocus
                onChange={(event) => {
                  setExistingQuery(event.target.value);
                  setExisting(undefined);
                  setPathEdited(false);
                }}
              />
              <div className="gt-wt-picker">
                {existingMatches(locals).length > 0 && <p className="gt-wt-pick-group">Local</p>}
                {existingMatches(locals).map(pickerRow)}
                {existingMatches(remotes).length > 0 && <p className="gt-wt-pick-group">Remote — checked out as a new tracking branch</p>}
                {existingMatches(remotes).map(pickerRow)}
                {existingMatches(tags).length > 0 && <p className="gt-wt-pick-group">Tags — checked out detached</p>}
                {existingMatches(tags).map(pickerRow)}
              </div>
              {existing?.kind === 'remoteBranch' && (
                <label className="gt-wt-field">
                  <span className="gt-wt-label">Local branch</span>
                  <input type="text" className="gt-text-input" value={remoteLocal ?? ''} onChange={(event) => setLocalName(event.target.value)} />
                </label>
              )}
              {existingError && <span className="gt-wt-hint" data-tone="error">{existingError}</span>}
            </div>
          )}

          <div className="gt-wt-field">
            <span className="gt-wt-label">Location</span>
            <div className="gt-wt-row-inline">
              <input
                type="text"
                className="gt-text-input gt-mono"
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setPathEdited(true);
                  setEdited(undefined);
                }}
              />
              <button type="button" className="gt-button" data-size="small" onClick={pickFolder}>
                Browse…
              </button>
              {pathEdited && (
                <button type="button" className="gt-button" data-size="small" onClick={() => setPathEdited(false)}>
                  Reset
                </button>
              )}
            </div>
            <span className="gt-wt-hint" data-tone={pathError && path ? 'error' : undefined}>
              {path && pathError ? pathError : pathNote.suffixed ? 'A worktree folder by that name exists, so a number was added.' : locationSource(config)}
            </span>
            {pathNote.warnings.map((warning) => (
              <span key={warning} className="gt-wt-hint" data-tone="warning">
                {warning}
              </span>
            ))}
          </div>

          <div className="gt-wt-field">
            <span className="gt-wt-label">Open after</span>
            <div className="gt-wt-radios" role="radiogroup">
              {(
                [
                  ['gitTreeTab', 'Git Tree tab'],
                  ['newWindow', 'New window'],
                  ['currentWindow', 'This window'],
                  ['none', 'Don’t open'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="gt-checkbox">
                  <input type="radio" name="gt-wt-open" checked={openAfter === value} onChange={() => setOpenAfter(value)} />
                  {label}
                </label>
              ))}
            </div>
            {openAfter === 'currentWindow' && <span className="gt-wt-hint" data-tone="warning">This window will switch to the new worktree.</span>}
          </div>

          {config?.effective.colorLabels !== false && (
            <div className="gt-wt-field">
              <span className="gt-wt-label">Colour</span>
              <div className="gt-wt-swatches" role="radiogroup" aria-label="Colour label">
                <button type="button" className="gt-wt-swatch" data-none="true" aria-pressed={!color} title="No colour" onClick={() => setColor(undefined)} />
                {WORKTREE_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="gt-wt-swatch"
                    aria-pressed={color === option}
                    title={COLOR_LABEL[option]}
                    style={{ background: colorVar(option) }}
                    onClick={() => setColor(option)}
                  />
                ))}
              </div>
            </div>
          )}

          <details className="gt-wt-more" open={copyOn}>
            <summary>
              <label className="gt-checkbox" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={copyOn} onChange={(event) => setCopyOn(event.target.checked)} />
                Copy files git does not track (.env, .venv…)
              </label>
            </summary>
            <div className="gt-wt-field">
              <span className="gt-wt-label">Include</span>
              <ChipsEditor values={include} onChange={setInclude} placeholder=".env, .venv, docs/tmp/**" label="Files to copy" />
            </div>
            <div className="gt-wt-field">
              <span className="gt-wt-label">Exclude</span>
              <ChipsEditor values={exclude} onChange={setExclude} placeholder="**/node_modules" label="Files to leave out" />
            </div>
            {preview && (
              <p className="gt-wt-hint">
                Will copy {preview.entries.length} item{preview.entries.length === 1 ? '' : 's'} · {preview.totalFiles.toLocaleString()} file
                {preview.totalFiles === 1 ? '' : 's'} · {formatBytes(preview.totalBytes)}
                {preview.truncated ? ' — over the limit; the copy will stop part-way' : ''}
                {preview.entries.length > 0 && `: ${preview.entries.slice(0, 6).map((entry) => entry.path).join(', ')}${preview.entries.length > 6 ? '…' : ''}`}
              </p>
            )}
            {preview?.invalidPatterns.map((invalid) => (
              <span key={invalid} className="gt-wt-hint" data-tone="error">
                {invalid}
              </span>
            ))}
            <button type="button" className="gt-button" data-size="small" onClick={saveCopyDefaults}>
              Save as this repository’s default
            </button>
          </details>

          <div className="gt-wt-field">
            <span className="gt-wt-label">After creating</span>
            <div className="gt-wt-radios">
              <label className="gt-checkbox" title={hasUpstream ? 'git pull --ff-only in the new worktree' : 'Only for an existing branch with an upstream'}>
                <input type="checkbox" checked={pull && hasUpstream} disabled={!hasUpstream} onChange={(event) => setPull(event.target.checked)} />
                Pull (fast-forward only)
              </label>
              <label className="gt-checkbox" title={canPush ? `git push --set-upstream ${pushRemote} ${checkedOutBranch}` : 'Only for a new branch, with a remote'}>
                <input type="checkbox" checked={push && canPush} disabled={!canPush} onChange={(event) => setPush(event.target.checked)} />
                Push the new branch{pushRemote ? ` to ${pushRemote}` : ''}
              </label>
              <label className="gt-checkbox">
                <input type="checkbox" checked={lock} onChange={(event) => setLock(event.target.checked)} />
                Lock
              </label>
              {lock && (
                <input type="text" className="gt-text-input gt-wt-reason" placeholder="Reason (optional)" value={lockReason} onChange={(event) => setLockReason(event.target.value)} />
              )}
            </div>
          </div>
        </div>

        <div className="gt-wt-field">
          <span className="gt-wt-label">What will run</span>
          <PlanList
            steps={steps}
            states={runner.states}
            outputs={runner.outputs}
            first={
              <div className="gt-cmdline">
                <span className="gt-cmdline-prefix" aria-hidden="true">
                  git
                </span>
                <input
                  className="gt-cmdline-input"
                  type="text"
                  spellCheck={false}
                  aria-label="The worktree command"
                  value={commandText}
                  onChange={(event) => setEdited(event.target.value)}
                />
                {edited !== undefined && (
                  <button type="button" className="gt-button" data-size="small" onClick={() => setEdited(undefined)}>
                    Reset
                  </button>
                )}
              </div>
            }
          />
        </div>

        {blocker && (branchName || existing || existingQuery || edited !== undefined) && (
          <p className="gt-wt-hint" data-tone="error">
            {blocker}
          </p>
        )}

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" onClick={() => onExplain(COMMANDS['worktree.add'])} style={{ marginRight: 'auto' }}>
            Why this command?
          </button>
          <button type="button" className="gt-button" disabled={busy} onClick={onClose}>
            {runner.finished && !runner.failed ? 'Done' : 'Cancel'}
          </button>
          <button type="button" className="gt-button" data-variant="primary" disabled={busy || blocker !== undefined || !config} onClick={() => void create()}>
            {busy ? 'Creating…' : runner.failed ? 'Try Again' : 'Create Worktree'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Where the suggested folder comes from, said plainly under the field. */
function locationSource(config: WorktreeConfig | undefined): string {
  if (!config) return '';
  const effective = config.effective;
  const scope = config.override.directory !== undefined || config.override.subfolder !== undefined ? 'this repository’s setting' : 'your setting';
  if (effective.subfolder.trim()) return `Inside the repository, in ${effective.subfolder.trim()} (${scope}). Change it in Settings ▸ Worktrees.`;
  if (effective.directory.trim()) return `From ${scope}: ${effective.directory}. Change it in Settings ▸ Worktrees.`;
  return `Next to the repository, in ${config.vars.repoName}.worktrees (the default). Change it in Settings ▸ Worktrees.`;
}

/** The branch-derived folder name to append to a browsed-to folder. */
function folderSourceFolder(source: string, config: WorktreeConfig | undefined): string {
  return folderNameFor(source, config?.effective.preserveBranchHierarchy ?? false);
}
