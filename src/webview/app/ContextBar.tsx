import { forwardRef } from 'react';

/**
 * What the review pane shows. Search is deliberately not one of these — it
 * filters the commit tree, which is a different pane, so making it a mode would
 * mean one control silently meaning two unrelated things.
 */
export type ViewMode = 'changes' | 'history' | 'pullRequest' | 'worktree';

export type SearchField = 'message' | 'author' | 'sha';

export interface HistoryOptions {
  scope: 'all' | 'current';
  order: 'date' | 'topo';
  showRemotes: boolean;
}

export interface SearchOptions {
  field: SearchField;
  query: string;
}

export interface ContextBarProps {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  history: HistoryOptions;
  onHistory: (next: HistoryOptions) => void;
  search: SearchOptions;
  onSearch: (next: SearchOptions) => void;
  /** Shows a third "Pull Request" tab, only while one is selected — never a
   * mode you switch into manually, since there is nothing to show without one. */
  showPrTab?: boolean;
  /** Shows a "Worktree" tab, only while a worktree's details are open. */
  showWorktreeTab?: boolean;
}

/** History first: it is what the middle pane shows, so it is the default reading. */
const MODES: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: 'history', label: 'History', hint: 'Review the selected commit' },
  { id: 'changes', label: 'Changes', hint: 'Review the working tree' },
];

const PR_MODE = { id: 'pullRequest' as const, label: 'Pull Request', hint: 'Review the selected pull request' };
const WORKTREE_MODE = { id: 'worktree' as const, label: 'Worktree', hint: 'The selected worktree’s changes and unpushed commits' };

/**
 * Mode switcher, commit search, and the commit tree's scope.
 *
 * The switcher drives the **review** pane while the search field and the scope
 * selector drive the **commit tree**. That split is the reason the search box
 * lives here permanently rather than behind a mode: a commit search is about
 * the tree, and hiding it inside a third mode would mean losing the tree in
 * order to search it.
 *
 * Ordering and remote-branch visibility used to sit here too and now live in
 * Settings ▸ Appearance. The bar mixed two lifetimes — controls touched many
 * times an hour beside ones set once — and the second kind was pure noise on
 * every screen. `HistoryOptions` still carries them; only their editor moved.
 */
export const ContextBar = forwardRef<HTMLInputElement, ContextBarProps>(function ContextBar(
  { mode, onMode, history, onHistory, search, onSearch, showPrTab, showWorktreeTab },
  searchRef,
) {
  const tabs = [...MODES, ...(showPrTab ? [PR_MODE] : []), ...(showWorktreeTab ? [WORKTREE_MODE] : [])];

  return (
    <div className="gt-context">
      <div className="gt-segmented" role="tablist" aria-label="Review pane">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="gt-segment"
            aria-selected={mode === entry.id}
            title={entry.hint}
            onClick={() => onMode(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <input
        ref={searchRef}
        className="gt-context-input"
        type="search"
        placeholder="Search commits…"
        aria-label="Search commits"
        value={search.query}
        onChange={(event) => onSearch({ ...search, query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && search.query) {
            // Handled here rather than by the global dismiss binding so the
            // first Escape clears the field instead of closing something else.
            event.stopPropagation();
            onSearch({ ...search, query: '' });
          }
        }}
      />
      <Select
        label="Search in"
        value={search.field}
        options={[
          { value: 'message', label: 'Message' },
          { value: 'author', label: 'Author' },
          { value: 'sha', label: 'Commit SHA' },
        ]}
        onChange={(field) => onSearch({ ...search, field: field as SearchField })}
      />

      <span className="gt-toolbar-spacer" />

      <Select
        label="Branch scope"
        value={history.scope}
        options={[
          { value: 'all', label: 'All Branches' },
          { value: 'current', label: 'Current Branch' },
        ]}
        onChange={(scope) => onHistory({ ...history, scope: scope as HistoryOptions['scope'] })}
      />
    </div>
  );
});

function Select({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}>): React.JSX.Element {
  return (
    <select
      className="gt-context-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
