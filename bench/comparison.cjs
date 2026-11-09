// node comparison.cjs  -> the README "Model comparison" table: one row per model, both scenarios, both profiles.
const fs = require("fs");
const { cost } = require("./cost.cjs");
const rows = fs.readFileSync(__dirname + "/results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
// USD per million tokens, input / output, mirrored from packages/agents/src/llm.ts (OpenRouter list prices).
const PRICE = {
  "anthropic/claude-haiku-5.5": [0.1, 0.5], "anthropic/claude-sonnet-5.5": [2, 10], "anthropic/claude-opus-5.5": [4, 20], "openai/gpt-5.5": [5, 30],
  "google/gemini-2.5-flash-lite": [0.1, 0.4], "openai/gpt-6-luna": [0.1, 0.5], "openai/gpt-oss-120b": [0.019, 0.071], "deepseek/deepseek-v4.1-flash": [0.051, 0.567],
};
const ORDER = ["openai/gpt-oss-120b", "openai/gpt-6-luna", "google/gemini-2.5-flash-lite", "deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-5.5", "anthropic/claude-opus-5.5"];
const HAIKU = "anthropic/claude-haiku-5.5";
const pick = (model, scenario, profile) => {
  const want = rows.filter((r) => r.scenario === scenario && r.profile === profile && r.status === "finished");
  if (model === HAIKU) {
    // The Haiku cells are the env-default runs: baseline from the v2 label, hardened from v3 (after the merchant history repair).
    return want.filter((r) => r.label === (profile === "hardened" ? "haiku-v3" : "haiku-v2")).pop();
  }
  return want.filter((r) => /^compare-/.test(r.label) && r.models && r.models.shopper === model).pop();
};
const usd = (n) => "$" + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2));
console.log("| Model (all three agents) | List price in / out per M | Quiet Tuesday baseline → hardened | Lost parcels baseline → hardened | Shoppers who paid, of 5 / of 10 | Cost per run | Wall per run | PayPal tool errors |");
console.log("|---|---|---|---|---|---|---|---|");
let total = 0;
for (const m of ORDER) {
  const cells = [["quiet-tuesday", "baseline"], ["quiet-tuesday", "hardened"], ["lost-parcels", "baseline"], ["lost-parcels", "hardened"]].map(([s, p]) => pick(m, s, p));
  const have = cells.filter(Boolean);
  if (!have.length) continue;
  const sc = (r) => (r ? String(r.score) : "n/a");
  const costs = have.map((r) => cost(r));
  const walls = have.map((r) => Math.round(r.wallSec || 0));
  if (m !== HAIKU) total += costs.reduce((a, b) => a + b, 0);
  const errs = {};
  for (const r of have) for (const [k, v] of Object.entries(r.paypalErrors || {})) errs[k] = (errs[k] || 0) + v;
  const paid = (a, b) => { const v = [a, b].filter(Boolean).map((r) => r.captured); return v.length ? (Math.min(...v) === Math.max(...v) ? String(v[0]) : Math.min(...v) + "–" + Math.max(...v)) : "n/a"; };
  const errText = Object.entries(errs).map(([k, v]) => "`" + k + "` ×" + v).join(", ") || "none";
  const range = (a, f) => (Math.min(...a) === Math.max(...a) ? f(a[0]) : f(Math.min(...a)) + "–" + f(Math.max(...a)));
  console.log("| `" + m.replace(/^.*\//, "") + "` | $" + PRICE[m][0] + " / $" + PRICE[m][1] + " | " + sc(cells[0]) + " → " + sc(cells[1]) + " | " + sc(cells[2]) + " → " + sc(cells[3]) + " | " + paid(cells[0], cells[1]) + " / " + paid(cells[2], cells[3]) + " | " + range(costs, usd) + " | " + range(walls, (n) => String(n)) + " s" + " | " + errText + " |");
}
console.log("\ncomparison runs total: " + usd(total));
