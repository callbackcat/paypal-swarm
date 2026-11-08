"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Grid, fbm, ramp } from "ascii-magic-art/lib/kit.js";

/**
 * The hero: a swarm of LLM shoppers rushing a checkout, drawn with the same ascii-magic-art kit as the README diagram.
 *
 * Shoppers are a halftone crowd on the left that streams packets at the store in the middle. The store answers with
 * captures, declines and webhooks; the chaos agent pokes it from below; what breaks falls out on the right as findings
 * and a score. Colours are Sodium tokens, so the piece follows the theme. It renders into a <pre> as coloured spans,
 * pauses when off screen, and shows one still frame under prefers-reduced-motion.
 */
const COLS = 96;
const ROWS = 18;
const FPS = 12;

/** Colour keys → Sodium tokens. 0 ink · 1 muted · 2 faint rule · 3 shopper · 4 store ok · 5 chaos · 6 paypal · 8 finding · 9 accent */
const TONE: Record<string, string> = {
  "0": "var(--text-1)",
  "1": "var(--text-2)",
  "2": "var(--line)",
  "3": "var(--data-5)",
  "4": "var(--ok)",
  "5": "var(--warn)",
  "6": "var(--data-2)",
  "8": "var(--fail)",
  "9": "var(--accent)",
  a: "var(--text-3)",
};

const DOTS = " ·•●";
const CROWD = { x: 1, y: 3, w: 24, h: 12 };
const STORE = { x: 46, y: 5, w: 22, h: 7 };
const OUT = { x: 72, y: 3 };

function cellsOf(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    let [x, y] = out[out.length - 1]!;
    const [tx, ty] = pts[i]!;
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      out.push([x, y]);
    }
  }
  return out;
}

const PERSONAS: Array<[string, string]> = [
  ["Maya", "impatient"],
  ["Jonas", "bargain hunter"],
  ["Priya", "gift buyer"],
  ["Theo", "refund-happy"],
];
const FINDINGS = ["CAPTURE_WITHOUT_TRACKING", "DUPLICATE_CAPTURE_ATTEMPT", "CAPTURE_DECLINED_UNHANDLED", "REFUND_EXCEEDS_CAPTURE", "DISPUTE_UNANSWERED", "BUYER_LEFT_WAITING"];
const INJECTS = ["card declined", "duplicate approval", "oversized refund", "chargeback", "lost parcel", "prompt injection"];

export function makePiece(scenarioLabel: string) {
  const g = new Grid(COLS, ROWS);
  const storeRight = STORE.x + STORE.w;
  const storeMid = STORE.y + Math.floor(STORE.h / 2);
  // shoppers → store, three lanes; store → paypal; paypal → merchant (webhooks); store → findings
  const LANES: Array<{ co: string; cells: Array<[number, number]>; rate: number }> = [
    { co: "3", cells: cellsOf([[CROWD.x + CROWD.w, 5], [STORE.x - 1, 5]]), rate: 2.4 },
    { co: "3", cells: cellsOf([[CROWD.x + CROWD.w, 8], [STORE.x - 1, 8]]), rate: 2.8 },
    { co: "3", cells: cellsOf([[CROWD.x + CROWD.w, 11], [STORE.x - 1, 11]]), rate: 2.0 },
    { co: "5", cells: cellsOf([[STORE.x + 10, ROWS - 2], [STORE.x + 10, STORE.y + STORE.h]]), rate: 0.9 },
    { co: "8", cells: cellsOf([[storeRight, storeMid], [OUT.x - 1, storeMid]]), rate: 1.2 },
  ];
  const drawLanes = () => {
    for (const { cells } of LANES) {
      for (let k = 0; k < cells.length; k++) {
        const [x, y] = cells[k]!;
        const prev = cells[k - 1];
        const vertical = prev ? prev[0] === x : cells[k + 1]?.[0] === x;
        g.set(x, y, vertical ? "│" : "─", "2");
      }
    }
  };

  return (t: number) => {
    g.clear();

    // the crowd: a halftone of shoppers, denser toward the store as the swarm leans in
    g.text(CROWD.x, CROWD.y - 2, "shoppers", "0");
    g.text(CROWD.x + 9, CROWD.y - 2, "LLM personas", "1");
    for (let y = 0; y < CROWD.h; y++) {
      for (let x = 0; x < CROWD.w; x++) {
        const u = (x + 0.5) / CROWD.w;
        const v = (y + 0.5) / CROWD.h;
        const dx = (u - 0.55) * 2;
        const dy = (v - 0.5) * 2;
        const r = Math.sqrt(dx * dx * 0.8 + dy * dy);
        const falloff = Math.max(0, 1 - r * r * 0.9);
        const n = fbm(x * 0.22 + t * 0.45, y * 0.42 - t * 0.1, 3, 11);
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.8 + x * 0.35 + y * 0.6);
        const d = falloff * (0.35 + 0.65 * n) * (0.7 + 0.3 * pulse);
        if (d < 0.14) continue;
        const ch = ramp(Math.min(0.999, d * 1.15), DOTS);
        if (ch === " ") continue;
        g.set(CROWD.x + x, CROWD.y + y, ch, d > 0.5 ? "3" : "a");
      }
    }
    PERSONAS.forEach(([name, trait], i) => {
      if (Math.sin(t * 0.8 + i * 1.7) < -0.1) return;
      const y = CROWD.y + 1 + i * 3;
      const x = CROWD.x + 1 + (i % 2) * 2;
      g.text(x, y, "●", "0");
      g.text(x + 2, y, name, "0");
      g.text(x + 3 + name.length, y, trait, "1");
    });

    // lanes and packets
    drawLanes();
    LANES.forEach(({ co, cells, rate }, e) => {
      const L = cells.length;
      const gap = Math.max(3, Math.round(7 / rate));
      // t can be a hair negative on the first frame (the rAF timestamp predates the effect's start), so keep k in range.
      const off = Math.floor(t * 14 + e * 4.1);
      for (let k = ((off % gap) + gap) % gap; k < L; k += gap) {
        const burst = fbm(t * 0.6 + k * 0.04, e * 5, 2, 7);
        if (burst < 0.26) continue;
        const [x, y] = cells[k]!;
        g.set(x, y, "●", co);
        const p = cells[k - 1];
        if (p) g.set(p[0], p[1], "•", co);
      }
    });
    g.text(CROWD.x + CROWD.w + 2, 4, "browse · order", "1");
    g.text(CROWD.x + CROWD.w + 2, 7, "approve_and_pay", "1");
    g.text(CROWD.x + CROWD.w + 2, 10, "where's my parcel", "1");

    // the store under attack: the merchant agent and PayPal inside one box
    const hit = Math.sin(t * 5.1) > 0.6;
    g.box(STORE.x, STORE.y, STORE.w, STORE.h, "heavy", hit ? "8" : "6");
    g.text(STORE.x + 2, STORE.y + 1, "your store", "0");
    g.text(STORE.x + 13, STORE.y + 1, "PayPal", "6");
    g.text(STORE.x + 2, STORE.y + 2, "merchant agent", "1");
    const states = ["pay_order", "capture COMPLETED", "capture DECLINED", "create_refund 422", "tracking missing", "dispute waiting"];
    const si = Math.floor(t * 0.9) % states.length;
    g.text(STORE.x + 2, STORE.y + 4, states[si]!, si === 2 || si === 3 || si === 4 || si === 5 ? "8" : "4");
    const orders = 12 + (Math.floor(t * 2.3) % 29);
    g.text(STORE.x + 2, STORE.y + 5, `orders ${String(orders).padStart(2, " ")}`, "1");
    g.text(STORE.x + 13, STORE.y + 5, `✗ ${Math.floor(orders / 9)}`, "8");

    // chaos below
    g.text(STORE.x + 2, ROWS - 1, "chaos agent", "5");
    g.text(STORE.x + 14, ROWS - 1, INJECTS[Math.floor(t * 0.55) % INJECTS.length]!, "5");

    // what falls out: findings, then the score before and after the fix
    g.text(OUT.x, OUT.y - 2, "what broke", "0");
    g.text(OUT.x + 11, OUT.y - 2, scenarioLabel, "1");
    const shown = 4;
    for (let i = 0; i < shown; i++) {
      const f = FINDINGS[(Math.floor(t * 0.35) + i) % FINDINGS.length]!;
      const fresh = i === 0 && Math.sin(t * 2.2) > 0;
      g.text(OUT.x, OUT.y + i * 2, fresh ? "▶" : "·", fresh ? "8" : "a");
      g.text(OUT.x + 2, OUT.y + i * 2, f.length > 23 ? f.slice(0, 22) + "…" : f, i === 0 ? "8" : "1");
    }
    const base = 58 + Math.round(fbm(t * 0.2, 1, 2, 3) * 10);
    g.text(OUT.x, OUT.y + 9, "score", "1");
    g.text(OUT.x + 6, OUT.y + 9, String(base), "8");
    g.text(OUT.x + 9, OUT.y + 9, "→", "a");
    g.text(OUT.x + 11, OUT.y + 9, "94", "4");
    g.text(OUT.x + 14, OUT.y + 9, "hardened", "4");
    // a tiny bar under the scores
    const w = 22;
    for (let i = 0; i < w; i++) {
      const frac = i / w;
      g.set(OUT.x + i, OUT.y + 10, "▬", frac < base / 100 ? "8" : frac < 0.94 ? "4" : "2");
    }
    g.text(CROWD.x, ROWS - 1, "1 real min = 1 sim hour", "a");
    return g.frame();
  };
}

type Frame = { text: string; color: string };
function asFrame(f: string | Frame): Frame {
  return typeof f === "string" ? { text: f, color: f.replace(/[^\n]/g, " ") } : f;
}

/** One line of a frame as runs of same-coloured text. */
function runs(text: string, color: string): Array<{ s: string; co: string }> {
  const out: Array<{ s: string; co: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const co = text[i] === " " ? " " : color[i] ?? " ";
    const last = out[out.length - 1];
    if (last && last.co === co) last.s += text[i];
    else out.push({ s: text[i]!, co });
  }
  return out;
}

export function SwarmHero({ scenarioLabel = "black-friday" }: { scenarioLabel?: string }) {
  const piece = useMemo(() => makePiece(scenarioLabel), [scenarioLabel]);
  const [frame, setFrame] = useState<Frame>(() => asFrame(piece(0.4)));
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) {
      setFrame(asFrame(piece(0.4)));
      return;
    }
    let raf = 0;
    let last = 0;
    let visible = true;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || now - last < 1000 / FPS) return;
      last = now;
      setFrame(asFrame(piece(Math.max(0, now - start) / 1000)));
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
    });
    io.observe(el);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [piece]);

  const T = frame.text.split("\n");
  const C = frame.color.split("\n");
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <pre ref={ref} aria-hidden className="m-0 overflow-x-auto mono text-(length:--cell) leading-(--cell-lh) text-text-1 select-none" style={{ "--cell": "clamp(6px, 1.1vw, 12px)", "--cell-lh": "clamp(8px, 1.45vw, 16px)" } as CSSProperties}>
        {T.map((line, y) => (
          <span key={y} className="block whitespace-pre">
            {runs(line, C[y] ?? "").map((r, i) =>
              r.co === " " ? r.s : (
                <span key={i} className="text-(--tone)" style={{ "--tone": TONE[r.co] ?? "var(--text-1)" } as CSSProperties}>
                  {r.s}
                </span>
              ),
            )}
          </span>
        ))}
      </pre>
      <figcaption className="type-caption text-text-3">
        LLM shoppers rush the store, the chaos agent trips it, and every slip lands in the report as a finding with a fix. The score is the before and after.
      </figcaption>
    </figure>
  );
}
