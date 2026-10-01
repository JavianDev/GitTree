export interface SidebarSectionProps {
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Icon buttons at the right of the header, shown on hover and focus. */
  actions?: React.ReactNode;
  onHeaderContextMenu?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}

/**
 * A collapsible sidebar section whose header can also hold actions.
 *
 * The header toggle is a button, and buttons cannot contain buttons, so the
 * toggle and the actions sit side by side in a wrapper instead of the actions
 * living inside the toggle.
 */
export function SidebarSection({
  title,
  count,
  collapsed,
  onToggle,
  actions,
  onHeaderContextMenu,
  children,
}: SidebarSectionProps): React.JSX.Element {
  return (
    <section>
      <div className="gt-section-head" onContextMenu={onHeaderContextMenu}>
        <button type="button" className="gt-section-header" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="gt-disclosure" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          {title}
          {count !== undefined && <span className="gt-group-count">{count}</span>}
        </button>
        {actions && <div className="gt-section-actions">{actions}</div>}
      </div>
      {!collapsed && <div role="tree">{children}</div>}
    </section>
  );
}
