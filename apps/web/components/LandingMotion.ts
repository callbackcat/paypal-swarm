"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { reducedMotion } from "@/lib/sodium/utils";

// Motion for the landing page's coded stills. Both hooks rest on the finished picture: with reduced motion, or
// without the browser APIs, the still shows its measured numbers at once and nothing moves.

/** True from the first time the element is at least `amount` in view. */
function useSeen<T extends Element>(ref: RefObject<T | null>, amount = 0.4) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, amount]);
  return seen;
}

/**
 * A 0 to 1 progress that runs once, when the element scrolls into view, arriving fast and stopping (ease-out).
 * Multiply a target by it to count a number or grow a bar. It is 1 from the start under reduced motion.
 */
export function useRevealProgress<T extends Element>(durationMs = 1100) {
  const ref = useRef<T | null>(null);
  const seen = useSeen(ref);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reducedMotion(ref.current)) {
      setProgress(1);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - started) / durationMs, 1);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [seen, durationMs]);
  return { ref, progress };
}

/**
 * A counter that starts at `start` and adds one every `everyMs` while the element is in view and the tab is
 * visible. It stays at `start` under reduced motion.
 */
export function useTicker<T extends Element>(start: number, everyMs: number) {
  const ref = useRef<T | null>(null);
  const [n, setN] = useState(start);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion(el) || typeof IntersectionObserver === "undefined")
      return;
    let inView = false;
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
    });
    io.observe(el);
    const timer = setInterval(() => {
      if (inView && !document.hidden) setN((v) => v + 1);
    }, everyMs);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [everyMs]);
  return { ref, n };
}
