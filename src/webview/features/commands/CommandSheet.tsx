import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CommandContext,
  type CommandSpec,
  activeFlags,
  renderCommand,
  tokenize,
} from '@shared/commands';
import { RpcRequestError, rpc } from '../../rpc/client';

export interface CommandSheetProps {
  spec: CommandSpec;
  context: CommandContext;
  repoId: string;
  /** Toggleable options for this command, rewriting the command as they change. */
  options?: CommandOption[];
  onExplain: (spec: CommandSpec) => void;
  onClose: () => void;
  /** Fired after a successful run, so the caller can refresh. */
  onApplied?: () => void;
}

export interface CommandOption {
  key: keyof CommandContext;
  label: string;
  /** Why you would want this. Shown beneath the label. */
  hint?: string;
  /** A checkbox toggling a boolean flag (default), or a free-text field. */
  kind?: 'checkbox' | 'text';
  /** Placeholder for a `kind: 'text'` field. */
  placeholder?: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * The editable command sheet.
 *
 * Opened by clicking a toolbar action. Hovering already shows what a button will
 * run; this is where you change it and then run it. Three things make it more
 * than a confirmation dialog:
 *
 *  - **The command is editable.** Toggling an option rewrites the text, and
 *    typing in the text wins over the toggles — so the sheet teaches the flags
 *    and then gets out of the way when you know what you want.
 *  - **What runs is what is written.** The string is split into an argument list
 *    and handed to `spawn` with `shell: false`; there is no shell to reinterpret
 *    it, and nothing else to invoke, since `git` is fixed outside the field.
 *  - **Output stays.** stdout and stderr are shown in place, because a rejected
 *    push or a conflicted merge is information, not an error to dismiss.
 */
export function CommandSheet({
  spec,
  context,
  repoId,
  options = [],
  onExplain,
  onClose,
  onApplied,
}: CommandSheetProps): React.JSX.Element {
  const [ctx, setCtx] = useState<CommandContext>(context);
  const [edited, setEdited] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | undefined>();
  const [confirmed, setConfirmed] = useState(!spec.destructive);

  const inputRef = useRef<HTMLInputElement>(null);

  // Generated from the options unless the user has typed their own.
  const generated = useMemo(() => renderCommand(spec, ctx).replace(/^git /, ''), [spec, ctx]);
  const commandText = edited ?? generated;
  const argv = useMemo(() => tokenize(commandText), [commandText]);
  const flags = useMemo(() => activeFlags(spec, ctx), [spec, ctx]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = async () => {
    if (argv.length === 0 || running || !confirmed) return;

    setRunning(true);
    try {
      const outcome = await rpc.request('commands/run', { repoId, argv });
      setResult(outcome);
      if (outcome.exitCode === 0) onApplied?.();
    } catch (error) {
      setResult({
        stdout: '',
        stderr: error instanceof RpcRequestError ? error.displayText : String(error),
        exitCode: -1,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="gt-sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        className="gt-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gt-cmd-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="gt-sheet-title" id="gt-cmd-title">
          {spec.title}
        </h2>
        <p className="gt-sheet-summary">{spec.summary}</p>

        {/* `git` sits outside the field: this endpoint can only ever run git,
            and showing that as fixed text says so without a warning. */}
        <div className="gt-cmdline">
          <span className="gt-cmdline-prefix" aria-hidden="true">
            git
          </span>
          <input
            ref={inputRef}
            className="gt-cmdline-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            aria-label="Command arguments"
            value={commandText}
            onChange={(event) => setEdited(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void apply();
              }
            }}
          />
          {edited !== undefined && (
            <button
              type="button"
              className="gt-button"
              data-size="small"
              onClick={() => setEdited(undefined)}
              title="Discard your edits and rebuild from the options"
            >
              Reset
            </button>
          )}
        </div>

        {options.length > 0 && (
          <div className="gt-cmd-options">
            {options.map((option) =>
              option.kind === 'text' ? (
                <label className="gt-cmd-option-text" key={String(option.key)} title={option.hint}>
                  <span>{option.label}</span>
                  <input
                    type="text"
                    className="gt-text-input"
                    value={typeof ctx[option.key] === 'string' ? (ctx[option.key] as string) : ''}
                    placeholder={option.placeholder}
                    // Editing the command by hand takes precedence; typing after
                    // that would silently throw the typed command away.
                    disabled={edited !== undefined}
                    onChange={(event) => setCtx({ ...ctx, [option.key]: event.target.value })}
                  />
                </label>
              ) : (
                <label className="gt-checkbox" key={String(option.key)} title={option.hint}>
                  <input
                    type="checkbox"
                    checked={Boolean(ctx[option.key])}
                    // Editing by hand takes precedence; toggling after that would
                    // silently throw the typed command away.
                    disabled={edited !== undefined}
                    onChange={(event) => setCtx({ ...ctx, [option.key]: event.target.checked })}
                  />
                  {option.label}
                </label>
              ),
            )}
          </div>
        )}

        {edited === undefined && flags.length > 0 && (
          <dl className="gt-sheet-flags">
            {flags.map((flag) => (
              <div className="gt-field" key={flag.flag}>
                <dt className="gt-mono">{flag.flag}</dt>
                <dd>{flag.gloss}</dd>
              </div>
            ))}
          </dl>
        )}

        {spec.destructive && (
          <label className="gt-checkbox gt-sheet-warning">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            This can discard work that is not recorded anywhere. Run it anyway.
          </label>
        )}

        {result && (
          <div className="gt-cmd-result" data-failed={result.exitCode !== 0}>
            <span className="gt-cmd-result-head">
              {result.exitCode === 0 ? 'Completed' : `Exited with ${result.exitCode}`}
            </span>
            {/* Verbatim. A rejected push explains itself far better than any
                message written in advance could. */}
            {(result.stderr || result.stdout) && <pre>{result.stderr || result.stdout}</pre>}
          </div>
        )}

        <div className="gt-sheet-actions">
          {spec.concept && (
            <button
              type="button"
              className="gt-button"
              onClick={() => onExplain(spec)}
              style={{ marginRight: 'auto' }}
            >
              Why this command?
            </button>
          )}

          <button type="button" className="gt-button" onClick={onClose}>
            {result?.exitCode === 0 ? 'Done' : 'Cancel'}
          </button>

          <button
            type="button"
            className="gt-button"
            data-variant={spec.destructive ? 'destructive' : 'primary'}
            disabled={running || argv.length === 0 || !confirmed}
            onClick={() => void apply()}
          >
            {running ? 'Running…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
