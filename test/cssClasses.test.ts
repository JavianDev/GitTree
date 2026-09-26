import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dangling-class guard.
 *
 * A class named in the markup and defined in no stylesheet is invisible. The
 * element renders, nothing throws, and the rule that was meant to lay it out
 * simply is not there. That is how `.gt-history-pane` shipped: the pane fell
 * back to `display: block`, the flex properties on its child stopped meaning
 * anything, and the commit graph was painted shorter than the list beside it.
 * Nothing in the build had an opinion about it — which is what this test is for.
 *
 * Only `gt-` classes are checked. The rest belong to VS Code or to the platform
 * and are not ours to define, so including them would only make noise.
 */

const WEBVIEW = fileURLToPath(new URL('../src/webview', import.meta.url));

/**
 * Stands in for a `${...}` inside a template literal.
 *
 * A class name that touches an interpolation is not knowable from the source,
 * so it is dropped rather than checked. Substituting a space instead would turn
 * `gt-lane-${n}` into a claim that `.gt-lane-` should exist.
 */
const DYNAMIC = '\u0000';

/* -------------------------------------------------------------------------- */
/* Reading the tree                                                           */
/* -------------------------------------------------------------------------- */

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full, extensions));
    else if (extensions.includes(path.extname(entry.name))) found.push(full);
  }

  return found.sort();
}

/** Repo-relative and slash-separated, so a failure reads the same on every OS. */
function relative(file: string): string {
  return path.relative(WEBVIEW, file).split(path.sep).join('/');
}

/* -------------------------------------------------------------------------- */
/* What the markup asks for                                                   */
/* -------------------------------------------------------------------------- */

/** Index of the closing quote of the literal starting at `start`. */
function endOfQuoted(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') index++;
    else if (char === quote) return index;
  }

  return text.length;
}

/** Index just past the `}` closing the interpolation that starts at `start`. */
function endOfInterpolation(text: string, start: number): number {
  let depth = 1;
  let index = start;

  while (index < text.length) {
    const char = text[index];
    index++;

    if (char === '"' || char === "'" || char === '`') {
      index = endOfQuoted(text, index - 1, char) + 1;
      continue;
    }

    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }

  return index;
}

/**
 * Every string literal in an expression, in no particular order.
 *
 * Template literals contribute their static text, and each `${...}` is followed
 * into: a class that only ever appears inside a ternary or a `clsx` join is
 * still a class, and those are exactly the ones nobody remembers to style.
 */
function stringsIn(expression: string, found: string[] = []): string[] {
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === "'" || char === '"') {
      const end = endOfQuoted(expression, index, char);
      found.push(expression.slice(index + 1, end));
      index = end + 1;
      continue;
    }

    if (char === '`') {
      let chunk = '';
      index++;

      while (index < expression.length && expression[index] !== '`') {
        if (expression[index] === '\\') {
          index += 2;
          continue;
        }

        if (expression[index] === '$' && expression[index + 1] === '{') {
          const end = endOfInterpolation(expression, index + 2);
          stringsIn(expression.slice(index + 2, end - 1), found);
          chunk += DYNAMIC;
          index = end;
          continue;
        }

        chunk += expression[index];
        index++;
      }

      found.push(chunk);
      index++;
      continue;
    }

    index++;
  }

  return found;
}

/** The text inside a `{...}`, brace-matched so nested objects do not end it early. */
function braced(text: string): string {
  return text.slice(1, endOfInterpolation(text, 1) - 1);
}

function classesUsed(source: string): string[] {
  const attribute = /\bclassName\s*=\s*/g;
  const literals: string[] = [];

  for (let match = attribute.exec(source); match; match = attribute.exec(source)) {
    const at = match.index + match[0].length;
    const char = source[at];

    if (char === '"' || char === "'") {
      literals.push(source.slice(at + 1, endOfQuoted(source, at, char)));
    } else if (char === '{') {
      stringsIn(braced(source.slice(at)), literals);
    }
  }

  const found = new Set<string>();
  for (const literal of literals) {
    for (const token of literal.split(/\s+/)) {
      if (token.startsWith('gt-') && !token.includes(DYNAMIC)) found.add(token);
    }
  }

  return [...found];
}

/* -------------------------------------------------------------------------- */
/* What the stylesheets provide                                               */
/* -------------------------------------------------------------------------- */

/**
 * Class names a stylesheet defines, wherever they appear in a selector.
 *
 * Comments come out first. `.gt-history-pane` was named in prose directly above
 * the rule that was missing, so a scanner that reads comments would have looked
 * straight at the bug and called it styled.
 */
function definedIn(css: string): string[] {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...rules.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].flatMap((match) => match[1] ?? []);
}

/* -------------------------------------------------------------------------- */

describe('webview class names', () => {
  const sources = filesUnder(WEBVIEW, ['.ts', '.tsx']);
  const stylesheets = filesUnder(WEBVIEW, ['.css']);

  const defined = new Set(stylesheets.flatMap((file) => definedIn(readFileSync(file, 'utf8'))));
  const used = sources.flatMap((file) =>
    classesUsed(readFileSync(file, 'utf8')).map((className) => ({ className, file })),
  );

  it('is actually reading the webview', () => {
    // A scanner that matched nothing would report a clean sheet for ever, and
    // the suite would go green on the exact bug it was written to catch.
    expect(sources.length).toBeGreaterThan(10);
    expect(stylesheets.length).toBeGreaterThan(0);
    expect(used.length).toBeGreaterThan(50);
    expect(defined.has('gt-split-pane')).toBe(true);
  });

  it('defines every gt- class the markup asks for', () => {
    const dangling = used
      .filter((usage) => !defined.has(usage.className))
      .map((usage) => `${usage.className} — used in ${relative(usage.file)}`);

    expect([...new Set(dangling)].sort()).toEqual([]);
  });
});
