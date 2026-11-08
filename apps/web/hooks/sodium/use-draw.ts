'use client';

import {useCallback, useRef, type RefObject} from 'react';
import {easeOut, useMotionToken, useTimeline, type TimelineOptions} from '@/hooks/sodium/use-timeline';

// Connectors that draw out from their node, one hop after another: a run's steps joining up, a graph building. Each
// hop takes --dur-draw (300ms) on Sodium's ease-out, and the next starts when the last ends. The hook gives each hop's
// progress from 0 to 1; the component scales its line by it from the end the line starts at, and shows the square that
// ends the hop at 1:
//
//   const progress = useDraw(steps.length, {ref});
//   <li style={{'--draw': progress[i]}}><span className="origin-top scale-y-(--draw) ..."/></li>
//
// Hops added later (a new step arriving in a live run) draw from the moment they arrive, or when the hop before them
// ends if that is later, so a burst of steps still draws one hop at a time. Hops already drawn stay drawn. Given a
// clock, hop i starts at i hops, so the same clock always draws the same picture.

/** Each hop's progress, 0 to 1 on the ease-out, `elapsed` ms in, when hop i starts at starts[i] (default i hops). */
export function drawAt(elapsed: number, count: number, hop: number = 300, starts?: readonly number[]): number[] {
  return Array.from({length: count}, (_, i) => {
    if (elapsed === Number.POSITIVE_INFINITY || hop <= 0) return 1;
    const start = starts?.[i];
    if (starts && start === undefined) return 0;
    return easeOut((elapsed - (start ?? i * hop)) / hop);
  });
}

export type DrawOptions = TimelineOptions & {
  /** The element the lines sit in, read for --dur-draw and a reduced-motion wrapper. */
  ref?: RefObject<Element | null>;
  /** ms per hop. Default --dur-draw, 300ms. */
  hop?: number;
};

/** Frames of a line, so the clock re-renders about 60 times a second while a hop draws and never at rest. */
const FRAME = 16;

export function useDraw(count: number, {ref, hop, clock, play, restart}: DrawOptions = {}): number[] {
  const token = useMotionToken(ref, '--dur-draw');
  const each = hop ?? token.ms;
  const controlled = clock !== undefined;
  // When each hop starts, on the hook's own clock. Read and extended during render from the time the clock last showed,
  // which is the same on every render of one commit, so the starts never depend on when React happens to render.
  const starts = useRef<number[]>([]);
  const last = useRef(0);
  const key = useRef(restart);
  if (!Object.is(key.current, restart)) { key.current = restart; starts.current = []; last.current = 0; }
  if (!controlled) {
    for (let i = starts.current.length; i < count; i++) starts.current.push(Math.max(i === 0 ? 0 : starts.current[i - 1] + each, i === 0 ? 0 : last.current));
    if (starts.current.length > count) starts.current.length = count;
  }
  const total = controlled ? count * each : (starts.current.at(-1) ?? 0) + (count ? each : 0);
  const step = useCallback((ms: number) => ms >= total ? -1 : Math.floor(ms / FRAME), [total]);
  const elapsed = useTimeline({total, step, clock, play, restart, reduced: token.reduced});
  if (Number.isFinite(elapsed)) last.current = elapsed;
  return drawAt(elapsed, count, each, controlled ? undefined : starts.current);
}
