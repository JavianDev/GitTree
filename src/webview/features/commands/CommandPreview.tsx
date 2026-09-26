import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CommandContext, type CommandSpec, activeFlags, renderCommand } from '@shared/commands';

export interface CommandPreviewProps {
  spec: CommandSpec;
  context?: CommandContext;
  /** Opens the teaching card for this command. */
  onExplain?: (spec: CommandSpec) => void;
  children: (props: {
    'aria-describedby': string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }) => React.JSX.Element;
}

/**
 * Wraps a control so hovering or focusing it reveals the command it will run.
 *
 * The command string comes from `spec.build()` — the same function the host
 * calls to produce what it spawns. There is no second rendering path that could
 * drift, which matters more here than anywhere else in the app: a teaching
 * surface that shows a command subtly different from the one that ran is worse
 * than showing nothing.
 *
 * Only flags this particular invocation will actually use are glossed, so a
 * plain fetch does not explain `--prune` it is not passing.
 */
export function CommandPreview({
  spec,
  context = {},
  onExplain,
  children,
}: CommandPreviewProps): React.JSX.Element {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | undefined>();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const command = renderCommand(spec, context);
  const flags = activeFlags(spec, context);

  /**
   * The popover is rendered into `document.body`, not beside its button.
   *
   * The toolbar scrolls horizontally, and a scroll container clips anything
   * positioned inside it — so an in-place popover was being cut off at the
   * toolbar's edge exactly when it appeared. Portalling it out and positioning
   * from the anchor's measured rect keeps it whole wherever the trigger sits.
   */
  const show = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Flip to the left of the anchor when a right-aligned popover would run off
    // the panel, which is common for the trailing toolbar buttons.
    const width = 340;
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    setAnchor({ left, top: rect.bottom + 6 });
  }, []);

  const hide = useCallback(() => setAnchor(undefined), []);

  return (
    <span className="gt-preview-anchor" ref={anchorRef}>
      {children({
        'aria-describedby': id,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}

      {anchor &&
        createPortal(
          <span
            className="gt-preview"
            id={id}
            role="tooltip"
            style={{ left: anchor.left, top: anchor.top }}
          >
          <code className="gt-preview-command">{command}</code>
          <span className="gt-preview-summary">{spec.summary}</span>

          {flags.length > 0 && (
            <span className="gt-preview-flags">
              {flags.map((entry) => (
                <span className="gt-preview-flag" key={entry.flag}>
                  <code>{entry.flag}</code>
                  <span>{entry.gloss}</span>
                </span>
              ))}
            </span>
          )}

          {spec.concept && onExplain && (
            <button
              type="button"
              className="gt-preview-explain"
              // Pointer-down rather than click: the blur from the button taking
              // focus would otherwise close the popover before the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
                onExplain(spec);
              }}
            >
              Why this command?
            </button>
          )}
          </span>,
          document.body,
        )}
    </span>
  );
}
