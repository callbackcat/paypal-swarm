'use client';

import {useCallback, type RefObject} from 'react';
import {useMotionToken, useTimeline, type TimelineOptions} from '@/hooks/sodium/use-timeline';

// Text that types in, a character at a time, behind a thin bar caret: Sodium's motion for a headline, a label or a
// streamed line. One character every --dur-type (18ms, about 55 a second), linear, then the caret goes. The caret
// never blinks at rest, because a blinking bar after the words are done reads as a field waiting for input.
//
// The hook returns the visible part and whether it is typing; the component draws the caret recipe while it is:
//
//   const {shown, typing} = useTyping(title, {ref});
//   <h2 ref={ref} className="grid [grid-template-areas:'stack']">
//     <span className="invisible [grid-area:stack]">{title}</span>
//     <span aria-hidden className="[grid-area:stack]">{shown}{typing && <span className="caret"/>}</span>
//     <span className="sr-only">{title}</span>
//   </h2>
//
// The full text sits invisible in the same grid cell, so the box is its final size from the first frame and nothing
// around it moves while the words arrive, and a screen reader reads the whole text once.
//
// Characters are code points, so an emoji or an accented letter is never split. A new `text` types again from the
// start; type once, when the text first appears or changes, never a value someone is reading.

/** How many characters show `elapsed` ms after typing starts, one every `perChar` ms. */
export function typedAt(text: string, elapsed: number, perChar: number = 18, delay = 0): number {
  const length = Array.from(text).length;
  if (perChar <= 0) return length;
  return Math.max(0, Math.min(length, Math.floor((elapsed - delay) / perChar)));
}

/** The first `count` characters of `text`, by code point. */
export const firstChars = (text: string, count: number) => Array.from(text).slice(0, count).join('');

export type TypingOptions = TimelineOptions & {
  /** The element the text sits in, read for --dur-type and a reduced-motion wrapper. */
  ref?: RefObject<Element | null>;
  /** ms before the first character. Default 0. */
  delay?: number;
  /** ms per character. Default --dur-type, 18ms. */
  perChar?: number;
};

export type Typing = {
  /** The part that shows now. */
  shown: string;
  /** Characters still to come: draw the caret. */
  typing: boolean;
  /** Every character shows. */
  done: boolean;
};

export function useTyping(text: string, {ref, delay = 0, perChar, clock, play, restart}: TypingOptions = {}): Typing {
  const token = useMotionToken(ref, '--dur-type');
  const each = perChar ?? token.ms;
  const length = Array.from(text).length;
  const step = useCallback((ms: number) => typedAt(text, ms, each, delay), [text, each, delay]);
  const elapsed = useTimeline({total: delay + length * Math.max(0, each), step, clock, play, restart: restart ?? text, reduced: token.reduced});
  const count = typedAt(text, elapsed, each, delay);
  // Before the first character (a delay, or play still false) nothing is typing yet, so no caret stands at rest.
  return {shown: firstChars(text, count), typing: count > 0 && count < length, done: count >= length};
}
