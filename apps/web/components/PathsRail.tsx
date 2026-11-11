"use client";
import { useEffect, useRef, useState } from "react";
import { cn, reducedMotion } from "@/lib/sodium/utils";

// The line through "Two ways to run it": it starts at the first way's number, runs down beside its text, crosses to
// the second way's number and runs down beside that text. Its yellow part follows the scroll, so the eye is led from
// one way to the next; the grey track under it shows the route before it is drawn. Desktop widths only: on one column
// the two ways already read top to bottom, and the numbers alone mark them.

type Geometry = {
  width: number;
  height: number;
  /** The route in two strokes, since a dash pattern starts over on each: to the second number, then on past it. */
  lead: string;
  tail: string;
  /** Each stretch of the route: its drawn length and how many px of scroll it takes. */
  parts: Array<{ length: number; scroll: number }>;
  /** Where the route starts, down from the top of the container. */
  top: number;
  /** The drawn length at which the line reaches the second number. */
  reachSecond: number;
  total: number;
};

/** Scroll px the sideways hop takes; it has no height of its own, so without this it would appear all at once. */
const HOP_SCROLL = 140;
/** The line's tip rides this far down the viewport. */
const TIP_AT = 0.65;
const DESKTOP = "(min-width: 1024px)";

function measure(
  box: HTMLElement,
  first: HTMLElement,
  second: HTMLElement,
  end: HTMLElement,
): Geometry {
  const b = box.getBoundingClientRect();
  const f = first.getBoundingClientRect();
  const s = second.getBoundingClientRect();
  const e = end.getBoundingClientRect();
  const x1 = f.left + f.width / 2 - b.left;
  const x2 = s.left + s.width / 2 - b.left;
  const y1 = f.bottom - b.top;
  const firstRow = first.closest("[data-way]")?.getBoundingClientRect();
  const secondRow = second.closest("[data-way]")?.getBoundingClientRect();
  // The hop runs in the gap between the two rows.
  const yHop =
    firstRow && secondRow
      ? (firstRow.bottom + secondRow.top) / 2 - b.top
      : (y1 + s.top - b.top) / 2;
  const y2 = s.top - b.top;
  const y3 = s.bottom - b.top;
  const y4 = Math.max(e.bottom - b.top, y3);
  const parts = [
    { length: yHop - y1, scroll: yHop - y1 },
    { length: Math.abs(x2 - x1), scroll: HOP_SCROLL },
    { length: y2 - yHop, scroll: y2 - yHop },
    { length: y4 - y3, scroll: y4 - y3 },
  ].map((p) => ({ length: Math.max(p.length, 0), scroll: Math.max(p.scroll, 0) }));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  return {
    width: b.width,
    height: b.height,
    lead: `M${x1} ${y1}V${yHop}H${x2}V${y2}`,
    tail: `M${x2} ${y3}V${y4}`,
    parts,
    top: y1,
    reachSecond: parts[0]!.length + parts[1]!.length + parts[2]!.length,
    total,
  };
}

/** The drawn length once the tip has travelled `scrolled` px of scroll along the route. */
function drawnAt(g: Geometry, scrolled: number): number {
  let left = scrolled;
  let drawn = 0;
  for (const p of g.parts) {
    if (left <= 0) break;
    if (p.scroll <= 0) continue;
    const share = Math.min(left / p.scroll, 1);
    drawn += p.length * share;
    left -= p.scroll;
  }
  return drawn;
}

export function usePathsRail() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLSpanElement | null>(null);
  const secondRef = useRef<HTMLSpanElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const first = firstRef.current;
    const second = secondRef.current;
    const end = endRef.current;
    if (!box || !first || !second || !end) return;
    const desktop = window.matchMedia(DESKTOP);
    let g: Geometry | null = null;
    let frame = 0;

    const follow = () => {
      frame = 0;
      if (!g) return;
      if (reducedMotion(box)) {
        setDrawn(g.total);
        return;
      }
      const tip = window.innerHeight * TIP_AT - box.getBoundingClientRect().top;
      setDrawn(drawnAt(g, tip - g.top));
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(follow);
    };
    const layout = () => {
      g = desktop.matches ? measure(box, first, second, end) : null;
      setGeometry(g);
      if (g) queue();
      else setDrawn(0);
    };

    layout();
    const resize = new ResizeObserver(layout);
    resize.observe(box);
    desktop.addEventListener("change", layout);
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      resize.disconnect();
      desktop.removeEventListener("change", layout);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return {
    boxRef,
    firstRef,
    secondRef,
    endRef,
    geometry,
    drawn,
    /** The line has left the first number, and has arrived at the second. */
    firstLit: !!geometry && drawn > 0,
    secondLit: !!geometry && drawn >= geometry.reachSecond - 0.5,
  };
}

/** The route: a grey track, and over it the yellow part drawn so far. */
export function PathsRailLine({
  geometry,
  drawn,
}: {
  geometry: Geometry | null;
  drawn: number;
}) {
  if (!geometry) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className="pointer-events-none absolute inset-0 hidden lg:block"
    >
      {[
        { d: geometry.lead, on: Math.min(drawn, geometry.reachSecond) },
        { d: geometry.tail, on: drawn - geometry.reachSecond },
      ].map((stroke) => (
        <g key={stroke.d}>
          <path d={stroke.d} strokeWidth={1} className="stroke-(--line)" />
          <path
            d={stroke.d}
            strokeWidth={2}
            strokeDasharray={`${Math.max(stroke.on, 0)} ${geometry.total + 4}`}
            className={cn("stroke-(--accent)", stroke.on <= 0 && "hidden")}
          />
        </g>
      ))}
    </svg>
  );
}

/** The number that marks a way; it takes the primary's colours once the line reaches it. */
export function WayNumber({
  n,
  lit,
  ref,
}: {
  n: number;
  lit: boolean;
  ref: React.Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center border type-label transition-colors duration-(--dur-wipe) ease-out",
        lit
          ? "border-accent-edge bg-primary text-primary-foreground"
          : "border-line-control bg-page text-text-2",
      )}
    >
      {n}
    </span>
  );
}
