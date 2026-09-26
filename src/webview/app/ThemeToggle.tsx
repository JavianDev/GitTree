import { THEME_GLYPHS, THEME_LABELS, THEME_TITLES, type ThemeModel } from './useTheme';
import './splitpane.css';

export interface ThemeToggleProps {
  /**
   * Supplied by the shell rather than obtained here.
   *
   * `useTheme` holds React state, so a component calling it independently would
   * get its own copy. The keyboard shortcut also cycles the theme, and with two
   * copies the DOM would update while this button's label kept reporting the
   * theme from before the keystroke.
   */
  model: ThemeModel;
}

/**
 * The palette control, for the toolbar's trailing group.
 *
 * It borrows `.gt-tool` so it sits in the ribbon as one more toolbar button
 * rather than as a control with its own idea of what a button looks like.
 */
export function ThemeToggle({ model }: Readonly<ThemeToggleProps>): React.JSX.Element {
  const { theme, next, cycle } = model;

  return (
    <button
      type="button"
      className="gt-tool gt-theme-toggle"
      // A cycling control that only reports its current state leaves you
      // clicking through five palettes to find out where you are going, so the
      // destination is named as well.
      aria-label={`Theme: ${THEME_TITLES[theme]}. Switch to ${THEME_TITLES[next]}.`}
      title={`Theme: ${THEME_TITLES[theme]} — click for ${THEME_TITLES[next]}`}
      // Marks the panel as pinned away from the editor's own appearance, which
      // is otherwise a silent difference from every other view in the window.
      data-pinned={theme === 'auto' ? undefined : 'true'}
      onClick={cycle}
    >
      <span className="gt-tool-glyph gt-theme-glyph" aria-hidden="true">
        {THEME_GLYPHS[theme]}
      </span>
      <span className="gt-tool-label">{THEME_LABELS[theme]}</span>
    </button>
  );
}
