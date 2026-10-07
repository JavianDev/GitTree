import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

export interface ConfirmOptions {
  title: string;
  /** What will happen, in a sentence or two. */
  message: string;
  /** The files or items affected, listed under the message. */
  items?: readonly string[];
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * Asks a yes/no question in the panel itself.
 *
 * `window.confirm` cannot be used here: VS Code runs webviews without
 * permission for modal dialogs, so it returns false at once and shows nothing —
 * every action guarded by it silently did nothing.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const finish = (answer: boolean) => {
      root.unmount();
      host.remove();
      resolve(answer);
    };
    root.render(<ConfirmSheet {...options} onAnswer={finish} />);
  });
}

const MAX_LISTED = 8;

function ConfirmSheet({
  title,
  message,
  items,
  confirmLabel,
  destructive,
  onAnswer,
}: ConfirmOptions & { onAnswer: (answer: boolean) => void }): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Cancel has focus, so Enter on a destructive question is the safe answer.
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onAnswer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onAnswer]);

  const shown = items?.slice(0, MAX_LISTED) ?? [];
  const more = (items?.length ?? 0) - shown.length;

  return (
    <div className="gt-sheet-backdrop" role="presentation" onClick={() => onAnswer(false)}>
      <div
        className="gt-sheet gt-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gt-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="gt-sheet-title" id="gt-confirm-title">
          {title}
        </h2>
        <p className="gt-sheet-summary">{message}</p>
        {shown.length > 0 && (
          <ul className="gt-confirm-items">
            {shown.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {more > 0 && <li className="gt-confirm-more">and {more} more</li>}
          </ul>
        )}
        <div className="gt-sheet-actions">
          <button ref={cancelRef} type="button" className="gt-button" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="gt-button"
            data-variant={destructive ? 'destructive' : 'primary'}
            onClick={() => onAnswer(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
