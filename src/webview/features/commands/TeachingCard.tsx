import { type CommandSpec, renderCommand } from '@shared/commands';

export interface TeachingCardProps {
  spec: CommandSpec;
  onClose: () => void;
}

/**
 * The concept behind a command, not just its flags.
 *
 * The preview popover answers "what will this run"; this answers "why, and what
 * is it doing to my repository". They are different questions — knowing that
 * `--rebase` replays commits does not tell you when rebasing is a bad idea — and
 * conflating them makes the popover too heavy to hover casually.
 *
 * Presented as a HIG sheet: dimmed backdrop, spring entry, dismissed with Escape.
 */
export function TeachingCard({ spec, onClose }: TeachingCardProps): React.JSX.Element {
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
        aria-labelledby="gt-teaching-title"
        // The backdrop closes on click; the sheet itself must not.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="gt-sheet-title" id="gt-teaching-title">
          {spec.title}
        </h2>

        <code className="gt-preview-command">{renderCommand(spec, {})}</code>

        <p className="gt-sheet-summary">{spec.summary}</p>

        {spec.concept && <p className="gt-sheet-body">{spec.concept}</p>}

        {spec.flags.length > 0 && (
          <dl className="gt-sheet-flags">
            {spec.flags.map((flag) => (
              <div className="gt-field" key={flag.flag}>
                <dt className="gt-mono">{flag.flag}</dt>
                <dd>{flag.gloss}</dd>
              </div>
            ))}
          </dl>
        )}

        {spec.destructive && (
          <p className="gt-sheet-warning">
            This command can discard work that is not recorded anywhere. GitTree asks for
            confirmation and names exactly what will be lost before running it.
          </p>
        )}

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" data-variant="primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
