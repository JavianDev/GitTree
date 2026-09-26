import { COMMANDS, type CommandContext, type CommandId, type CommandSpec } from '@shared/commands';
import { CommandPreview } from '../features/commands/CommandPreview';

/** Glyph per action. Text marks rather than an icon font — no extra asset, and they scale. */
const GLYPH: Partial<Record<CommandId, string>> = {
  commit: '⊕',
  pull: '↓',
  push: '↑',
  fetch: '⇅',
  'branch.create': '⑂',
  merge: '⤙',
  'stash.push': '⛁',
  discard: '⊘',
  'tag.create': '🏷',
};

/** Toolbar order, with `null` marking a hairline separator. */
const LAYOUT: Array<CommandId | null> = [
  'commit',
  null,
  'fetch',
  'pull',
  'push',
  null,
  'branch.create',
  'merge',
  'stash.push',
  null,
  'discard',
  'tag.create',
];

export interface ToolbarAction {
  spec: CommandSpec;
  context: CommandContext;
  /** Reason the action is unavailable. Present means disabled. */
  disabledReason?: string;
  /** Badge text, e.g. the ahead count on Push. */
  badge?: string;
}

export interface ToolbarProps {
  actions: Partial<Record<CommandId, ToolbarAction>>;
  onRun: (id: CommandId) => void;
  onExplain: (spec: CommandSpec) => void;
  onTerminal: () => void;
  onSettings: () => void;
  /** The trailing group — theme toggle and anything else the shell owns. */
  trailing?: React.ReactNode;
}

/**
 * The action ribbon.
 *
 * Every button is wrapped in a `CommandPreview`, so the interface teaches by
 * default rather than behind a setting: hovering Pull shows the exact
 * invocation and what each flag does before anything is run.
 *
 * A disabled button states *why* in its tooltip. Silently inert controls are the
 * most common way a Git GUI leaves someone stuck with no idea what to fix.
 */
export function Toolbar({
  actions,
  onRun,
  onExplain,
  onTerminal,
  onSettings,
  trailing,
}: Readonly<ToolbarProps>): React.JSX.Element {
  return (
    <div className="gt-toolbar" role="toolbar" aria-label="Repository actions">
      {LAYOUT.map((id, index) => {
        if (id === null) return <span className="gt-toolbar-sep" key={`sep-${index}`} aria-hidden="true" />;

        const action = actions[id];
        const spec = action?.spec ?? COMMANDS[id];
        const disabled = action?.disabledReason;

        return (
          <CommandPreview key={id} spec={spec} context={action?.context ?? {}} onExplain={onExplain}>
            {(preview) => (
              <button
                type="button"
                className="gt-tool"
                data-destructive={spec.destructive ? 'true' : undefined}
                disabled={Boolean(disabled)}
                // The reason reaches the native tooltip too, so it survives
                // when the popover is suppressed on a disabled control.
                title={disabled}
                onClick={() => onRun(id)}
                {...preview}
              >
                <span className="gt-tool-glyph" aria-hidden="true">
                  {GLYPH[id] ?? '•'}
                </span>
                <span className="gt-tool-label">{spec.title}</span>
                {action?.badge && <span className="gt-tool-badge">{action.badge}</span>}
              </button>
            )}
          </CommandPreview>
        );
      })}

      <span className="gt-toolbar-spacer" />

      {trailing}

      <button type="button" className="gt-tool" onClick={onTerminal} title="Open a terminal at the repository root">
        <span className="gt-tool-glyph" aria-hidden="true">
          ▤
        </span>
        <span className="gt-tool-label">Terminal</span>
      </button>

      <button type="button" className="gt-tool" onClick={onSettings} title="GitTree settings">
        <span className="gt-tool-glyph" aria-hidden="true">
          ⚙
        </span>
        <span className="gt-tool-label">Settings</span>
      </button>
    </div>
  );
}
