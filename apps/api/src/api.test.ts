import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { Bus } from "./bus";
import type { Env } from "./env";
import { RunManager } from "./runs";
import { MemoryStore } from "./store";

const testEnv = (): Env => ({ llmCache: false, port: 0, corsOrigin: "*", demoDailyTokenCap: 1_000_000, models: {} });

function harness() {
  const store = new MemoryStore();
  const bus = new Bus();
  const manager = new RunManager(store, bus, testEnv, { pacing: { stepMs: 15, chaosTickMs: 25, analystIntervalMs: 150, drainMs: 1000 }, clockFactor: 12_000, mockLatencyMs: 2 });
  const app = createApp({ store, bus, manager, env: testEnv });
  const req = (path: string, init?: RequestInit) => app.request(path, init);
  const post = (path: string, body: unknown) => req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const waitFinished = async (id: string, ms = 20_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = (await (await req(`/runs/${id}`)).json()) as { status: string };
      if (!["created", "running", "paused"].includes(r.status)) return r;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("run did not finish");
  };
  return { store, bus, manager, app, req, post, waitFinished };
}

describe("swarm api (memory store, mock PayPal, scripted agents)", () => {
  it("serves health, scenarios, docs and estimates", async () => {
    const h = harness();
    const health = (await (await h.req("/healthz")).json()) as Record<string, unknown>;
    expect(health.ok).toBe(true);
    expect(health.storage).toBe("memory");
    const sc = (await (await h.req("/scenarios")).json()) as { scenarios: Array<{ id: string; status: string }>; allowlists: Record<string, { tools: string[] }> };
    expect(sc.scenarios.filter((s) => s.status === "ready")).toHaveLength(4);
    expect(sc.allowlists.shopper!.tools).not.toContain("create_refund");
    const est = await h.post("/runs/estimate", { scenario: "black-friday" });
    expect(est.status).toBe(200);
    const body = (await est.json()) as { modes: { llm: string }; estimate: { tokens: number } };
    expect(body.modes.llm).toBe("scripted");
    expect(body.estimate.tokens).toBe(0);
    const bad = await h.post("/runs/estimate", { scenario: "nope" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("unknown scenario");
    const doc = (await (await h.req("/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/runs", "/runs/{id}/events", "/webhooks/paypal", "/ai/studio-turn", "/runs/{id}/report"]));
  });

  it("plans a run from one sentence without a key", async () => {
    const h = harness();
    const r = await h.post("/ai/plan-run", { text: "Try breaking checkout with 12 impatient bargain hunters on Black Friday, hardened merchant, compare both" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { source: string; plan: { scenario: string; merchantProfile: string; shoppers: number | null; bothProfiles: boolean; brief: string | null }; config: { scenario: string; shoppers?: number; brief?: string } };
    expect(body.source).toBe("heuristic");
    expect(body.plan.scenario).toBe("black-friday");
    expect(body.plan.merchantProfile).toBe("hardened");
    expect(body.plan.shoppers).toBe(12);
    expect(body.plan.bothProfiles).toBe(true);
    expect(body.config.brief).toContain("bargain hunters");
    const bad = await h.post("/ai/plan-run", { text: "x" });
    expect(bad.status).toBe(400);
  });

  it("creates a run, streams it, and renders the report in JSON and Markdown", async () => {
    const h = harness();
    const created = await h.post("/runs", { scenario: "quiet-tuesday", merchantProfile: "baseline" });
    expect(created.status).toBe(201);
    const run = (await created.json()) as { id: string; status: string; modes: { paypal: string; llm: string } };
    expect(run.modes).toMatchObject({ paypal: "mock", llm: "scripted" });
    const final = await h.waitFinished(run.id);
    expect(final.status).toBe("finished");

    const list = (await (await h.req("/runs")).json()) as { runs: Array<{ id: string }> };
    expect(list.runs.map((r) => r.id)).toContain(run.id);

    const ev = (await (await h.req(`/runs/${run.id}/events.json?since=0`)).json()) as { events: Array<{ type: string; id: number }>; next: number };
    expect(ev.events[0]!.type).toBe("run.started");
    expect(ev.events.at(-1)!.type).toBe("run.finished");
    expect(ev.events.some((e) => e.type === "webhook.received")).toBe(true);
    const page2 = (await (await h.req(`/runs/${run.id}/events.json?since=${ev.events[4]!.id}`)).json()) as { events: Array<{ id: number }> };
    expect(page2.events[0]!.id).toBe(ev.events[5]!.id);

    const sse = await h.req(`/runs/${run.id}/events?since=0`);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const text = await sse.text();
    expect(text).toContain('"type":"run.started"');
    expect(text).toContain("event: done");

    const report = (await (await h.req(`/runs/${run.id}/report`)).json()) as { score: { overall: number }; findings: Array<{ rule: string }>; stats: { captured: number } };
    expect(report.stats.captured).toBeGreaterThanOrEqual(4);
    expect(report.findings.map((f) => f.rule)).toContain("CAPTURE_WITHOUT_TRACKING");
    const md = await h.req(`/runs/${run.id}/report?format=md`);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("# Swarm agent-readiness report");

    const hooks = (await (await h.req(`/runs/${run.id}/webhooks`)).json()) as { webhooks: Array<{ eventType: string; lagMs: number | null; matchedEventId: number | null }> };
    expect(hooks.webhooks.length).toBeGreaterThan(0);
    expect(hooks.webhooks.some((w) => w.matchedEventId !== null)).toBe(true);
    const personas = (await (await h.req(`/runs/${run.id}/personas`)).json()) as { personas: unknown[] };
    expect(personas.personas).toHaveLength(5);
  }, 40_000);

  it("re-runs with the hardened profile and scores higher", async () => {
    const h = harness();
    const base = (await (await h.post("/runs", { scenario: "quiet-tuesday", merchantProfile: "baseline" })).json()) as { id: string };
    await h.waitFinished(base.id);
    const rerun = await h.post(`/runs/${base.id}/rerun`, { merchantProfile: "hardened" });
    expect(rerun.status).toBe(201);
    const hard = (await rerun.json()) as { id: string; rerunOf: string; merchantProfile: string };
    expect(hard.rerunOf).toBe(base.id);
    expect(hard.merchantProfile).toBe("hardened");
    await h.waitFinished(hard.id);
    const b = (await (await h.req(`/runs/${base.id}/report`)).json()) as { score: { overall: number } };
    const hh = (await (await h.req(`/runs/${hard.id}/report`)).json()) as { score: { overall: number } };
    expect(hh.score.overall).toBeGreaterThan(b.score.overall);
  }, 40_000);

  it("pauses, resumes and stops a run", async () => {
    const h = harness();
    const run = (await (await h.post("/runs", { scenario: "black-friday", merchantProfile: "baseline", shoppers: 15 })).json()) as { id: string };
    await new Promise((r) => setTimeout(r, 150));
    expect((await h.post(`/runs/${run.id}/pause`, {})).status).toBe(200);
    const paused = (await (await h.req(`/runs/${run.id}`)).json()) as { paused: boolean; status: string };
    expect(paused.paused).toBe(true);
    expect((await h.post(`/runs/${run.id}/resume`, {})).status).toBe(200);
    expect((await h.post(`/runs/${run.id}/stop`, {})).status).toBe(200);
    const final = await h.waitFinished(run.id);
    expect(final.status).toBe("stopped");
    expect((await h.post(`/runs/${run.id}/stop`, {})).status).toBe(409);
  }, 30_000);

  it("surfaces human approvals and resumes the merchant as each one is granted", async () => {
    const h = harness();
    const run = (await (await h.post("/runs", { scenario: "dispute-storm", merchantProfile: "hardened", shoppers: 6, approvalThresholdUsd: 5, approvalTimeoutSec: 3 })).json()) as { id: string };
    let firstId: string | undefined;
    let granted = 0;
    const t0 = Date.now();
    // Act like an operator: keep granting whatever is pending until the run finishes.
    for (;;) {
      const a = (await (await h.req(`/runs/${run.id}/approvals?pending=1`)).json()) as { approvals: Array<{ id: string; kind: string; payload: Record<string, unknown> }> };
      for (const ap of a.approvals) {
        firstId ??= ap.id;
        const r = await h.post(`/runs/${run.id}/approvals/${ap.id}`, { decision: "granted" });
        if (r.status === 200) granted++;
      }
      const st = (await (await h.req(`/runs/${run.id}`)).json()) as { status: string; pendingApprovals: unknown[] };
      if (!["created", "running", "paused"].includes(st.status)) break;
      if (Date.now() - t0 > 30_000) throw new Error("run did not finish");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(firstId).toBeTruthy();
    expect(granted).toBeGreaterThan(0);
    expect((await h.post(`/runs/${run.id}/approvals/${firstId}`, { decision: "granted" })).status).toBe(409);
    expect((await h.post(`/runs/${run.id}/approvals/nope`, { decision: "denied" })).status).toBe(404);
    const ev = (await (await h.req(`/runs/${run.id}/events.json?type=approval.granted`)).json()) as { events: unknown[] };
    expect(ev.events.length).toBe(granted);
    const all = (await (await h.req(`/runs/${run.id}/approvals`)).json()) as { approvals: Array<{ status: string }> };
    expect(all.approvals.every((x) => x.status !== "pending")).toBe(true);
  }, 45_000);

  it("accepts a PayPal webhook, matches it to the run and records the lag", async () => {
    const h = harness();
    const run = (await (await h.post("/runs", { scenario: "quiet-tuesday", merchantProfile: "hardened" })).json()) as { id: string };
    await h.waitFinished(run.id);
    const ev = (await (await h.req(`/runs/${run.id}/events.json?type=order.captured`)).json()) as { events: Array<{ payload: { captureId: string; orderId: string } }> };
    const cap = ev.events[0]!.payload;
    const res = await h.req("/webhooks/paypal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "WH-TEST-1234567890", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: cap.captureId, status: "COMPLETED", supplementary_data: { related_ids: { order_id: cap.orderId } } } }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; matchedEventId: number | null; verified: boolean };
    expect(body.runId).toBe(run.id);
    expect(body.matchedEventId).not.toBeNull();
    expect(body.verified).toBe(false);
    const garbage = await h.req("/webhooks/paypal", { method: "POST", body: "not json" });
    expect(garbage.status).toBe(200);
    // A webhook registered with the bare host posts to "/", which is an alias of the receiver.
    const atRoot = await h.req("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "WH-TEST-ROOT-000001", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: cap.captureId, status: "COMPLETED" } }) });
    expect(atRoot.status).toBe(200);
    expect(((await atRoot.json()) as { ok: boolean }).ok).toBe(true);
    expect((await h.req("/")).status).toBe(302);
  }, 40_000);

  it("studio-turn streams NDJSON frames even without a key", async () => {
    const h = harness();
    const res = await h.post("/ai/studio-turn", { items: [{ type: "message", role: "user", content: "Build a widget" }], tools: [{ name: "addWidget", parameters: { type: "object", properties: {} } }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("ndjson");
    const frames = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string });
    expect(frames[0]!.type).toBe("RUN_STARTED");
    expect(frames.at(-1)!.type).toBe("RUN_FINISHED");
  });
});
