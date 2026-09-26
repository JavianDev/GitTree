import { useCallback, useEffect, useState } from 'react';

/**
 * The palette selector.
 *
 * A theme is nothing but a token override block in `design/themes.css`, so this
 * module never does more than write one attribute on the root element — which
 * is why adding a theme is a stylesheet change and not a code change.
 */

/** Cycle order, starting at the editor's own appearance. */
export const THEMES = ['auto', 'macos-light', 'macos-dark', 'graphite', 'midnight'] as const;

export type ThemeName = (typeof THEMES)[number];

const THEME_ATTRIBUTE = 'data-gt-theme';
const STORAGE_KEY = 'gitTree.theme';

/** Short enough for a toolbar button. */
export const THEME_LABELS: Record<ThemeName, string> = {
  auto: 'Auto',
  'macos-light': 'Light',
  'macos-dark': 'Dark',
  graphite: 'Graphite',
  midnight: 'Midnight',
};

/** The full name, for the tooltip and the accessible label. */
export const THEME_TITLES: Record<ThemeName, string> = {
  auto: 'Follow VS Code',
  'macos-light': 'macOS Light',
  'macos-dark': 'macOS Dark',
  graphite: 'Graphite',
  midnight: 'Midnight',
};

/** Text marks rather than an icon font, as everywhere else in the toolbar. */
export const THEME_GLYPHS: Record<ThemeName, string> = {
  auto: '◐',
  'macos-light': '☀',
  'macos-dark': '☾',
  graphite: '◑',
  midnight: '✦',
};

/** The next palette in the cycle. */
export function nextTheme(current: ThemeName): ThemeName {
  const index = THEMES.indexOf(current);
  return THEMES[(index + 1) % THEMES.length] ?? 'auto';
}

/** A stored value, or undefined when it names a theme this build no longer has. */
export function parseTheme(raw: string | null | undefined): ThemeName | undefined {
  return THEMES.find((theme) => theme === raw);
}

/**
 * Writes the palette onto `<body>` — not `<html>`.
 *
 * This is the difference between the toggle working and doing nothing at all.
 * VS Code stamps its own palette class on `<body>`, and `tokens.css` declares
 * the dark tokens there. Custom properties inherit, so for every element inside
 * `<body>` a declaration on `<body>` beats one on `<html>` no matter how
 * specific the `<html>` rule is — specificity only decides between rules
 * matching the *same* element. A theme applied to the root therefore lost to
 * `body.vscode-dark` every time, silently.
 *
 * On `<body>`, `body[data-gt-theme='…']` (0-2-1) outranks `body.vscode-dark`
 * (0-1-1) and the theme wins, while high contrast still overrides both.
 */
export function applyTheme(theme: ThemeName): void {
  const target = document.body;

  // 'auto' *removes* the attribute rather than setting a value of its own, so
  // the VS Code class takes over again and the panel follows the editor.
  if (theme === 'auto') target.removeAttribute(THEME_ATTRIBUTE);
  else target.setAttribute(THEME_ATTRIBUTE, theme);
}

export interface ThemeModel {
  theme: ThemeName;
  /** Where a click lands next, so the control can say so before it is pressed. */
  next: ThemeName;
  cycle: () => void;
  set: (theme: ThemeName) => void;
}

/**
 * The selected palette, persisted across reloads.
 *
 * localStorage rather than the webview state API for the same reason as
 * `useLayout`: `acquireVsCodeApi()` may be called only once per webview and the
 * RPC client already holds that handle.
 */
export function useTheme(): ThemeModel {
  const [theme, setTheme] = useState<ThemeName>(() => parseTheme(readStored()) ?? 'auto');

  useEffect(() => {
    applyTheme(theme);
    writeStored(theme);
  }, [theme]);

  const cycle = useCallback(() => setTheme((current) => nextTheme(current)), []);

  return { theme, next: nextTheme(theme), cycle, set: setTheme };
}

/** Storage is unavailable in some embeddings, where it throws rather than returning null. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(theme: ThemeName): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // A lost theme preference is not worth interrupting anything over.
  }
}
