import { useEffect, useState } from 'react';
import { renderArgv } from '@shared/commands';
import type { JournalEntry } from '@shared/model';
import { rpc } from '../../rpc/client';

export interface CommandLogProps {
  open: boolean;
  repoId?: string;
  onSendToTerminal: (command: string) => void;
}

/**
 * The running record of every git command GitTree has executed.
 *
 * This is the substance behind "learn the commands": not a curated tutorial but
 * the actual invocations, with their exit codes and timings. Because every spawn
 * funnels through `GitProcess`, nothing can run without appearing here — the log
 * is complete by construction rather than by discipline.
 *
 * Reads are dimmed so the handful of commands that changed the repository stand
 * out from the constant background of status refreshes.
 */
export function CommandLog({ open, repoId, onSendToTerminal }: CommandLogProps): React.JSX.Element | null {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [mutatingOnly, setMutatingOnly] = useState(true);
  const [copied, setCopied] = useState<number | undefined>();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void rpc
      .request('commands/recent', { limit: 200 })
      .then((result) => {
        if (!cancelled) setEntries(result.entries);
      })
      .catch(() => undefined);

    // New entries prepend, matching the newest-first order of the initial load.
    const off = rpc.on('commands/recorded', ({ entry }) => {
      if (!cancelled) setEntries((current) => [entry, ...current].slice(0, 200));
    });

    return () => {
      // Both halves matter: unsubscribing stops future events, and the flag
      // stops the in-flight request resolving into an unmounted component.
      cancelled = true;
      off();
    };
  }, [open]);

  if (!open) return null;

  const visible = entries
    .filter((entry) => !mutatingOnly || entry.mutating)
    .filter((entry) => !repoId || !entry.repoId || entry.repoId === repoId);

  const copy = (entry: JournalEntry) => {
    // Never throws: a clipboard failure must not become an unhandled rejection
    // in a sandbox with no way to surface one.
    void copyText(renderArgv(entry.args)).then((ok) => {
      if (!ok) return;
      setCopied(entry.id);
      window.setTimeout(() => setCopied(undefined), 1200);
    });
  };

  return (
    <section className="gt-log" aria-label="Command log">
      <header className="gt-log-header">
        <span>Command Log</span>
        <span className="gt-group-count">{visible.length}</span>
        <span className="gt-toolbar-spacer" />

        <label className="gt-checkbox">
          <input
            type="checkbox"
            checked={mutatingOnly}
            onChange={(event) => setMutatingOnly(event.target.checked)}
          />
          Hide reads
        </label>

        <button
          type="button"
          className="gt-button"
          data-size="small"
          onClick={() => {
            void rpc.request('commands/clear', undefined).catch(() => undefined);
            setEntries([]);
          }}
        >
          Clear
        </button>
      </header>

      <div className="gt-log-body">
        {visible.length === 0 ? (
          <p className="gt-empty-detail" style={{ padding: 'var(--gt-space-3)' }}>
            No commands yet. Every git command GitTree runs will appear here.
          </p>
        ) : (
          visible.map((entry) => (
            <article
              key={entry.id}
              className="gt-log-entry"
              data-mutating={entry.mutating}
              data-failed={entry.exitCode !== 0 && !entry.cancelled}
            >
              <time className="gt-log-time" dateTime={new Date(entry.startedAt).toISOString()}>
                {formatTime(entry.startedAt)}
              </time>

              <code className="gt-log-command">{renderArgv(entry.args)}</code>

              <span className="gt-log-result">{describeOutcome(entry)}</span>

              <button
                type="button"
                className="gt-button"
                data-size="small"
                onClick={() => copy(entry)}
                title="Copy this command"
              >
                {copied === entry.id ? 'Copied' : 'Copy'}
              </button>

              <button
                type="button"
                className="gt-button"
                data-size="small"
                onClick={() => onSendToTerminal(renderArgv(entry.args))}
                title="Type this into the terminal without running it"
              >
                Terminal
              </button>

              {entry.stderr && entry.exitCode !== 0 && <pre className="gt-log-stderr">{entry.stderr}</pre>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Copies text, returning whether it worked rather than throwing.
 *
 * `navigator.clipboard` is not dependable inside a webview: it is absent in a
 * non-secure context and rejects outright when the document does not have
 * focus — which is exactly the case when a click lands while focus is still in
 * the editor. The `execCommand` fallback has neither restriction, and both
 * paths are wrapped so a failed copy stays a no-op instead of an uncatchable
 * rejection.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the synchronous path below.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    // Kept in the layout but out of sight: `display: none` would make the
    // selection — and therefore the copy — fail.
    field.style.position = 'fixed';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';

    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

function describeOutcome(entry: JournalEntry): string {
  if (entry.cancelled) return 'cancelled';
  const duration = entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`;
  return entry.exitCode === 0 ? `ok · ${duration}` : `exit ${entry.exitCode} · ${duration}`;
}

function formatTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
