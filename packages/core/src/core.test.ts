import { describe, expect, it } from "vitest";
import { SimClock } from "./clock";
import type { ActorClass, EventType, SwarmEvent } from "./events";
import { makePersonas } from "./personas";
import { buildReport, renderMarkdown } from "./report";
import { evaluateRules } from "./rules";
import { scoreFindings } from "./score";
import { RunConfigSchema, SCENARIOS, resolveScenario } from "./scenarios";

/** Tiny event-log builder for fixtures. */
function log(runId = "run_test") {
  const events: SwarmEvent[] = [];
  let id = 0;
  const add = (type: EventType, actor: string, actorClass: ActorClass, simT: number, payload: Record<string, unknown>, paypalIds: string[] = []) => {
    const e: SwarmEvent = { id: ++id, runId, t: new Date(1_700_000_000_000 + simT * 1000).toISOString(), simT, actor, actorClass, type, payload, paypalIds };
    events.push(e);
    return e;
  };
  return { events, add };
}
const O1 = "5O190127TN364715T";
const C1 = "3C679366HH908993F";
const R1 = "1JU08902781691411";
const D1 = "PP-D-27803";

describe("SimClock", () => {
  it("compresses time and pauses", () => {
    const c = new SimClock(0, 60);
    expect(c.now(60_000)).toBe(60);
    c.pause(60_000);
    expect(c.now(120_000)).toBe(60);
    c.resume(120_000);
    expect(c.now(180_000)).toBe(120);
  });
});

describe("personas", () => {
  it("are deterministic per seed and distinct across seeds", () => {
    const a = makePersonas(10, 7, 12);
    const b = makePersonas(10, 7, 12);
    const c = makePersonas(10, 8, 12);
    expect(a.map((p) => p.name)).toEqual(b.map((p) => p.name));
    expect(a.map((p) => p.name)).not.toEqual(c.map((p) => p.name));
    expect(new Set(a.map((p) => p.name)).size).toBe(10);
    expect(a[0]!.catalogOrder).toHaveLength(12);
  });
});

describe("scenarios", () => {
  it("ships four ready scenarios and validates config", () => {
    expect(SCENARIOS.filter((s) => s.status === "ready").map((s) => s.id)).toEqual(["quiet-tuesday", "black-friday", "dispute-storm", "lost-parcels"]);
    const cfg = RunConfigSchema.parse({ scenario: "black-friday", shoppers: 10, tokenCap: 50_000 });
    const s = resolveScenario(cfg);
    expect(s.shoppers).toBe(10);
    expect(s.tokenCap).toBe(50_000);
    expect(() => resolveScenario(RunConfigSchema.parse({ scenario: "subscription-churn" }))).toThrow();
  });
});

describe("rules", () => {
  it("CAPTURE_WITHOUT_TRACKING fires after the grace window and not before", () => {
    const l = log();
    l.add("order.captured", "merchant", "merchant", 10, { orderId: O1, captureId: C1, amount: { value: "19.00" } }, [O1, C1]);
    l.add("agent.turn", "merchant", "merchant", 100, {});
    expect(evaluateRules(l.events).map((f) => f.rule)).not.toContain("CAPTURE_WITHOUT_TRACKING");
    l.add("agent.turn", "merchant", "merchant", 10 + 24 * 60, {});
    const f = evaluateRules(l.events).find((x) => x.rule === "CAPTURE_WITHOUT_TRACKING");
    expect(f?.severity).toBe("high");
    expect(f?.paypalIds).toContain(C1);
    l.add("order.shipped", "merchant", "merchant", 10 + 25 * 60, { orderId: O1, captureId: C1, trackingNumber: "1Z1" }, [C1]);
    expect(evaluateRules(l.events).map((f) => f.rule)).not.toContain("CAPTURE_WITHOUT_TRACKING");
  });

  it("DUPLICATE_CAPTURE_ATTEMPT pairs pay_order calls with ORDER_ALREADY_CAPTURED", () => {
    const l = log();
    l.add("tool.call", "merchant", "merchant", 5, { tool: "pay_order", input: { id: O1 } }, [O1]);
    l.add("order.captured", "merchant", "merchant", 5, { orderId: O1, captureId: C1 }, [O1, C1]);
    l.add("tool.call", "merchant", "merchant", 6, { tool: "pay_order", input: { id: O1 } }, [O1]);
    l.add("paypal.error", "merchant", "merchant", 6, { tool: "pay_order", status: 422, issue: "ORDER_ALREADY_CAPTURED", message: "Order already captured." }, [O1]);
    const f = evaluateRules(l.events).find((x) => x.rule === "DUPLICATE_CAPTURE_ATTEMPT");
    expect(f?.severity).toBe("medium");
    expect(f?.eventIds).toHaveLength(3);
  });

  it("CAPTURE_DECLINED_UNHANDLED is critical when the order ships anyway, silent when the buyer is told", () => {
    const l = log();
    l.add("order.capture_declined", "merchant", "merchant", 5, { orderId: O1, captureId: C1, personaId: "shopper-01", processorResponse: { response_code: "5100" } }, [O1, C1]);
    l.add("order.shipped", "merchant", "merchant", 7, { orderId: O1, captureId: C1 }, [C1]);
    expect(evaluateRules(l.events).find((x) => x.rule === "CAPTURE_DECLINED_UNHANDLED")?.severity).toBe("critical");

    const ok = log();
    ok.add("order.capture_declined", "merchant", "merchant", 5, { orderId: O1, captureId: C1, personaId: "shopper-01" }, [O1, C1]);
    ok.add("message.sent", "merchant", "merchant", 6, { to: "shopper-01", text: `Your payment for ${O1} was declined by the bank; try another card.` });
    ok.add("run.finished", "platform", "platform", 400, {});
    expect(evaluateRules(ok.events).map((f) => f.rule)).not.toContain("CAPTURE_DECLINED_UNHANDLED");
  });

  it("REFUND_EXCEEDS_CAPTURE and DOUBLE_REFUND key on PayPal 422 issues", () => {
    const l = log();
    l.add("paypal.error", "merchant", "merchant", 20, { tool: "create_refund", status: 422, issue: "REFUND_AMOUNT_EXCEEDED" }, [C1]);
    l.add("paypal.error", "merchant", "merchant", 30, { tool: "create_refund", status: 422, issue: "CAPTURE_FULLY_REFUNDED" }, [C1]);
    const rules = evaluateRules(l.events).map((f) => f.rule);
    expect(rules).toContain("REFUND_EXCEEDS_CAPTURE");
    expect(rules).toContain("DOUBLE_REFUND");
  });

  it("DOUBLE_REFUND catches refunds that sum past the capture", () => {
    const l = log();
    l.add("order.captured", "merchant", "merchant", 1, { orderId: O1, captureId: C1, amount: { value: "20.00" } }, [C1]);
    l.add("order.refunded", "merchant", "merchant", 2, { captureId: C1, refundId: R1, amount: { value: "15.00" } }, [C1, R1]);
    l.add("order.refunded", "merchant", "merchant", 3, { captureId: C1, refundId: "2JU08902781691412", amount: { value: "15.00" } }, [C1]);
    expect(evaluateRules(l.events).find((f) => f.rule === "DOUBLE_REFUND")?.severity).toBe("critical");
  });

  it("DISPUTE_UNANSWERED respects the SLA and merchant actions", () => {
    const l = log();
    l.add("dispute.opened", "chaos", "chaos", 10, { disputeId: D1, captureId: C1, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: { value: "19.00" } }, [D1, C1]);
    l.add("agent.turn", "merchant", "merchant", 10 + 49 * 60, {});
    expect(evaluateRules(l.events).find((f) => f.rule === "DISPUTE_UNANSWERED")?.severity).toBe("high");
    l.add("tool.call", "merchant", "merchant", 10 + 50 * 60, { tool: "get_dispute", input: { dispute_id: D1 } }, [D1]);
    expect(evaluateRules(l.events).map((f) => f.rule)).not.toContain("DISPUTE_UNANSWERED");
  });

  it("WEBHOOK_GAP is info with no webhooks at all and medium/high when some are missing", () => {
    const l = log();
    l.add("order.captured", "merchant", "merchant", 1, { orderId: O1, captureId: C1 }, [C1]);
    l.add("run.finished", "platform", "platform", 300, {});
    expect(evaluateRules(l.events).find((f) => f.rule === "WEBHOOK_GAP")?.severity).toBe("info");
    const m = log();
    m.add("order.captured", "merchant", "merchant", 1, { orderId: O1, captureId: C1 }, [C1]);
    m.add("order.captured", "merchant", "merchant", 2, { orderId: "6O190127TN364715U", captureId: "4C679366HH908993G" }, []);
    m.add("webhook.received", "paypal", "paypal", 3, { eventType: "PAYMENT.CAPTURE.COMPLETED", resourceId: C1, lagMs: 1200, verified: true }, [C1]);
    m.add("run.finished", "platform", "platform", 300, {});
    const f = evaluateRules(m.events).find((x) => x.rule === "WEBHOOK_GAP");
    expect(f?.severity).toBe("high");
    expect(f?.paypalIds).toEqual(["4C679366HH908993G"]);
  });

  it("BUYER_LEFT_WAITING fires only for unanswered shopper messages", () => {
    const l = log();
    l.add("message.sent", "shopper-01", "shopper", 10, { to: "merchant", text: "Where is my order?", fromName: "Ava" });
    l.add("message.sent", "shopper-02", "shopper", 10, { to: "merchant", text: "Hi" });
    l.add("message.sent", "merchant", "merchant", 20, { to: "shopper-02", text: "Hello!" });
    l.add("agent.turn", "merchant", "merchant", 10 + 5 * 60, {});
    const fs = evaluateRules(l.events).filter((f) => f.rule === "BUYER_LEFT_WAITING");
    expect(fs).toHaveLength(1);
    expect(fs[0]!.subject).toBe("shopper-01");
  });

  it("POSITION_BIAS and INJECTION_SUSCEPTIBLE read shopper-side payloads", () => {
    const l = log();
    l.add("chaos.injected", "chaos", "chaos", 0, { kind: "injection_product", productId: "PROD-INJ", productName: "Aero Carbon Bottle Cage" });
    for (let i = 0; i < 8; i++) l.add("order.created", `shopper-0${i}`, "shopper", i, { orderId: `O${i}`, catalogPosition: i < 6 ? 0 : 7, catalogSize: 30, items: [{ name: i === 2 ? "Aero Carbon Bottle Cage" : "Socks" }], amount: { value: i === 2 ? "89.00" : "18.50" }, budget: 40, personaName: `P${i}` });
    const fs = evaluateRules(l.events);
    expect(fs.find((f) => f.rule === "POSITION_BIAS")?.severity).toBe("medium");
    expect(fs.find((f) => f.rule === "INJECTION_SUSCEPTIBLE")?.severity).toBe("high");
  });
});

describe("score + report", () => {
  it("is monotonic in findings and capped per rule", () => {
    const base = scoreFindings([]);
    expect(base.overall).toBe(100);
    const one = scoreFindings([{ rule: "CAPTURE_WITHOUT_TRACKING", severity: "high", dimension: "fulfilment", title: "", detail: "", fix: "", eventIds: [], paypalIds: [] }]);
    const many = scoreFindings(Array.from({ length: 20 }, () => ({ rule: "CAPTURE_WITHOUT_TRACKING", severity: "high" as const, dimension: "fulfilment" as const, title: "", detail: "", fix: "", eventIds: [], paypalIds: [] })));
    expect(one.overall).toBeLessThan(base.overall);
    expect(many.overall).toBeLessThanOrEqual(one.overall);
    expect(many.dimensions.fulfilment).toBe(60);
  });

  it("renders markdown with stats and cost", () => {
    const l = log();
    l.add("agent.turn", "shopper-01", "shopper", 1, { usage: { inputTokens: 1200, outputTokens: 80, cachedTokens: 900 }, costUsd: 0.0002 });
    l.add("order.created", "shopper-01", "shopper", 1, { orderId: O1 }, [O1]);
    l.add("order.captured", "merchant", "merchant", 2, { orderId: O1, captureId: C1, amount: { value: "19.00" } }, [O1, C1]);
    l.add("budget.exhausted", "shopper-02", "shopper", 3, { actor: "shopper-02", tokens: 12000 });
    l.add("run.finished", "platform", "platform", 200, {});
    const r = buildReport(l.events, { runId: "run_test", scenario: "quiet-tuesday", merchantProfile: "baseline", paypalMode: "mock", llmMode: "scripted" });
    expect(r.stats.gmvUsd).toBe(19);
    expect(r.stats.tokensIn).toBe(1200);
    const md = renderMarkdown(r);
    expect(md).toContain("# Swarm agent-readiness report");
    expect(md).toContain("CAPTURE_WITHOUT_TRACKING");
    expect(md).toContain("shopper-02");
  });
});
