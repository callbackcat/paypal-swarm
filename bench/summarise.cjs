// node summarise.cjs <label> [md]  -> one line per run, or a markdown table with md
const fs = require("fs");
const label = process.argv[2] || "compare-cheap";
const md = process.argv[3] === "md";
const rows = fs.readFileSync("results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.label === label);
const short = (m) => (m || "?").replace(/^.*\//, "");
const errs = (r) => Object.entries(r.paypalErrors || {}).map(([k, v]) => k + " x" + v).join(", ") || "none";
const codes = (r) => {
  const c = {};
  for (const f of r.findings || []) c[f.rule || f.code || f] = (c[f.rule || f.code || f] || 0) + 1;
  return Object.entries(c).map(([k, v]) => (v > 1 ? k + " x" + v : k)).join(", ") || "none";
};
if (md) {
  console.log("| Model | Scenario | Profile | Score | Captured / shipped | Billable tokens | Cost | Wall | PayPal errors | Findings |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
}
for (const r of rows) {
  const tok = (r.tokensIn || 0) - (r.tokensCached || 0) + (r.tokensOut || 0);
  const cells = [short(r.models && r.models.shopper), r.scenario, r.profile, String(r.score), r.captured + " / " + r.shipped, Math.round(tok / 1000) + "k", "$" + Number(r.costUsd || 0).toFixed(4), Math.round(r.wallSec || 0) + " s", errs(r), codes(r)];
  console.log(md ? "| " + cells.join(" | ") + " |" : cells.join(" | "));
}
console.log((md ? "\n" : "") + rows.length + " rows for " + label);
