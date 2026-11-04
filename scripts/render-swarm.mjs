/**
 * Renders assets/swarm-piece.js (an ascii-magic-art piece) into:
 *   assets/swarm.svg  animated SVG for the README (CSS keyframes, no scripts; GitHub plays it)
 *   assets/swarm.txt  one still frame as plain text
 *
 *   node scripts/render-swarm.mjs            # write both files
 *   node scripts/render-swarm.mjs --play     # play it in the terminal (any key stops)
 *   node scripts/render-swarm.mjs --frame    # print one still frame
 *
 * Options: --fps=10 --seconds=4 --look=dots --size=13
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { restyle } from "ascii-magic-art/runtime/glyphs.js";
import create, { meta } from "../assets/swarm-piece.js";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const FPS = Number(arg("fps", 10));
const SECONDS = Number(arg("seconds", 4));
const LOOK = arg("look", "dots");
const SIZE = Number(arg("size", 13));
const N = Math.round(FPS * SECONDS);

const draw = create();
const frameAt = (t) => {
  const f = restyle(draw(t), meta.palette, { look: LOOK });
  const text = typeof f === "string" ? f : f.text;
  const color = typeof f === "string" ? text.replace(/[^\n]/g, " ") : f.color;
  const pal = (typeof f === "string" ? null : f.palette) ?? meta.palette;
  return { T: text.split("\n"), C: color.split("\n"), pal };
};

const INK = "#e6edf3";
const BG = "#0d1117";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toSvg() {
  const frames = [];
  for (let i = 0; i < N; i++) frames.push(frameAt(i / FPS));
  const { cols, rows } = meta;
  const pal = frames[0].pal;
  const cellW = +(SIZE * 0.602).toFixed(3);
  const cellH = +(SIZE * 1.27).toFixed(3);
  const pad = 14;
  const W = +(cols * cellW + pad * 2).toFixed(1);
  const H = +(rows * cellH + pad * 2).toFixed(1);

  // cells that never change go in one static layer; the rest is drawn per frame
  const key = (f, x, y) => f.T[y][x] + (f.T[y][x] === " " ? " " : f.C[y][x]);
  const isStatic = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const k0 = key(frames[0], x, y);
    return frames.every((f) => key(f, x, y) === k0);
  }));

  const runsOf = (f, keep) => {
    const byColor = new Map();
    for (let y = 0; y < rows; y++) {
      let x = 0;
      while (x < cols) {
        if (!keep(x, y) || f.T[y][x] === " ") { x++; continue; }
        const co = f.C[y][x];
        let s = "";
        const x0 = x;
        while (x < cols && keep(x, y) && f.C[y][x] === co && f.T[y][x] !== " ") s += f.T[y][x++];
        // keep single interior spaces inside a run to cut element count
        const list = byColor.get(co) ?? [];
        list.push({ x: x0, y, s });
        byColor.set(co, list);
      }
    }
    return byColor;
  };
  const colorOf = (k) => (k === " " ? INK : pal[k] ?? INK);
  const textEl = ({ x, y, s }) => {
    const px = +(pad + x * cellW).toFixed(1);
    const py = +(pad + y * cellH + cellH * 0.78).toFixed(1);
    const len = +(s.length * cellW).toFixed(1);
    return `<text x="${px}" y="${py}" textLength="${len}">${esc(s)}</text>`;
  };
  const layer = (byColor) => [...byColor.entries()].map(([k, runs]) => `<g fill="${colorOf(k)}">${runs.map(textEl).join("")}</g>`).join("");

  const staticLayer = layer(runsOf(frames[0], (x, y) => isStatic[y][x]));
  const dyn = frames.map((f) => layer(runsOf(f, (x, y) => !isStatic[y][x])));
  const dt = 1 / FPS;
  const T = N * dt;
  const p = +((100 / N) - 0.001).toFixed(3);
  const css = [
    `text{font-family:Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;font-size:${SIZE}px;white-space:pre;lengthAdjust:spacingAndGlyphs}`,
    `.f{opacity:0;animation:k ${T}s steps(1,end) infinite}`,
    `@keyframes k{0%{opacity:1}${p}%{opacity:0}100%{opacity:0}}`,
    `@media (prefers-reduced-motion:reduce){.f{animation:none}.f0{opacity:1}}`,
  ].join("");
  const groups = dyn.map((g, i) => `<g class="f f${i}" style="animation-delay:-${((N - i) * dt).toFixed(3)}s">${g}</g>`).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(meta.name)}: ${esc(meta.note)}">
<title>${esc(meta.name)}</title>
<style>${css}</style>
<rect width="100%" height="100%" rx="10" fill="${BG}"/>
<g xml:space="preserve">${staticLayer}
${groups}
</g>
</svg>
`;
  return svg;
}

function still(t = 1.3) {
  return frameAt(t).T.join("\n");
}

async function play() {
  const { stdout, stdin } = process;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const colorize = ({ T, C, pal }) => T.map((row, y) => {
    let out = "", cur = null;
    for (let x = 0; x < row.length; x++) {
      const k = C[y][x];
      const col = row[x] === " " ? null : k === " " ? INK : pal[k] ?? INK;
      if (col !== cur) {
        cur = col;
        out += col ? `\x1b[38;2;${hex(col).join(";")}m` : "\x1b[0m";
      }
      out += row[x];
    }
    return out + "\x1b[0m";
  }).join("\n");
  stdout.write("\x1b[?25l\x1b[2J");
  const t0 = Date.now();
  const timer = setInterval(() => {
    stdout.write("\x1b[H" + colorize(frameAt((Date.now() - t0) / 1000)));
  }, 1000 / meta.fps);
  const stop = () => { clearInterval(timer); stdout.write("\x1b[0m\x1b[?25h\n"); process.exit(0); };
  if (stdin.isTTY) { stdin.setRawMode(true); stdin.resume(); stdin.once("data", stop); }
  const secs = Number(arg("seconds", 0));
  if (secs) setTimeout(stop, secs * 1000);
}

if (flag("play")) play();
else if (flag("frame")) console.log(still(Number(arg("t", 1.3))));
else {
  mkdirSync("assets", { recursive: true });
  const svg = toSvg();
  writeFileSync("assets/swarm.svg", svg);
  writeFileSync("assets/swarm.txt", still() + "\n");
  console.log(`assets/swarm.svg ${(svg.length / 1024).toFixed(0)} KB · ${N} frames @ ${FPS} fps · assets/swarm.txt`);
}
