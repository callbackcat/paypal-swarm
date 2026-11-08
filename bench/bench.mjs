// Runs a matrix of Swarm runs through the api and appends one summary line per run to results.jsonl.
// Usage: node bench.mjs '<json array of configs>' [label]
import fs from "node:fs";
const API = process.env.API ?? "http://localhost:8787";
const OUT = new URL("./results.jsonl", import.meta.url);
const configs = JSON.parse(process.argv[2]);
const label = process.argv[3] ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (path, init, tries = 6) => {
  for (let i = 1; ; i++) {
    try { const r = await fetch(API + path, init); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } }
    catch (e) { if (i >= tries || init?.method === "POST") throw e; console.log("[bench] fetch retry", path, String(e.cause?.code ?? e.message)); await sleep(3000 * i); }
  }
};
for (const cfg of configs) {
  const t0 = Date.now();
  let id = cfg.existingId;
  if (!id) {
    const created = await j("/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
    if (created.status !== 201) { console.log("CREATE FAILED", created.status, JSON.stringify(created.body).slice(0, 300)); continue; }
    id = created.body.id ?? created.body.run?.id;
  }
  console.log(`[bench] ${label} ${cfg.scenario}/${cfg.merchantProfile} models=${JSON.stringify(cfg.models ?? {})} -> ${id}`);
  let st;
  for (;;) {
    await sleep(4000);
    st = (await j(`/runs/${id}`)).body;
    if (["finished", "failed", "stopped"].includes(st.status)) break;
    if (Date.now() - t0 > 20 * 60_000) { console.log("[bench] timeout, stopping"); await j(`/runs/${id}/stop`, { method: "POST" }); }
  }
  const rep = (await j(`/runs/${id}/report`)).body;
  const ev = (await j(`/runs/${id}/events.json?limit=5000`)).body.events ?? [];
  const count = (t) => ev.filter((e) => e.type === t).length;
  const errs = {}; for (const e of ev) if (e.type === "paypal.error") { const k = `${e.payload.tool}:${e.payload.status}`; errs[k] = (errs[k] ?? 0) + 1; }
  const turnErrs = ev.filter((e) => e.type === "agent.turn" && e.payload.error).map((e) => `${e.actor}: ${String(e.payload.error).slice(0, 120)}`);
  const row = {
    label, id, scenario: cfg.scenario, profile: cfg.merchantProfile, models: cfg.models ?? {}, shoppers: cfg.shoppers,
    status: st.status, modes: st.modes, wallSec: Math.round((Date.now() - t0) / 1000),
    score: rep.score?.overall, grade: rep.score?.grade, dimensions: rep.score?.dimensions,
    findings: (rep.findings ?? []).map((f) => `${f.rule}(${f.severity})`),
    orders: count("order.created"), approved: count("order.approved"), captured: count("order.captured"), declined: count("order.capture_declined"), shipped: count("order.shipped"), refunded: count("order.refunded"), disputes: count("dispute.opened") + count("order.disputed"), approvals: count("approval.requested"),
    tokensIn: st.tokensIn, tokensOut: st.tokensOut, tokensCached: ev.filter((e) => e.type === "agent.turn").reduce((n, e) => n + (e.payload.usage?.cachedTokens ?? 0), 0), costUsd: st.costUsd, cacheHits: rep.cost?.cacheHits, simMinutes: Math.max(0, ...ev.map((e) => e.simT ?? 0)), settled: count("run.settling"),
    budgetExhausted: count("budget.exhausted"), rateLimits: count("infra.rate_limit"), paypalErrors: errs, turnErrors: turnErrs.slice(0, 5),
    agentTurns: count("agent.turn"), toolCalls: count("tool.call"), finishedReason: ev.find((e) => e.type === "run.finished")?.payload?.reason,
  };
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`[bench] done ${id} status=${row.status} score=${row.score} captured=${row.captured}/${row.orders} shipped=${row.shipped} tokens=${row.tokensIn + row.tokensOut} $${row.costUsd} errors=${JSON.stringify(errs)} findings=${row.findings.join(",")}`);
}
