import { RunConfigSchema, SimClock, scenarioById } from "@swarm/core";
import { mockBackend } from "@swarm/paypal";
import { describe, expect, it } from "vitest";
import { BudgetGuard, estimateRun } from "./budget";
import { cacheKey, cacheMiddleware, MemoryCacheStore } from "./cache";
import { startRun, type RunDeps } from "./executor";
import { costFor, usageOfResult, ZERO_USAGE } from "./llm";
import { repairToolHistory, unansweredToolCalls, windowHistory } from "./history";
import { resolveCatalogRef } from "./shopper";
import { MemoryApprovalGate, MemoryEventSink } from "./world";

const fastDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  sink: new MemoryEventSink(),
  approvals: new MemoryApprovalGate("granted"),
  backend: mockBackend({ latencyMs: 2, webhookDelayMs: 1 }),
  llm: null,
  clock: new SimClock(Date.now(), 12_000), // 1 real second = 200 sim minutes, so SLAs elapse inside a test
  pacing: { stepMs: 15, chaosTickMs: 25, analystIntervalMs: 150, drainMs: 1200 },
  ...over,
});

describe("budget guard", () => {
  it("stops admitting at 80%, refuses calls at cap, emits events once", () => {
    const events: string[] = [];
    const g = new BudgetGuard({ runTokenCap: 10_000, shopperTokenCap: 3_000 }, (e) => events.push(`${e.type}:${e.actor}`));
    expect(g.admit()).toBe(true);
    g.record("shopper-01", { ...ZERO_USAGE, inputTokens: 2_900, outputTokens: 200, totalTokens: 3_100 });
    expect(g.check("shopper-01", "shopper")).toEqual({ ok: false, reason: "actor" });
    expect(g.check("shopper-01", "shopper").ok).toBe(false);
    expect(events.filter((e) => e === "budget.exhausted:shopper-01")).toHaveLength(1);
    g.record("merchant", { ...ZERO_USAGE, inputTokens: 5_000, outputTokens: 0, totalTokens: 5_000 });
    expect(g.admit()).toBe(false);
    expect(g.admit()).toBe(false);
    expect(events.filter((e) => e === "budget.warning:run")).toHaveLength(1);
    g.record("merchant", { ...ZERO_USAGE, inputTokens: 2_000, outputTokens: 0, totalTokens: 2_000 });
    expect(g.isExhausted).toBe(true);
    expect(g.check("merchant", "merchant")).toEqual({ ok: false, reason: "run" });
    expect(events).toContain("budget.exhausted:run");
  });

  it("estimates scenarios within the shipped caps and prices by model", () => {
    const bf = estimateRun(scenarioById("black-friday")!);
    expect(bf.tokens).toBeGreaterThan(100_000);
    expect(bf.overCap).toBe(false);
    expect(bf.usd).toBeGreaterThan(0.1);
    const cheap = estimateRun(scenarioById("black-friday")!, { models: { merchant: "anthropic/claude-haiku-5.5", analyst: "anthropic/claude-haiku-5.5" } });
    expect(cheap.usd).toBeLessThan(bf.usd);
    expect(estimateRun(scenarioById("quiet-tuesday")!, { scripted: true }).tokens).toBe(0);
    expect(costFor("anthropic/claude-haiku-5.5", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1, 5);
    expect(costFor("anthropic/claude-haiku-5.5", { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 })).toBeCloseTo(0.01, 5);
  });
});

describe("tool history repair", () => {
  const call = (id: string) => ({ type: "tool-call" as const, toolCallId: id, toolName: "pay_order", input: { id } });
  const result = (id: string) => ({ type: "tool-result" as const, toolCallId: id, toolName: "pay_order", output: { type: "json" as const, value: { ok: true } } });
  it("fills in an error result for tool calls a cut-off reply never ran", () => {
    const history = [
      { role: "user" as const, content: "capture" },
      { role: "assistant" as const, content: [call("a"), call("b")] },
      { role: "tool" as const, content: [result("a")] },
    ];
    expect(unansweredToolCalls(history).map((c) => c.toolCallId)).toEqual(["b"]);
    const fixed = repairToolHistory(history);
    expect(fixed).toHaveLength(3);
    const tool = fixed[2]!;
    expect(tool.role).toBe("tool");
    expect((tool.content as { toolCallId: string }[]).map((p) => p.toolCallId)).toEqual(["a", "b"]);
    expect(unansweredToolCalls(fixed)).toHaveLength(0);
    const tail = repairToolHistory([{ role: "assistant", content: [call("c")] }]);
    expect(tail).toHaveLength(2);
  });
  it("never opens a window on an orphan tool message", () => {
    const history = [
      { role: "user" as const, content: "one" },
      { role: "assistant" as const, content: [call("a")] },
      { role: "tool" as const, content: [result("a")] },
      { role: "assistant" as const, content: "done" },
    ];
    const w = windowHistory(history, 2);
    expect(w[0]!.role).toBe("assistant");
    expect(w).toHaveLength(3);
    expect(repairToolHistory([{ role: "tool", content: [result("zzz")] }, ...history])[0]!.role).toBe("user");
  });
});

describe("call cache", () => {
  it("returns the stored response for identical params and misses on any change", async () => {
    const store = new MemoryCacheStore();
    const mw = cacheMiddleware(store, "m");
    let calls = 0;
    const gen = (params: unknown) =>
      mw.wrapGenerate!({
        doGenerate: async () => {
          calls++;
          return { content: [{ type: "text", text: `r${calls}` }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [], response: { timestamp: new Date() } } as never;
        },
        doStream: async () => { throw new Error("n/a"); },
        params: params as never,
        model: {} as never,
      });
    const a = await gen({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    const b = await gen({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    const c = await gen({ prompt: [{ role: "user", content: [{ type: "text", text: "bye" }] }] });
    expect(calls).toBe(2);
    expect((a as { content: Array<{ text: string }> }).content[0]!.text).toBe("r1");
    expect((b as { content: Array<{ text: string }> }).content[0]!.text).toBe("r1");
    expect((c as { content: Array<{ text: string }> }).content[0]!.text).toBe("r2");
    expect(store.stats).toEqual({ hits: 1, misses: 2 });
    expect(cacheKey("m", { prompt: 1 })).not.toBe(cacheKey("n", { prompt: 1 }));
  });
});

describe("executor (mock PayPal, scripted agents)", () => {
  it("runs Quiet Tuesday end to end on the baseline merchant and finds the missing tracking", async () => {
    const deps = fastDeps();
    const h = startRun("run_qt_base", RunConfigSchema.parse({ scenario: "quiet-tuesday", merchantProfile: "baseline" }), deps);
    const res = await h.done;
    const types = (deps.sink as MemoryEventSink).events.map((e) => e.type);
    expect(types[0]).toBe("run.started");
    expect(types.at(-1)).toBe("run.finished");
    expect(res.reason).toBe("completed");
    expect(res.report.stats.ordersCreated).toBeGreaterThanOrEqual(4);
    expect(res.report.stats.captured).toBeGreaterThanOrEqual(4);
    expect(res.report.stats.shipped).toBe(0);
    expect(res.report.findings.map((f) => f.rule)).toContain("CAPTURE_WITHOUT_TRACKING");
    expect(res.report.stats.tokensIn).toBe(0);
    expect(res.budget.total).toBe(0);
    // Every tool.call has a matching tool.result and nothing leaked a card number.
    const calls = types.filter((t) => t === "tool.call").length;
    expect(types.filter((t) => t === "tool.result").length).toBe(calls);
    expect(JSON.stringify((deps.sink as MemoryEventSink).events)).not.toContain("4012888888881881");
  }, 30_000);

  it("hardened merchant ships everything and scores higher", async () => {
    const base = fastDeps();
    const hard = fastDeps();
    const [b, h] = await Promise.all([
      startRun("run_qt_b", RunConfigSchema.parse({ scenario: "quiet-tuesday", merchantProfile: "baseline" }), base).done,
      startRun("run_qt_h", RunConfigSchema.parse({ scenario: "quiet-tuesday", merchantProfile: "hardened" }), hard).done,
    ]);
    expect(h.report.stats.shipped).toBeGreaterThanOrEqual(4);
    expect(h.report.findings.map((f) => f.rule)).not.toContain("CAPTURE_WITHOUT_TRACKING");
    expect(h.report.score.overall).toBeGreaterThan(b.report.score.overall);
  }, 30_000);

  it("Black Friday chaos: declines, injection product, duplicate approvals and 429s all show up", async () => {
    const deps = fastDeps({ backend: mockBackend({ latencyMs: 1, webhookDelayMs: 1 }) });
    const res = await startRun("run_bf", RunConfigSchema.parse({ scenario: "black-friday", merchantProfile: "baseline", shoppers: 12 }), deps).done;
    const ev = (deps.sink as MemoryEventSink).events;
    const chaosKinds = ev.filter((e) => e.type === "chaos.injected").map((e) => String(e.payload.kind));
    expect(chaosKinds).toContain("injection_product");
    expect(chaosKinds).toContain("choice_overload");
    expect(chaosKinds).toContain("decline");
    expect(chaosKinds).toContain("duplicate_approval");
    expect(ev.some((e) => e.type === "order.capture_declined")).toBe(true);
    expect(ev.some((e) => e.type === "paypal.error" && e.payload.issue === "ORDER_ALREADY_CAPTURED")).toBe(true);
    const rules = res.report.findings.map((f) => f.rule);
    expect(rules).toContain("DUPLICATE_CAPTURE_ATTEMPT");
    expect(rules).toContain("CAPTURE_DECLINED_UNHANDLED");
    expect(res.report.stats.ordersCreated).toBeGreaterThanOrEqual(10);
  }, 45_000);

  it("Dispute storm: chargebacks open disputes; baseline ignores them, hardened accepts with approval", async () => {
    const base = fastDeps();
    const hard = fastDeps();
    const [b, h] = await Promise.all([
      startRun("run_ds_b", RunConfigSchema.parse({ scenario: "dispute-storm", merchantProfile: "baseline", shoppers: 8 }), base).done,
      startRun("run_ds_h", RunConfigSchema.parse({ scenario: "dispute-storm", merchantProfile: "hardened", shoppers: 8, approvalThresholdUsd: 10 }), hard).done,
    ]);
    expect(b.report.stats.disputesOpened).toBeGreaterThanOrEqual(1);
    expect(b.report.findings.map((f) => f.rule)).toContain("DISPUTE_UNANSWERED");
    const hev = (hard.sink as MemoryEventSink).events;
    expect(hev.some((e) => e.type === "approval.requested")).toBe(true);
    expect(hev.some((e) => e.type === "dispute.resolved" && e.payload.by === "merchant")).toBe(true);
    expect(h.report.findings.map((f) => f.rule)).not.toContain("DISPUTE_UNANSWERED");
    // oversized refund: baseline forwards the buyer's number and gets a 422
    expect((base.sink as MemoryEventSink).events.some((e) => e.type === "paypal.error" && e.payload.issue === "REFUND_AMOUNT_EXCEEDED")).toBe(true);
  }, 45_000);

  it("stop() ends a run early with a report", async () => {
    const deps = fastDeps({ pacing: { stepMs: 400, chaosTickMs: 50, analystIntervalMs: 500, drainMs: 500 } });
    const h = startRun("run_stop", RunConfigSchema.parse({ scenario: "black-friday", merchantProfile: "baseline", shoppers: 20 }), deps);
    await h.world;
    setTimeout(() => h.control.stop(), 300);
    const res = await h.done;
    expect(res.reason).toBe("stopped");
    expect(res.report.meta.runId).toBe("run_stop");
    expect((deps.sink as MemoryEventSink).events.at(-1)?.type).toBe("run.finished");
  }, 20_000);

  it("human approval timeout denies the refund and the merchant tells the customer", async () => {
    const approvals = new MemoryApprovalGate();
    const deps = fastDeps({ approvals });
    const cfg = RunConfigSchema.parse({ scenario: "dispute-storm", merchantProfile: "hardened", shoppers: 6, approvalThresholdUsd: 5, approvalTimeoutSec: 1 });
    const res = await startRun("run_apr", cfg, deps).done;
    const ev = (deps.sink as MemoryEventSink).events;
    expect(ev.some((e) => e.type === "approval.requested")).toBe(true);
    expect(ev.some((e) => e.type === "approval.denied" && e.payload.decision === "timeout")).toBe(true);
    expect(res.report).toBeTruthy();
  }, 45_000);
});

describe("catalog reference resolver", () => {
  const view = [
    { id: "PROD-AAA111", name: "Trailhead Merino Socks (2-pack)" },
    { id: "PROD-BBB222", name: "Summit Insulated Bottle 650 ml" },
    { id: "PROD-CCC333", name: "Gravel Tyre 700x40c" },
    { id: "PROD-DDD444", name: "Summit Insulated Bottle 1 l" },
  ];
  it("resolves ids, names, slugs, shortened names and list numbers", () => {
    expect(resolveCatalogRef(view, "prodaaa111")?.id).toBe("PROD-AAA111");
    expect(resolveCatalogRef(view, "Gravel Tyre 700x40c")?.id).toBe("PROD-CCC333");
    expect(resolveCatalogRef(view, "gravel-tyre-700x40c")?.id).toBe("PROD-CCC333");
    expect(resolveCatalogRef(view, "trailhead-merino-socks")?.id).toBe("PROD-AAA111");
    expect(resolveCatalogRef(view, "trailhead-merino-socks-2pk")?.id).toBe("PROD-AAA111");
    expect(resolveCatalogRef(view, "summit-insulated-bottle-650")?.id).toBe("PROD-BBB222");
    expect(resolveCatalogRef(view, "3")?.id).toBe("PROD-CCC333");
  });
  it("returns nothing for an ambiguous or unknown reference", () => {
    expect(resolveCatalogRef(view, "summit-insulated-bottle")).toBeUndefined();
    expect(resolveCatalogRef(view, "carbon-wheelset")).toBeUndefined();
    expect(resolveCatalogRef(view, "9")).toBeUndefined();
    expect(resolveCatalogRef(view, "")).toBeUndefined();
  });
});

describe("usage of a multi-step call", () => {
  const step = (input: number, output: number, cost?: number) => ({
    usage: { inputTokens: input, outputTokens: output, totalTokens: input + output } as never,
    providerMetadata: cost === undefined ? undefined : ({ openrouter: { usage: { cost } } } as never),
  });
  it("sums tokens and the reported cost over every step, not just the last one", () => {
    const u = usageOfResult("anthropic/claude-haiku-5.5", { steps: [step(1000, 100, 0.001), step(2000, 50, 0.002), step(3000, 20, 0.0005)] });
    expect(u.inputTokens).toBe(6000);
    expect(u.outputTokens).toBe(170);
    expect(u.costUsd).toBeCloseTo(0.0035, 8);
    expect(u.reportedCostUsd).toBeCloseTo(0.0035, 8);
  });
  it("prices a step from the table when the provider reported no cost for it", () => {
    const u = usageOfResult("anthropic/claude-haiku-5.5", { steps: [step(1000, 100, 0.001), step(1_000_000, 0)] });
    expect(u.costUsd).toBeCloseTo(0.001 + 0.1, 6);
    expect(u.reportedCostUsd).toBeUndefined();
  });
  it("falls back to the call totals when there are no steps", () => {
    const u = usageOfResult("anthropic/claude-haiku-5.5", { totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } as never });
    expect(u.totalTokens).toBe(15);
  });
});
