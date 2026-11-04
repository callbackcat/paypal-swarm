import { fmtSim } from "../clock";
import { ids, num, ppIds, str, type Finding, type Rule } from "./types";

/** A capture with no shipment tracking inside the grace window. */
export const CAPTURE_WITHOUT_TRACKING: Rule = {
  id: "CAPTURE_WITHOUT_TRACKING",
  dimension: "fulfilment",
  description: "Every completed capture should get create_shipment_tracking within 24 simulated hours.",
  evaluate(ctx) {
    const out: Finding[] = [];
    const shipped = ctx.byType("order.shipped");
    for (const cap of ctx.byType("order.captured")) {
      const orderId = str(cap.payload.orderId);
      const captureId = str(cap.payload.captureId);
      const match = shipped.find((s) => (orderId && s.payload.orderId === orderId) || (captureId && s.payload.captureId === captureId));
      if (match) continue;
      const waited = ctx.now - cap.simT;
      if (waited < ctx.config.trackingGraceMin && !(ctx.finished && waited >= 60)) continue;
      out.push({
        rule: this.id,
        severity: "high",
        dimension: this.dimension,
        subject: orderId,
        title: `Order ${orderId ?? "?"} captured but never shipped`,
        detail: `Capture ${captureId ?? "?"} at ${fmtSim(cap.simT)}; no tracking after ${Math.round(waited / 60)} simulated hours.`,
        fix: "After pay_order returns COMPLETED, call create_shipment_tracking with the capture id as transaction_id; PayPal seller protection and buyer confidence both depend on it.",
        eventIds: ids(cap),
        paypalIds: ppIds(cap),
      });
    }
    return out;
  },
};

/** A shopper message with no merchant reply inside the SLA. */
export const BUYER_LEFT_WAITING: Rule = {
  id: "BUYER_LEFT_WAITING",
  dimension: "fulfilment",
  description: "Shopper messages to the merchant should get a reply within 4 simulated hours.",
  evaluate(ctx) {
    const out: Finding[] = [];
    const msgs = ctx.byType("message.sent");
    const seen = new Set<string>();
    for (const m of msgs) {
      if (m.actorClass !== "shopper" || m.payload.to !== "merchant") continue;
      const persona = m.actor;
      const reply = msgs.find((r) => r.actorClass === "merchant" && r.payload.to === persona && r.simT >= m.simT && (r.id ?? 0) > (m.id ?? 0));
      if (reply) continue;
      const waited = ctx.now - m.simT;
      if (waited < ctx.config.replySlaMin && !(ctx.finished && waited >= 30)) continue;
      if (seen.has(persona)) continue;
      seen.add(persona);
      const later = msgs.filter((x) => x.actor === persona && x.payload.to === "merchant" && (x.id ?? 0) > (m.id ?? 0));
      out.push({
        rule: this.id,
        severity: later.length > 0 ? "high" : "medium",
        dimension: this.dimension,
        subject: persona,
        title: `${str(m.payload.fromName) ?? persona} wrote to the merchant and never heard back`,
        detail: `"${String(m.payload.text ?? "").slice(0, 140)}" at ${fmtSim(m.simT)}${later.length ? `, followed up ${later.length}×` : ""}.`,
        fix: "Route every inbound buyer message to the merchant agent's inbox and require reply_to_customer before the turn ends; measure reply latency as a KPI.",
        eventIds: ids(m, ...later),
        paypalIds: ppIds(m),
      });
    }
    return out;
  },
};

/** Exported so the report can state the SLA numbers it applied. */
export const FULFILMENT_RULES = [CAPTURE_WITHOUT_TRACKING, BUYER_LEFT_WAITING];
export const _num = num;
