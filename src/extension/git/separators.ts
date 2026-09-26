/**
 * Record separators used by git's machine-readable formats.
 *
 * Named constants rather than inline literals because a NUL or RS in source is
 * invisible in most editors and diffs, and a stray one is undebuggable.
 */

/** Emitted by `-z` and by `%x00` in a `--format` string. */
export const NUL = String.fromCharCode(0);

/** Emitted by `%x1e`; separates commits in the log format. */
export const RS = String.fromCharCode(30);
