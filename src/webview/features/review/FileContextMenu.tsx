import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface FileContextMenuItem {
  label: string;
  run: () => void;
  destructive?: boolean;
  separator?: boolean;
}

export interface FileContextMenuProps {
  x: number;
  y: number;
  items: readonly FileContextMenuItem[];
  onClose: () => void;
}

/**
 * A right-click context menu for file rows, positioned near the cursor.
 *
 * Modeled on CommandPreview.tsx's portal + viewport-aware positioning,
 * but click-toggled instead of hover-toggled.
 */
export function FileContextMenu({
  x,
  y,
  items,
  onClose,
}: FileContextMenuProps): React.JSX.Element {
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

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Flip to the left if the menu would run off the right edge.
  const width = 220;
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
      {items.map((item, index) =>
        item.separator ? (
          <div key={index} className="gt-file-menu-separator" />
        ) : (
          <button
            key={index}
            type="button"
            className="gt-file-menu-item"
            data-destructive={item.destructive ? 'true' : undefined}
            role="menuitem"
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
