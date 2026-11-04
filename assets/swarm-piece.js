/*
 * swarm-piece: how a Swarm run looks. A halftone crowd of LLM shoppers on the left, the merchant and chaos
 * agents in the middle, PayPal (sandbox or mock) to their right, and the event log fanning out into the
 * Arena, the Report and the Studio. Traffic flows along every link.
 *
 * Built with the ascii-magic-art toolkit (MIT, https://www.ascii-magic.com/ascii/docs) in the style of its
 * "architecture-map" piece. Render it with `pnpm art` (writes assets/swarm.svg + assets/swarm.txt) or play it
 * in a terminal with `node scripts/render-swarm.mjs --play`.
 */
import { Grid, palette, fbm, ramp } from "ascii-magic-art/lib/kit.js";

export const meta = {
  slug: "swarm",
  name: "Swarm",
  category: "explainers",
  note: "LLM shoppers, a merchant agent and a chaos agent hammer a PayPal store; every event streams into the Arena, the Report and the Studio.",
  tags: ["swarm", "agents", "paypal", "architecture", "diagram"],
  cols: 104,
  rows: 27,
  fps: 24,
  // 0 ink · 1 muted · 2 line · 3 shopper blue · 4 merchant green · 5 chaos orange · 6 paypal purple
  // 7 webhook teal · 8 finding pink · 9 approval yellow · a dim · b white
  palette: palette(["#e6edf3", "#8b949e", "#444c56", "#79c0ff", "#7ee787", "#ffa657", "#d2a8ff", "#56d4dd", "#f778ba", "#f2cc60", "#484f58", "#ffffff"]),
};

const DOTS = " ·•●";
const dirOf = (a, b) => (b[0] > a[0] ? "R" : b[0] < a[0] ? "L" : b[1] > a[1] ? "D" : "U");
const CORNER = { RD: "╮", RU: "╯", LD: "╭", LU: "╰", DR: "╰", DL: "╯", UR: "╭", UL: "╮" };
const BENDS = new Set(["╮", "╯", "╭", "╰"]);
function cellsOf(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let [x, y] = out[out.length - 1];
    const [tx, ty] = pts[i];
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      out.push([x, y]);
    }
  }
  return out;
}

export default function create() {
  const { cols, rows } = meta;
  const g = new Grid(cols, rows);

  // ── nodes: name → [x, y, w, label, sub, colour, style]
  const N = {
    merchant: [36, 7, 20, "Merchant agent", "toolkit · Sonnet", "4", "round"],
    chaos: [36, 19, 20, "Chaos agent", "declines · chargebacks", "5", "round"],
    paypal: [63, 11, 18, "PayPal", "sandbox / mock", "6", "double"],
    arena: [88, 3, 15, "Arena", "live SSE feed", "7", "round"],
    report: [88, 11, 15, "Report", "score + fixes", "8", "round"],
    studio: [88, 19, 15, "Studio", "analyst agent", "9", "round"],
  };
  const left = (k) => N[k][0] - 1;
  const right = (k) => N[k][0] + N[k][2];

  // the crowd: a halftone cloud of shoppers on the left
  const CROWD = { x: 2, y: 5, w: 26, h: 15 };
  const crowdRight = CROWD.x + CROWD.w;

  // ── edges: [colour, cells, rate]
  const BUS = 84; // the event-log bus, a vertical line the three screens hang off
  const EDGES = [
    ["3", cellsOf([[crowdRight, 8], [left("merchant"), 8]]), 2.2], // shoppers → merchant (browse, ask)
    ["3", cellsOf([[crowdRight, 14], [60, 14], [60, 12], [left("paypal"), 12]]), 2.6], // shoppers → paypal (create / approve)
    ["4", cellsOf([[right("merchant"), 8], [60, 8], [60, 12]]), 1.4], // merchant → paypal (capture · refund · tracking)
    ["7", cellsOf([[left("paypal"), 13], [58, 13], [58, 9], [right("merchant"), 9]]), 1.0], // paypal → merchant (webhooks)
    ["5", cellsOf([[right("chaos"), 20], [60, 20], [60, 13]]), 0.8], // chaos → paypal (chargebacks)
    ["5", cellsOf([[46, 18], [46, 12]]), 0.6], // chaos → merchant (duplicate approvals, injected prompts)
    ["6", cellsOf([[right("paypal"), 12], [BUS, 12]]), 1.8], // paypal → event log
    ["7", cellsOf([[BUS, 12], [BUS, 4], [left("arena"), 4]]), 1.8], // log → arena
    ["8", cellsOf([[BUS, 12], [left("report"), 12]]), 0.7], // log → report
    ["9", cellsOf([[BUS, 12], [BUS, 20], [left("studio"), 20]]), 0.9], // log → studio
  ];

  const drawLinks = () => {
    for (const [, cells] of EDGES) {
      for (let k = 0; k < cells.length; k++) {
        const [x, y] = cells[k];
        if (k === cells.length - 1) {
          const d = dirOf(cells[k - 1], cells[k]);
          g.set(x, y, d === "U" || d === "D" ? "│" : "─", "2");
          continue;
        }
        const din = k ? dirOf(cells[k - 1], cells[k]) : dirOf(cells[k], cells[k + 1]);
        const dout = dirOf(cells[k], cells[k + 1]);
        const prev = g.get(x, y);
        let ch = din === dout ? (din === "R" || din === "L" ? "─" : "│") : CORNER[din + dout];
        if (prev === "│" && ch === "─") ch = "┼";
        if (prev === "─" && ch === "│") ch = "┼";
        if ((prev === "─" || prev === "│" || prev === "┼") && BENDS.has(ch)) ch = "┼";
        g.set(x, y, ch, "2");
      }
    }
  };

  return (t) => {
    g.clear();

    // ── top bar
    g.text(1, 0, "swarm", "b");
    g.text(7, 0, "·", "a");
    g.text(9, 0, "black-friday", "1");
    g.text(22, 0, "·", "a");
    g.text(24, 0, "40 shoppers", "1");
    g.text(36, 0, "·", "a");
    g.text(38, 0, "PayPal sandbox", "6");
    g.text(53, 0, "·", "a");
    g.text(55, 0, "LLM live", "4");
    const tokens = 180 + Math.round(fbm(t * 0.25, 2, 2, 3) * 60);
    g.text(cols - 38, 0, "tokens", "1");
    g.text(cols - 31, 0, `${tokens}k/600k`, "0");
    g.text(cols - 21, 0, "$0." + String(20 + Math.round(tokens / 12)).padStart(2, "0"), "0");
    g.text(cols - 14, 0, "score", "1");
    g.text(cols - 8, 0, "61", "8");
    g.text(cols - 5, 0, "→", "a");
    g.text(cols - 3, 0, "94", "4");
    g.hline(0, cols - 1, 1, "─", "2");

    // ── the crowd (halftone dots)
    g.text(CROWD.x, CROWD.y - 2, "Shoppers", "0");
    g.text(CROWD.x + 9, CROWD.y - 2, "LLM personas · Haiku", "1");
    for (let y = 0; y < CROWD.h; y++) {
      for (let x = 0; x < CROWD.w; x++) {
        const u = (x + 0.5) / CROWD.w, v = (y + 0.5) / CROWD.h;
        const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - r * r * 0.95);
        const n = fbm(x * 0.22 + t * 0.35, y * 0.42 - t * 0.12, 3, 11);
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + x * 0.35 + y * 0.6);
        const d = falloff * (0.35 + 0.65 * n) * (0.75 + 0.25 * pulse);
        if (d < 0.14) continue;
        const ch = ramp(Math.min(0.999, d * 1.15), DOTS);
        if (ch === " ") continue;
        g.set(CROWD.x + x, CROWD.y + y, ch, d > 0.5 ? "3" : "a");
      }
    }
    // a few named personas surface from the crowd
    const personas = [["Maya", "$80 · impatient", 3], ["Jonas", "$250 · bargain", 7], ["Priya", "$40 · gift", 11]];
    personas.forEach(([name, trait, dy], i) => {
      if (Math.sin(t * 0.9 + i * 2.1) < -0.2) return;
      const x = CROWD.x + 2 + i * 2;
      g.text(x, CROWD.y + dy, "●", "b");
      g.text(x + 2, CROWD.y + dy, name, "0");
      g.text(x + 3 + name.length, CROWD.y + dy, trait, "1");
    });

    // ── links and packets
    drawLinks();
    EDGES.forEach(([co, cells, rate], e) => {
      const L = cells.length, speed = 13;
      const gap = Math.max(3, Math.round(7 / rate));
      const off = Math.floor(t * speed + e * 4.1);
      for (let k = off % gap; k < L; k += gap) {
        const burst = fbm(t * 0.6 + k * 0.04, e * 5, 2, 7);
        if (burst < 0.28) continue;
        g.set(cells[k][0], cells[k][1], "●", co);
        if (k > 0) g.set(cells[k - 1][0], cells[k - 1][1], "•", co);
      }
    });

    // edge labels
    g.text(29, 7, "browse", "1");
    g.text(29, 15, "create_order", "1");
    g.text(61, 7, "pay_order", "4");
    g.text(49, 13, "webhooks", "7");
    g.text(57, 21, "chargeback", "5");
    g.text(47, 15, "replay", "5");
    g.text(82, 2, "event log", "6");

    // ── nodes
    for (const [k, [x, y, w, label, sub, co, style]] of Object.entries(N)) {
      g.box(x, y, w, 3, style, co);
      g.text(x + 2, y + 1, label, "0");
      const blink = Math.sin(t * 3.4 + x * 0.7) > 0;
      g.set(x + w - 3, y + 1, blink ? "●" : "○", co);
      g.text(x + 1, y + 3, sub, "1");
    }
    // merchant state line and chaos schedule
    const locks = ["capture lock on", "reads status", "auto-tracking"];
    g.text(N.merchant[0] + 1, N.merchant[1] + 4, locks[Math.floor(t * 0.5) % locks.length], "4");
    const injects = ["decline 10 %", "dup approval", "oversized refund", "lost parcel", "injection sku"];
    g.text(N.chaos[0] + 1, N.chaos[1] + 4, "next: " + injects[Math.floor(t * 0.6) % injects.length], "5");

    // paypal mini-ledger
    const orders = 112 + (Math.floor(t * 1.7) % 9);
    g.text(N.paypal[0] + 1, N.paypal[1] + 4, `orders ${orders}`, "1");
    g.text(N.paypal[0] + 12, N.paypal[1] + 4, "422 ×3", "8");

    // approvals waiting (human in the loop) and the findings ticker
    const pending = Math.sin(t * 0.7) > 0.3;
    g.text(86, 8, pending ? "⚠ approval pending" : "✓ approvals clear ", pending ? "9" : "4");
    const findings = ["NO_TRACKING ×3", "DUP_CAPTURE ×1", "REFUND_422 ×2", "INJECTION ×1"];
    g.text(86, 16, findings[Math.floor(t * 0.4) % findings.length], "8");

    // ── legend
    g.hline(0, cols - 1, rows - 3, "─", "2");
    const legend = [["3", "shopper"], ["4", "merchant"], ["5", "chaos"], ["6", "paypal"], ["7", "webhook"], ["8", "finding"], ["9", "approval"]];
    let lx = 1;
    for (const [co, name] of legend) {
      g.text(lx, rows - 2, "●", co);
      g.text(lx + 2, rows - 2, name, "1");
      lx += name.length + 4;
    }
    g.text(cols - 25, rows - 2, "1 real min = 1 sim hour", "1");
    return g.frame();
  };
}
