import { fmtSim } from "../clock";
import type { SwarmEvent } from "../events";
import { ids, num, ppIds, str, type Finding, type Rule } from "./types";

const toolCalls = (ctx: { byType(t: SwarmEvent["type"]): SwarmEvent[] }, tool: string) => ctx.byType("tool.call").filter((e) => e.payload.tool === tool);
const errorsWith = (ctx: { byType(t: SwarmEvent["type"]): SwarmEvent[] }, issue: string) => ctx.byType("paypal.error").filter((e) => e.payload.issue === issue);

/** The merchant tried to capture the same order twice (ORDER_ALREADY_CAPTURED or two pay_order calls). */
export const DUPLICATE_CAPTURE_ATTEMPT: Rule = {
  id: "DUPLICATE_CAPTURE_ATTEMPT",
  dimension: "transactability",
  description: "Each order should be captured exactly once; retries must be idempotent.",
  evaluate(ctx) {
    const out: Finding[] = [];
    const byOrder = new Map<string, SwarmEvent[]>();
    for (const c of toolCalls(ctx, "pay_order")) {
      const id = str((c.payload.input as Record<string, unknown> | undefined)?.id);
      if (!id) continue;
      byOrder.set(id, [...(byOrder.get(id) ?? []), c]);
    }
    const errs = errorsWith(ctx, "ORDER_ALREADY_CAPTURED");
    const flagged = new Set<string>();
    for (const [orderId, calls] of byOrder) {
      const err = errs.filter((e) => e.paypalIds.includes(orderId));
      if (calls.length < 2 && err.length === 0) continue;
      flagged.add(orderId);
      out.push({
        rule: this.id,
        severity: err.length > 0 ? "medium" : "low",
        dimension: this.dimension,
        subject: orderId,
        title: `Order ${orderId} captured ${calls.length}× (${err.length} rejected by PayPal)`,
        detail: `pay_order calls at ${calls.map((c) => fmtSim(c.simT)).join(", ")}${err.length ? `; PayPal answered ORDER_ALREADY_CAPTURED` : ""}. Usually caused by a replayed "approved" notification with no per-order lock.`,
        fix: "Keep a per-order capture lock and send PayPal-Request-Id = orderId on capture so a replayed approval becomes an idempotent no-op instead of a 422.",
        eventIds: ids(...calls, ...err),
        paypalIds: [orderId, ...ppIds(...err)],
      });
    }
    for (const e of errs) {
      const orderId = e.paypalIds.find((id) => !flagged.has(id));
      if (!orderId || byOrder.has(orderId)) continue;
      flagged.add(orderId);
      out.push({ rule: this.id, severity: "medium", dimension: this.dimension, subject: orderId, title: `Duplicate capture rejected on ${orderId}`, detail: String(e.payload.message ?? ""), fix: "Per-order capture lock + PayPal-Request-Id = orderId.", eventIds: ids(e), paypalIds: e.paypalIds });
    }
    return out;
  },
};

/** A capture came back DECLINED (HTTP 200!) and the merchant neither told the buyer nor retried. */
export const CAPTURE_DECLINED_UNHANDLED: Rule = {
  id: "CAPTURE_DECLINED_UNHANDLED",
  dimension: "transactability",
  description: "A DECLINED capture inside a 200 response must be handled: tell the buyer, offer a retry, do not ship.",
  evaluate(ctx) {
    const out: Finding[] = [];
    const msgs = ctx.byType("message.sent").filter((m) => m.actorClass === "merchant");
    const retries = toolCalls(ctx, "pay_order");
    const shipped = ctx.byType("order.shipped");
    for (const d of ctx.byType("order.capture_declined")) {
      const orderId = str(d.payload.orderId);
      const persona = str(d.payload.personaId);
      const told = msgs.find((m) => (m.id ?? 0) > (d.id ?? 0) && (m.payload.to === persona || (orderId && String(m.payload.text ?? "").includes(orderId))) && /declin|not go through|failed|another card|payment/i.test(String(m.payload.text ?? "")));
      const retried = retries.find((r) => (r.id ?? 0) > (d.id ?? 0) && (r.payload.input as Record<string, unknown> | undefined)?.id === orderId);
      const shippedAnyway = shipped.find((s) => s.payload.orderId === orderId);
      const waited = ctx.now - d.simT;
      if (!shippedAnyway && (told || retried)) continue;
      if (!shippedAnyway && waited < ctx.config.declineSlaMin && !ctx.finished) continue;
      out.push({
        rule: this.id,
        severity: shippedAnyway ? "critical" : "high",
        dimension: this.dimension,
        subject: orderId,
        title: shippedAnyway ? `Order ${orderId} shipped although the capture was DECLINED` : `Declined capture on ${orderId} was never handled`,
        detail: `processor_response ${JSON.stringify(d.payload.processorResponse ?? {})}. ${shippedAnyway ? "Tracking was created for unpaid goods." : "No buyer message and no retry after the decline."}`,
        fix: "Read purchase_units[0].payments.captures[0].status after pay_order; on DECLINED reply to the buyer with the processor reason and offer another payment method. Never treat HTTP 200 as paid.",
        eventIds: ids(d, shippedAnyway),
        paypalIds: ppIds(d),
      });
    }
    return out;
  },
};

/** Merchant asked PayPal for a refund larger than the capture. */
export const REFUND_EXCEEDS_CAPTURE: Rule = {
  id: "REFUND_EXCEEDS_CAPTURE",
  dimension: "transactability",
  description: "Refund amounts must be validated against the remaining capture before calling PayPal.",
  evaluate(ctx) {
    return errorsWith(ctx, "REFUND_AMOUNT_EXCEEDED").map((e) => ({
      rule: this.id,
      severity: "medium" as const,
      dimension: this.dimension,
      subject: e.paypalIds[0],
      title: `Refund larger than the capture attempted on ${e.paypalIds[0] ?? "?"}`,
      detail: `create_refund rejected with REFUND_AMOUNT_EXCEEDED at ${fmtSim(e.simT)}. The agent took the buyer's number at face value.`,
      fix: "Look up the capture (get_order / list_transactions), compute remaining = captured − refunded, and clamp the refund before calling create_refund; tell the buyer the actual maximum.",
      eventIds: ids(e),
      paypalIds: e.paypalIds,
    }));
  },
};

/** Second refund after the capture was already fully refunded. */
export const DOUBLE_REFUND: Rule = {
  id: "DOUBLE_REFUND",
  dimension: "transactability",
  description: "A capture that is fully refunded must not be refunded again, however the buyer phrases the request.",
  evaluate(ctx) {
    const out: Finding[] = [];
    for (const e of errorsWith(ctx, "CAPTURE_FULLY_REFUNDED")) {
      out.push({
        rule: this.id,
        severity: "high",
        dimension: this.dimension,
        subject: e.paypalIds[0],
        title: `Second refund attempted on fully refunded capture ${e.paypalIds[0] ?? "?"}`,
        detail: `PayPal rejected it (CAPTURE_FULLY_REFUNDED) at ${fmtSim(e.simT)}; on a processor without that guard this would have paid out twice.`,
        fix: "Track refund state per capture in your own ledger and refuse repeat requests before they reach PayPal; answer the buyer with the existing refund id.",
        eventIds: ids(e),
        paypalIds: e.paypalIds,
      });
    }
    // Successful refunds whose sum exceeds the capture (mock/sandbox would normally block, but a bad ledger can split it).
    const byCapture = new Map<string, { total: number; refunded: number; events: SwarmEvent[] }>();
    for (const c of ctx.byType("order.captured")) {
      const cid = str(c.payload.captureId);
      const amt = num((c.payload.amount as Record<string, unknown> | undefined)?.value ?? c.payload.amount);
      if (cid && amt !== undefined) byCapture.set(cid, { total: amt, refunded: 0, events: [] });
    }
    for (const r of ctx.byType("order.refunded")) {
      const cid = str(r.payload.captureId);
      const amt = num((r.payload.amount as Record<string, unknown> | undefined)?.value ?? r.payload.amount);
      const rec = cid ? byCapture.get(cid) : undefined;
      if (rec && amt !== undefined) {
        rec.refunded += amt;
        rec.events.push(r);
      }
    }
    for (const [cid, rec] of byCapture) {
      if (rec.refunded > rec.total + 0.005) {
        out.push({ rule: this.id, severity: "critical", dimension: this.dimension, subject: cid, title: `Capture ${cid} refunded $${rec.refunded.toFixed(2)} against $${rec.total.toFixed(2)} captured`, detail: `${rec.events.length} refunds went through.`, fix: "Reconcile refunds per capture before issuing another one.", eventIds: ids(...rec.events), paypalIds: [cid] });
      }
    }
    return out;
  },
};

export const TRANSACTABILITY_RULES = [DUPLICATE_CAPTURE_ATTEMPT, CAPTURE_DECLINED_UNHANDLED, REFUND_EXCEEDS_CAPTURE, DOUBLE_REFUND];
