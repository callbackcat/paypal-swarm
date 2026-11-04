/**
 * Smoke test: one real run through the api's RunManager (no HTTP), in whatever modes the env allows.
 *
 *   pnpm smoke                                 # Quiet Tuesday, 2 shoppers, hardened, auto modes
 *   pnpm smoke -- --scenario black-friday --shoppers 6 --profile baseline --llm scripted --paypal mock
 *   pnpm smoke -- --fast --fixture fixtures/quiet-tuesday.jsonl   # test pacing + dump events as JSONL
 *
 * Exit code 1 when the run fails its assertions, so the nightly GitHub Action goes red.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RunConfigSchema, renderMarkdown } from "@swarm/core";
import { Bus } from "../apps/api/src/bus";
import { loadEnv, readEnv } from "../apps/api/src/env";
import { RunManager } from "../apps/api/src/runs";
import { DbStore, MemoryStore, type Store } from "../apps/api/src/store";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[i + 1] ?? "true")) : def;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnv();
  const env = readEnv();
  const scenario = arg("scenario", "quiet-tuesday")!;
  const shoppers = Number(arg("shoppers", "2"));
  const profile = (arg("profile", "hardened") as "baseline" | "hardened") ?? "hardened";
  const llm = (arg("llm", "auto") as "auto" | "scripted" | "live") ?? "auto";
  const paypal = (arg("paypal", "auto") as "auto" | "mock" | "sandbox") ?? "auto";
  const fast = flag("fast");
  const fixture = arg("fixture");

  let store: Store = new MemoryStore();
  if (env.databaseUrl) {
    const db = new DbStore();
    if (await db.ping()) store = db;
    else console.warn("DATABASE_URL unreachable; using memory store");
  }
  const manager = new RunManager(store, new Bus(), readEnv, fast ? { pacing: { stepMs: 40, chaosTickMs: 60, analystIntervalMs: 400, drainMs: 2500 }, clockFactor: 3000, mockLatencyMs: 5 } : {});
  const config = RunConfigSchema.parse({ scenario, merchantProfile: profile, shoppers, llm, paypal, name: `smoke ${new Date().toISOString()}` });
  const est = manager.estimate(config);
  console.log(`[smoke] ${scenario} · ${shoppers} shoppers · ${profile} · modes ${JSON.stringify(est.modes)} · estimate ${est.estimate.tokens} tokens ≈ $${est.estimate.usd.toFixed(3)} (cap ${est.tokenCap})`);
  const t0 = Date.now();
  const { run } = await manager.create(config, { start: true });
  console.log(`[smoke] run ${run.id} started (store ${store.kind})`);

  let status = await manager.status(run.id);
  while (["created", "running", "paused"].includes(status.status)) {
    await new Promise((r) => setTimeout(r, fast ? 500 : 5000));
    status = await manager.status(run.id);
    // Auto-approve anything the hardened merchant asks for, like an operator at the keyboard.
    for (const a of status.pendingApprovals) await manager.decide(run.id, a.id, "granted").catch(() => {});
    const b = status.budget;
    console.log(`[smoke] ${status.status} · ${Math.round((Date.now() - t0) / 1000)}s · orders ${status.orders.length} · tokens ${b?.total ?? 0}/${b?.cap ?? 0} · $${(b?.costUsd ?? 0).toFixed(4)}`);
    if (Date.now() - t0 > 20 * 60_000) {
      manager.stop(run.id);
      throw new Error("smoke exceeded 20 minutes");
    }
  }
  const report = await manager.report(run.id);
  const events = await store.list(run.id);
  if (fixture) {
    mkdirSync(dirname(fixture), { recursive: true });
    writeFileSync(fixture, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    console.log(`[smoke] wrote ${events.length} events to ${fixture}`);
  }
  const s = report.stats;
  console.log(`[smoke] finished ${status.status} · score ${report.score.overall} (${report.score.grade}) · captured ${s.captured}/${s.ordersCreated} · shipped ${s.shipped} · webhooks ${s.webhooks} · paypal errors ${s.paypalErrors} · tokens ${s.tokensIn + s.tokensOut} · $${s.costUsd.toFixed(4)}`);
  console.log(`[smoke] findings: ${report.findings.map((f) => `${f.rule}(${f.severity})`).join(", ") || "none"}`);

  const failures: string[] = [];
  if (!["finished", "finished_budget"].includes(status.status)) failures.push(`status ${status.status}`);
  if (s.captured < 1) failures.push("no order was captured");
  if (profile === "hardened" && s.shipped < 1) failures.push("hardened merchant shipped nothing");
  if (!renderMarkdown(report).includes("# Swarm agent-readiness report")) failures.push("markdown report did not render");
  if (s.tokensIn + s.tokensOut > (run.tokenCap ?? Infinity)) failures.push("token cap exceeded");
  if (failures.length) {
    console.error(`[smoke] FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("[smoke] OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("[smoke] error", e);
  process.exit(1);
});
