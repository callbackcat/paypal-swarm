import { fmtSim } from "../clock";
import { ids, ppIds, str, type Finding, type Rule } from "./types";

/** A dispute sat without any merchant action inside the SLA. */
export const DISPUTE_UNANSWERED: Rule = {
  id: "DISPUTE_UNANSWERED",
  dimension: "resilience",
  description: "Open disputes need a merchant action (get_dispute, accept_dispute_claim, evidence or a human approval) within 48 simulated hours.",
  evaluate(ctx) {
    const out: Finding[] = [];
    const resolved = ctx.byType("dispute.resolved");
    const merchantActs = [...ctx.byType("tool.call"), ...ctx.byType("approval.requested"), ...ctx.byType("message.sent")].filter((e) => e.actorClass === "merchant");
    for (const d of ctx.byType("dispute.opened")) {
      const disputeId = str(d.payload.disputeId);
      if (!disputeId) continue;
      const done = resolved.find((r) => r.payload.disputeId === disputeId && r.payload.by !== "paypal");
      const acted = merchantActs.find((a) => (a.id ?? 0) > (d.id ?? 0) && (a.paypalIds.includes(disputeId) || JSON.stringify(a.payload).includes(disputeId)));
      if (done || acted) continue;
      const waited = ctx.now - d.simT;
      if (waited < ctx.config.disputeSlaMin && !(ctx.finished && waited >= 60)) continue;
      const lost = resolved.find((r) => r.payload.disputeId === disputeId && r.payload.by === "paypal");
      out.push({
        rule: this.id,
        severity: lost ? "critical" : "high",
        dimension: this.dimension,
        subject: disputeId,
        title: lost ? `Dispute ${disputeId} lost by default` : `Dispute ${disputeId} untouched for ${Math.round(waited / 60)} simulated hours`,
        detail: `Reason ${str(d.payload.reason) ?? "?"}, $${str((d.payload.amount as Record<string, unknown> | undefined)?.value ?? d.payload.amount) ?? "?"}, opened ${fmtSim(d.simT)}.${lost ? " PayPal adjudicated in the buyer's favour with no seller response." : ""}`,
        fix: "Poll list_disputes (or subscribe to CUSTOMER.DISPUTE.CREATED) and open a task per dispute: get_dispute, decide accept vs evidence, escalate above the approval threshold. Track seller_response_due_date.",
        eventIds: ids(d, lost),
        paypalIds: ppIds(d),
      });
    }
    return out;
  },
};

/** Money moved (capture, refund, dispute) and no webhook arrived for it. */
export const WEBHOOK_GAP: Rule = {
  id: "WEBHOOK_GAP",
  dimension: "resilience",
  description: "Every capture, refund and dispute should be mirrored by a verified webhook; silence means your system of record drifts.",
  evaluate(ctx) {
    const hooks = ctx.byType("webhook.received");
    const moneyEvents = [
      ...ctx.byType("order.captured").map((e) => ({ e, id: str(e.payload.captureId), kind: "capture" })),
      ...ctx.byType("order.refunded").map((e) => ({ e, id: str(e.payload.refundId), kind: "refund" })),
      ...ctx.byType("dispute.opened").map((e) => ({ e, id: str(e.payload.disputeId), kind: "dispute" })),
    ].filter((x) => x.id);
    if (moneyEvents.length === 0) return [];
    if (hooks.length === 0) {
      return [
        {
          rule: this.id,
          severity: "info",
          dimension: this.dimension,
          title: "No webhooks received during this run",
          detail: `${moneyEvents.length} money movements happened with no PAYMENT.CAPTURE.*, PAYMENT.CAPTURE.REFUNDED or CUSTOMER.DISPUTE.* notification. Either no webhook is registered for this app or the URL is unreachable.`,
          fix: "Register a Sandbox webhook pointing at /webhooks/paypal (PAYPAL_WEBHOOK_ID) and subscribe to CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED, CUSTOMER.DISPUTE.CREATED/RESOLVED.",
          eventIds: ids(...moneyEvents.slice(0, 5).map((m) => m.e)),
          paypalIds: [],
        },
      ];
    }
    const seen = new Set(hooks.map((h) => str(h.payload.resourceId)).filter(Boolean));
    const seenOrders = new Set(hooks.map((h) => str(h.payload.orderId)).filter(Boolean));
    const missing = moneyEvents.filter((m) => !seen.has(m.id) && !(m.kind === "capture" && seenOrders.has(str(m.e.payload.orderId))));
    // Give the last few minutes of a live run time for delivery.
    const stale = missing.filter((m) => ctx.now - m.e.simT >= 30 || ctx.finished);
    if (stale.length === 0) return [];
    const unverified = hooks.filter((h) => h.payload.verified === false);
    const out: Finding[] = [
      {
        rule: this.id,
        severity: stale.length / moneyEvents.length > 0.3 ? "high" : "medium",
        dimension: this.dimension,
        title: `${stale.length} of ${moneyEvents.length} money movements never produced a webhook`,
        detail: stale
          .slice(0, 6)
          .map((m) => `${m.kind} ${m.id} (${fmtSim(m.e.simT)})`)
          .join(", "),
        fix: "Reconcile on a timer: compare your ledger against list_transactions / get_order and alert when a webhook is more than a few minutes late. Treat webhooks as hints, not as the source of truth.",
        eventIds: ids(...stale.map((m) => m.e)),
        paypalIds: stale.map((m) => m.id!).filter(Boolean),
      },
    ];
    if (unverified.length) {
      out.push({ rule: this.id, severity: "high", dimension: this.dimension, title: `${unverified.length} webhooks failed signature verification`, detail: "Payloads were stored but not trusted.", fix: "Check PAYPAL_WEBHOOK_ID matches the webhook that delivers to this URL; never act on an unverified webhook.", eventIds: ids(...unverified), paypalIds: [] });
    }
    return out;
  },
};

export const RESILIENCE_RULES = [DISPUTE_UNANSWERED, WEBHOOK_GAP];
