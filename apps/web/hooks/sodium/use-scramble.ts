'use client';

import {useCallback, type RefObject} from 'react';
import {useMotionToken, useTimeline, type TimelineOptions} from '@/hooks/sodium/use-timeline';

// A mono label resolving through random glyphs: WXRKF0OWS, WORKF#OWS, WORKFLOWS. Over --dur-scramble (400ms) the
// letters settle start to end, linear; the ones not yet settled show a glyph that changes every 40ms. Spaces and
// punctuation hold still, so the word keeps its shape, and the face is mono, so the width never moves.
//
// The glyphs are not random. Each is a hash of the seed, the letter's place and the tick, so the same moment always
// shows the same glyphs: on the server and the client, in a test, and in a docs specimen given a clock.
//
// Scramble a label once, when it first appears or its value changes (a status going from Running to Failed, a panel
// header opening). Never a value someone is reading or editing, and never prose: a sentence in moving glyphs cannot be
// read. The hook gives the visible string; keep the real one for screen readers:
//
//   const {text: shown} = useScramble(label, {ref});
//   <span ref={ref} className="type-label"><span aria-hidden>{shown}</span><span className="sr-only">{label}</span></span>

/** The glyphs an unsettled letter shows: capitals, figures and a few marks, all one advance wide in a mono face. */
export const scrambleGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/';
/** ms between glyph changes on an unsettled letter. */
export const scrambleTick = 40;

/** A small integer hash (FNV-1a on 32 bits), so glyphs are a pure function of their inputs. */
export function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const settles = (ch: string) => !/[\p{L}\p{N}]/u.test(ch);

/** The label `elapsed` ms into a scramble of `duration` ms: settled letters from the start, glyphs after them. */
export function scrambleAt(text: string, elapsed: number, {duration = 400, seed = hash(text)}: {duration?: number; seed?: number} = {}): string {
  if (duration <= 0 || elapsed >= duration) return text;
  const chars = Array.from(text);
  const settled = Math.floor(Math.max(0, elapsed) / duration * chars.length);
  const tick = Math.floor(Math.max(0, elapsed) / scrambleTick);
  return chars.map((ch, i) => i < settled || settles(ch) ? ch : scrambleGlyphs[hash(seed, i, tick) % scrambleGlyphs.length]).join('');
}

export type ScrambleOptions = TimelineOptions & {
  /** The element the label sits in, read for --dur-scramble and a reduced-motion wrapper. */
  ref?: RefObject<Element | null>;
  /** ms for the whole label to settle. Default --dur-scramble, 400ms. */
  duration?: number;
  /** Picks the glyphs. Default a hash of the text, so one label always scrambles the same way. */
  seed?: number;
};

export type Scramble = {
  /** The label as it shows now. */
  text: string;
  /** Some letters are still glyphs. */
  scrambling: boolean;
};

export function useScramble(text: string, {ref, duration, seed, clock, play, restart}: ScrambleOptions = {}): Scramble {
  const token = useMotionToken(ref, '--dur-scramble');
  const total = duration ?? token.ms;
  const step = useCallback((ms: number) => ms >= total ? -1 : Math.floor(ms / scrambleTick), [total]);
  const elapsed = useTimeline({total, step, clock, play, restart: restart ?? text, reduced: token.reduced});
  const shown = scrambleAt(text, elapsed, {duration: total, seed});
  return {text: shown, scrambling: shown !== text};
}
