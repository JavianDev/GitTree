import { bindingGroups, formatKey } from './keymap';

export interface ShortcutsSheetProps {
  onClose: () => void;
}

/**
 * The keyboard reference, opened with `?`.
 *
 * Generated from the same binding table the matcher reads, so the help cannot
 * drift from the behaviour — a hand-written shortcut list is wrong within two
 * releases and nobody notices until someone tries a key that no longer exists.
 */
export function ShortcutsSheet({ onClose }: Readonly<ShortcutsSheetProps>): React.JSX.Element {
  const groups = bindingGroups();

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
        className="gt-sheet gt-sheet-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gt-shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="gt-sheet-title" id="gt-shortcuts-title">
          Keyboard
        </h2>

        <p className="gt-sheet-summary">
          Single letters work whenever focus is not in a text box. Every git action opens its
          command sheet first — nothing runs until you press Apply.
        </p>

        <div className="gt-shortcut-groups">
          {groups.map((group) => (
            <section className="gt-shortcut-group" key={group.group}>
              <h3 className="gt-shortcut-heading">{group.group}</h3>

              <dl className="gt-shortcut-list">
                {group.bindings.map((binding) => (
                  <div className="gt-shortcut-row" key={binding.id}>
                    <dt>
                      {binding.keys.map((key, index) => (
                        <span className="gt-shortcut-keys" key={key}>
                          {/* Aliases read as alternatives, not as a sequence. */}
                          {index > 0 && <span className="gt-shortcut-or">or</span>}
                          {formatKey(key).map((cap, capIndex) =>
                            cap === 'then' ? (
                              <span className="gt-shortcut-then" key={`${key}-${capIndex}`}>
                                then
                              </span>
                            ) : (
                              <kbd key={`${key}-${capIndex}`}>{cap}</kbd>
                            ),
                          )}
                        </span>
                      ))}
                    </dt>
                    <dd>{binding.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" data-variant="primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
