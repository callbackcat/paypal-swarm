'use client';

import {useEffect, useRef, useState} from 'react';
import {useScramble} from '@/hooks/sodium/use-scramble';
import {cn} from '@/lib/sodium/utils';
import {formatElapsed} from '@/components/sodium/ai/tool-call-row';

// What a run is doing now, on one line. Three moments, one look each:
//
// - waiting: the gap before the first step. The pending mark and a mono label ("Starting"). It shows only after `delay`
//   ms and stays at least `minLoader` ms once shown, so a run that answers at once never flashes it.
// - active: the live step as a mono label ("Writing partitions") behind the pending mark, then the time it has run in
//   tabular figures. A new phrase scrambles into place over --dur-scramble, start to end, and holds at least
//   `minDisplay` ms (1000) before the next replaces it; phrases that arrive in between are skipped, so a burst of
//   steps reads as steps, not flicker.
// - done: a sentence in the sans, text-2 ("Wrote 1,204 partitions and compacted 12 files."), then the end word as a
//   mono label: Done in the done green, Warnings in the warning orange, Failed in the failure red, Stopped in text-3.
//   Going inactive waits `settle` ms first, so one step ending and the next starting read as one live line.
//
// The phrase is a name for what is happening, so it is a label; the summary is a sentence, so it is sans. The time is a
// value and stays as written. The pending mark is the one loop; reduced motion holds it still and lands the phrase at
// once.

/** The least time a live phrase stays before the next one replaces it, ms. */
const MIN_DISPLAY = 1000;

const irregular: Record<string, string> = {
  running: 'ran', reading: 'read', writing: 'wrote', finding: 'found', building: 'built', sending: 'sent',
  getting: 'got', making: 'made', setting: 'set', putting: 'put', splitting: 'split', rebuilding: 'rebuilt',
  rerunning: 'reran', resetting: 'reset', rewriting: 'rewrote', holding: 'held', drawing: 'drew', choosing: 'chose',
};
const vowel = (ch: string | undefined) => !!ch && 'aeiou'.includes(ch);

/** "Writing partitions" to "Wrote partitions": -ing verbs and the irregulars a run uses most. */
function pastTense(phrase: string): string {
  const [first, ...rest] = phrase.split(' ');
  const word = first.toLowerCase();
  if (!word.endsWith('ing') || word.length < 5) return phrase;
  const stem = word.slice(0, -3);
  const past = irregular[word] ?? (stem.endsWith('y') && !vowel(stem.at(-2)) ? `${stem.slice(0, -1)}ied` : `${stem}ed`);
  const cased = first[0] === first[0].toUpperCase() ? past[0].toUpperCase() + past.slice(1) : past;
  return [cased, ...rest].join(' ');
}

/** Holds each phrase for `hold` ms and keeps only the newest one waiting. */
function useHeldPhrase(label: string, active: boolean, hold: number) {
  const [shown, setShown] = useState(label);
  const shownAt = useRef(0);
  useEffect(() => {
    if (label === shown) return;
    if (!active) { setShown(label); shownAt.current = Date.now(); return; }
    const wait = Math.max(0, hold - (Date.now() - shownAt.current));
    const timer = setTimeout(() => { setShown(label); shownAt.current = Date.now(); }, wait);
    return () => clearTimeout(timer);
  }, [label, shown, active, hold]);
  return shown;
}

/** True while active and for `settle` ms after, so a quick stop and start never flickers. */
function useSettled(active: boolean, settle: number) {
  const [live, setLive] = useState(active);
  useEffect(() => {
    if (active) { setLive(true); return; }
    const timer = setTimeout(() => setLive(false), settle);
    return () => clearTimeout(timer);
  }, [active, settle]);
  return active || live;
}

/** True only after `show` has held `delay` ms, and then for at least `min` ms. */
function useAntiFlicker(show: boolean, delay = 150, min = 400) {
  const [visible, setVisible] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (show && !visible) {
      const t = setTimeout(() => { since.current = Date.now(); setVisible(true); }, delay);
      return () => clearTimeout(t);
    }
    if (!show && visible) {
      const t = setTimeout(() => setVisible(false), Math.max(0, min - (Date.now() - since.current)));
      return () => clearTimeout(t);
    }
  }, [show, visible, delay, min]);
  return visible;
}

type ActivityEnd = 'ok' | 'warn' | 'fail' | 'stopped';

type ActivityLabels = {
  /** The waiting label when `label` is not set. */
  starting?: string;
  /** The end words. */
  ok?: string;
  warn?: string;
  fail?: string;
  stopped?: string;
};
const activityLabels: Required<ActivityLabels> = {starting: 'Starting', ok: 'Done', warn: 'Warnings', fail: 'Failed', stopped: 'Stopped'};
const endTone: Record<ActivityEnd, string> = {ok: 'text-ok-text', warn: 'text-warn-text', fail: 'text-fail-text', stopped: 'text-text-3'};

type ActivityProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** The live phrase, an -ing verb and its object in sentence case: "Writing partitions". */
  label?: string;
  /** A step is running now. */
  active?: boolean;
  /** Nothing has happened yet in this run: shows the waiting line with `label` (default "Starting"). */
  waiting?: boolean;
  /** ms the run has gone, shown after a live phrase. */
  elapsed?: number;
  /** The finished sentence. Default the past tense of the last phrase, with a full stop. */
  summary?: string;
  /** How the run ended: the end word and its colour. */
  status?: ActivityEnd;
  /** 13px labels, or 12px for a dense header. */
  size?: 'default' | 'sm';
  minDisplay?: number;
  settle?: number;
  delay?: number;
  minLoader?: number;
  /** Elapsed ms for the phrase's scramble, for a still picture. */
  clock?: number;
  /** Owns a polite status region that reads the waiting label and the summary. Default true. */
  announce?: boolean;
  labels?: ActivityLabels;
};

function Activity({
  label, active = false, waiting = false, elapsed, summary, status = 'ok', size = 'default',
  minDisplay = MIN_DISPLAY, settle = 400, delay = 150, minLoader = 400, clock, announce = true, labels, className, ...props
}: ActivityProps) {
  const words = {...activityLabels, ...labels};
  const ref = useRef<HTMLDivElement>(null);
  const loader = useAntiFlicker(waiting, delay, minLoader);
  const live = useSettled(active, settle);
  const phrase = useHeldPhrase(label ?? '', live, minDisplay);
  const state = loader ? 'waiting' : live ? 'active' : waiting || (!label && !summary) ? 'idle' : 'done';
  const moving = state === 'active' || state === 'waiting';
  const liveText = state === 'waiting' ? (label ?? words.starting) : phrase;
  const {text: scrambled} = useScramble(liveText, {ref, clock, play: moving});
  const done = summary ?? (phrase ? `${pastTense(phrase)}.` : '');
  const announced = state === 'done' ? `${done} ${words[status]}` : state === 'waiting' ? liveText : '';
  const label_ = size === 'sm' ? 'type-label-sm' : 'type-label';

  return <div
    ref={ref}
    data-slot="activity"
    data-state={state}
    data-size={size}
    aria-busy={moving || undefined}
    className={cn('flex max-w-full min-w-0 items-center gap-3', size === 'sm' ? 'min-h-(--control-sm)' : 'min-h-(--control)', className)}
    {...props}
  >
    {moving && <>
      <span aria-hidden className="pending shrink-0 text-text-1"/>
      <span className={cn('min-w-0 truncate text-text-1', label_)}>
        <span aria-hidden>{scrambled}</span>
        <span className="sr-only">{liveText}</span>
      </span>
      {state === 'active' && elapsed !== undefined && <span className="shrink-0 type-code-sm text-text-3">{formatElapsed(elapsed)}</span>}
    </>}
    {state === 'done' && <>
      {/* A sentence wraps rather than losing its end; the word stays on the line it ends. */}
      <span className={cn('min-w-0 text-text-2', size === 'sm' ? 'type-caption' : 'type-body-sm')}>{done}</span>
      <span aria-hidden className={cn('shrink-0', size === 'sm' ? 'type-micro' : 'type-label-sm', endTone[status])}>{words[status]}</span>
    </>}
    {announce && <span role="status" className="sr-only">{announced}</span>}
  </div>;
}

export {Activity, pastTense, type ActivityEnd, type ActivityLabels, type ActivityProps};
