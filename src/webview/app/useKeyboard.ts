import { useEffect, useRef } from 'react';
import { CHORD_TIMEOUT_MS, type CommandId, matchBinding } from './keymap';

export type KeyboardHandlers = Partial<Record<CommandId, () => void>>;

/**
 * True when the event target is somewhere text is being entered.
 *
 * Lives here rather than in `keymap.ts` because it is the one part of the
 * scheme that genuinely needs the DOM, and keeping it out of the matcher is
 * what lets the matcher be tested without one.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Binds the keyboard scheme to the document.
 *
 * Handlers are held in a ref and read at dispatch time, so the listener is
 * attached once for the life of the panel. Re-subscribing whenever a handler
 * closure changes — which is every render, since they close over selection and
 * mode — would tear down and rebuild the listener constantly and drop a
 * keystroke arriving mid-swap.
 *
 * Only commands with a handler consume their key. An unhandled binding falls
 * through to the browser, so a shortcut that is meaningless in the current mode
 * does not silently swallow the keystroke.
 */
export function useKeyboard(handlers: KeyboardHandlers, enabled = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    let chord: string | undefined;
    let chordTimer: number | undefined;

    const clearChord = () => {
      if (chordTimer !== undefined) window.clearTimeout(chordTimer);
      chordTimer = undefined;
      chord = undefined;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeating must not fire an action forty times.
      if (event.repeat) return;

      const result = matchBinding(event, {
        typing: isTypingTarget(event.target),
        ...(chord ? { chord } : {}),
      });

      if (result.kind === 'pending') {
        clearChord();
        chord = result.prefix;
        // Armed prefixes expire, so a `g` pressed and forgotten does not turn
        // the next unrelated keystroke into a mode switch minutes later.
        chordTimer = window.setTimeout(clearChord, CHORD_TIMEOUT_MS);
        event.preventDefault();
        return;
      }

      const wasChording = chord !== undefined;
      clearChord();

      if (result.kind === 'none') {
        // A failed chord completion is still consumed: the user was mid-chord,
        // and letting the miss reach the page would run something unintended.
        if (wasChording) event.preventDefault();
        return;
      }

      const handler = handlersRef.current[result.id];
      if (!handler) return;

      event.preventDefault();
      event.stopPropagation();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearChord();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
