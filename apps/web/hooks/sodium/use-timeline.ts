'use client';

import {useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react';

// The clock under Sodium's text and line motion: typing (use-typing), scrambles (use-scramble) and connectors that draw
// (use-draw). Each of those is a pure function of elapsed time plus a hook that feeds it this clock, so:
//
// - Given `clock` (elapsed ms), a hook draws that one moment and runs nothing. The same clock always gives the same
//   frame, so a test, a docs specimen or a parent that runs its own timeline gets a still picture it can trust.
// - Without it, one requestAnimationFrame loop runs from mount, re-renders only when the visible step changes (a new
//   character, a new scramble tick, a new frame of a line), stops on its own at the end, and is cancelled on unmount.
//   Nothing is set after unmount and nothing loops at rest.
// - Reduced motion shows the final state at once. It reads three things, so the docs' forced wrapper works too: the
//   media query, a data-force-reduced-motion ancestor of the element, and the motion token on the element, which
//   tokens.css zeroes under both.
// - The server and the first client render agree: they draw the start (or the clock's moment), and the layout effect
//   moves to the final state before the first paint when motion is reduced.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The motion tokens' values in ms, used before the element can be read and when it cannot. tokens.css is the source. */
export const motionDefaults = {'--dur-type': 18, '--dur-scramble': 400, '--dur-draw': 300} as const;
export type MotionToken = keyof typeof motionDefaults;

/** A duration token's value in ms from a computed style ("18ms", "0.3s"), or undefined when it is not set. */
export function parseDuration(value: string): number | undefined {
  const m = value.trim().match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

/**
 * Sodium's ease-out, cubic-bezier(0.2, 0.8, 0.2, 1), as y for x in 0..1: it arrives fast and stops, no overshoot.
 * Solved by bisection, so it is exact to well under a pixel and never leaves 0..1.
 */
export function easeOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = [0.2, 0.8, 0.2, 1];
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2;
    if (at(t, x1, x2) < x) lo = t; else hi = t;
  }
  return at(t, y1, y2);
}

/**
 * Whether motion is reduced for this element, and the token's duration in ms. Reduced is the media query, a
 * data-force-reduced-motion ancestor, or the token at 0 (tokens.css zeroes it under both).
 */
export function useMotionToken(ref: RefObject<Element | null> | undefined, token: MotionToken): {ms: number; reduced: boolean} {
  const [state, setState] = useState<{ms: number; reduced: boolean}>({ms: motionDefaults[token], reduced: false});
  useIsoLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => {
      const el = ref?.current;
      const value = el ? parseDuration(getComputedStyle(el).getPropertyValue(token)) : undefined;
      const ms = value ?? motionDefaults[token];
      const reduced = media.matches || !!el?.closest('[data-force-reduced-motion]') || ms <= 0;
      setState(s => s.ms === ms && s.reduced === reduced ? s : {ms, reduced});
    };
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, [ref, token]);
  return state;
}

export type TimelineOptions = {
  /** Elapsed ms, controlled. Given, the hook draws this moment and runs no clock: deterministic. */
  clock?: number;
  /** Holds at the start while false, and starts when it turns true. Default true. */
  play?: boolean;
  /** Starts again from 0 when this value changes (Object.is), such as the text being typed. */
  restart?: unknown;
};

type Internal = TimelineOptions & {
  /** When the motion is over, in ms. The clock stops there; raising it later carries on from where it stopped. */
  total: number;
  /** The visible step at a time. The hook re-renders only when it changes. */
  step: (ms: number) => number;
  /** Shows the end at once. */
  reduced: boolean;
};

/**
 * Elapsed ms on Sodium's motion clock: `clock` when given, Infinity when reduced (every motion's final state), else a
 * frame loop from mount. Re-renders only when `step` changes and stops at `total`.
 */
export function useTimeline({total, step, clock, play = true, restart, reduced}: Internal): number {
  const [state, setState] = useState<{key: unknown; ms: number}>({key: restart, ms: 0});
  // A new restart value reads as 0 in the same render, so the next text never shows one frame of the last one's time.
  const ms = Object.is(state.key, restart) ? state.ms : 0;
  const elapsed = useRef(ms);
  elapsed.current = ms;
  const stepRef = useRef(step);
  stepRef.current = step;
  const controlled = clock !== undefined;

  useEffect(() => {
    if (controlled || reduced || !play) return;
    if (elapsed.current >= total) return;
    let frame = 0;
    const base = performance.now() - elapsed.current;
    let last = stepRef.current(elapsed.current);
    const tick = (now: number) => {
      const t = Math.min(total, now - base);
      const s = stepRef.current(t);
      if (s !== last || t >= total) {
        last = s;
        setState({key: restart, ms: t});
      }
      if (t < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [controlled, reduced, play, total, restart]);

  if (controlled) return Math.max(0, clock);
  if (reduced) return Number.POSITIVE_INFINITY;
  return ms;
}
