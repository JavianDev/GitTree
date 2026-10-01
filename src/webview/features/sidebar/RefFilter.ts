import type { RefEntry } from '@shared/model';

/**
 * Filtering for ref lists.
 *
 * The case this is built for is the real one: forty-seven branches, most of them
 * `feature/INST-<ticket>-<slug>`. A plain "starts with" filter is useless there,
 * because nobody remembers the prefix — they remember the ticket number. So the
 * match runs over the *whole* ref path and does not require the query to be
 * contiguous, letting `11308` or `crmdecoup` both find
 * `feature/INST-11308-crm-decoupling-ingestion`.
 */

export interface RefMatch {
  ref: RefEntry;
  /** Indices in `ref.name` that matched, for highlighting. */
  positions: number[];
  score: number;
}

/**
 * Subsequence match with a relevance score.
 *
 * Returns undefined when the query does not match at all, so callers can
 * distinguish "no match" from "matched with a poor score".
 */
export function matchRef(query: string, ref: RefEntry): RefMatch | undefined {
  const match = matchText(query, ref.name);
  if (!match) return undefined;
  return { ref, positions: match.positions, score: match.score + (ref.isHead && query.trim() ? 10 : 0) };
}

/**
 * The same subsequence match over any text — a worktree's branch or folder
 * name — so the one filter box finds worktrees exactly as it finds branches.
 */
export function matchText(query: string, text: string): { positions: number[]; score: number } | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { positions: [], score: 0 };

  const haystack = text.toLowerCase();
  const positions: number[] = [];

  let cursor = 0;
  let score = 0;
  let previous = -2;

  for (const char of normalized) {
    // Whitespace in the query separates terms rather than being matched.
    if (char === ' ') continue;

    const found = haystack.indexOf(char, cursor);
    if (found === -1) return undefined;

    // Adjacent matches are what a real substring looks like, so they score far
    // higher than characters scattered across the name.
    if (found === previous + 1) score += 8;
    // A match at a segment boundary is a deliberate hit, not a coincidence.
    else if (found === 0 || haystack[found - 1] === '/' || haystack[found - 1] === '-') score += 5;
    else score += 1;

    positions.push(found);
    previous = found;
    cursor = found + 1;
  }

  // Shorter names containing the same match are more likely the intended one.
  score += Math.max(0, 20 - text.length / 4);

  return { positions, score };
}

/** Matching refs, best first. */
export function filterRefs(query: string, refs: readonly RefEntry[]): RefMatch[] {
  const matches: RefMatch[] = [];

  for (const ref of refs) {
    const match = matchRef(query, ref);
    if (match) matches.push(match);
  }

  if (!query.trim()) return matches;

  return matches.sort((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name));
}

/**
 * Splits a name into matched and unmatched runs for highlighting, so the
 * component renders spans instead of recomputing positions.
 */
export function highlightSegments(
  name: string,
  positions: readonly number[],
): Array<{ text: string; matched: boolean }> {
  if (positions.length === 0) return [{ text: name, matched: false }];

  const marked = new Set(positions);
  const segments: Array<{ text: string; matched: boolean }> = [];
  let buffer = '';
  let bufferMatched = marked.has(0);

  for (let i = 0; i < name.length; i++) {
    const matched = marked.has(i);
    if (matched !== bufferMatched && buffer) {
      segments.push({ text: buffer, matched: bufferMatched });
      buffer = '';
    }
    bufferMatched = matched;
    buffer += name[i];
  }

  if (buffer) segments.push({ text: buffer, matched: bufferMatched });
  return segments;
}
