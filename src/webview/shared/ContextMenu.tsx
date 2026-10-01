import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  run: () => void;
  destructive?: boolean;
  separator?: boolean;
  /** One-line explanation, shown as the item's native tooltip. */
  hint?: string;
  /**
   * Why the item cannot be used right now. A disabled item stays in the menu
   * with its reason as the tooltip, so a missing action is explained rather
   * than hidden.
   */
  disabled?: string;
  /** The action a double-click or Enter would take; shown in bold. */
  default?: boolean;
  /** A key hint shown at the right edge, e.g. "Enter". */
  shortcut?: string;
  /** A colour token (CSS value) for a leading swatch, e.g. a colour label. */
  swatch?: string;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

/**
 * A right-click context menu, positioned near the cursor.
 *
 * Modeled on CommandPreview.tsx's portal + viewport-aware positioning,
 * but click-toggled instead of hover-toggled. Shared across any row-based
 * list (file rows, stash rows, PR rows, worktree rows, ...) rather than owned
 * by one feature.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Deferred a tick: the click that opened a menu from another menu would
    // otherwise land here and close it straight away.
    const timer = setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Flip to the left if the menu would run off the right edge.
  const width = 240;
  const left = Math.min(x, Math.max(8, window.innerWidth - width - 8));
  // Flip upward if the menu would run off the bottom.
  const height = Math.max(24, items.length * 28 + 8);
  const top = Math.min(y, Math.max(8, window.innerHeight - height - 8));

  return createPortal(
    <div
      ref={menuRef}
      className="gt-file-menu"
      role="menu"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

/** The items of a menu, for a container that positions itself (the commit panel). */
export function MenuItems({
  items,
  onClose,
}: {
  items: readonly ContextMenuItem[];
  onClose: () => void;
}): React.JSX.Element {
  return (
    <>
      {items.map((item, index) =>
        item.separator ? (
          <div key={index} className="gt-file-menu-separator" />
        ) : (
          <button
            key={index}
            type="button"
            className="gt-file-menu-item"
            data-destructive={item.destructive ? 'true' : undefined}
            data-default={item.default ? 'true' : undefined}
            role="menuitem"
            disabled={item.disabled !== undefined}
            aria-disabled={item.disabled !== undefined}
            title={item.disabled ?? item.hint}
            onClick={() => {
              if (item.disabled !== undefined) return;
              item.run();
              onClose();
            }}
          >
            {item.swatch && <span className="gt-file-menu-swatch" style={{ background: item.swatch }} aria-hidden="true" />}
            <span className="gt-file-menu-label">{item.label}</span>
            {item.shortcut && <span className="gt-file-menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </>
  );
}
