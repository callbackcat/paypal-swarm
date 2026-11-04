import type { ToolOutcome } from "./types";
import { summariseCapture } from "./types";

const clip = (s: unknown, n: number) => (typeof s === "string" && s.length > n ? s.slice(0, n - 1) + "…" : s);
const pick = (o: unknown, keys: string[]) => {
  const r = (o ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (r[k] !== undefined) out[k] = r[k];
  return out;
};

/**
 * What the model sees. Raw JSON stays in the event log; the context window gets ids, statuses and amounts only.
 * Keeps every tool result under roughly 600 tokens.
 */
export function trimForModel(tool: string, outcome: ToolOutcome): unknown {
  if (!outcome.ok) {
    return { error: { status: outcome.status, issue: outcome.issue, message: clip(outcome.message, 300) } };
  }
  const d = outcome.data as Record<string, unknown>;
  switch (tool) {
    case "list_products": {
      const products = ((d?.products as Array<Record<string, unknown>>) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: clip(p.description, 160),
      }));
      return { products, total_items: d?.total_items, total_pages: d?.total_pages };
    }
    case "show_product_details":
    case "create_product":
      return { ...pick(d, ["id", "name", "type", "category"]), description: clip(d?.description, 400) };
    case "create_order":
      return pick(d, ["id", "status"]);
    case "get_order":
    case "pay_order": {
      const cap = summariseCapture(d);
      const pu = (d?.purchase_units as Array<Record<string, unknown>> | undefined)?.[0];
      return {
        id: d?.id,
        status: d?.status,
        amount: pu?.amount,
        capture: cap.captureId ? { id: cap.captureId, status: cap.captureStatus, amount: cap.amount, processor_response: cap.processorResponse } : undefined,
      };
    }
    case "create_refund":
    case "get_refund":
      return pick(d, ["id", "status", "amount", "status_details"]);
    case "create_shipment_tracking":
    case "update_shipment_tracking":
    case "get_shipment_tracking": {
      const t = (d?.trackers as Array<Record<string, unknown>> | undefined)?.[0] ?? d;
      return pick(t, ["transaction_id", "tracking_number", "status", "carrier"]);
    }
    case "list_disputes": {
      const items = ((d?.items as Array<Record<string, unknown>>) ?? []).slice(0, 20).map((x) => pick(x, ["dispute_id", "reason", "status", "dispute_amount", "create_time", "dispute_life_cycle_stage"]));
      return { items, total_items: d?.total_items };
    }
    case "get_dispute":
      return pick(d, ["dispute_id", "reason", "status", "dispute_amount", "seller_response_due_date", "dispute_life_cycle_stage", "dispute_outcome"]);
    case "accept_dispute_claim":
      return { accepted: true, ...pick(d, ["dispute_id", "status"]) };
    case "list_transactions": {
      const txs = ((d?.transaction_details as Array<Record<string, unknown>>) ?? []).slice(0, 20).map((t) => {
        const info = (t.transaction_info ?? {}) as Record<string, unknown>;
        return pick(info, ["transaction_id", "transaction_status", "transaction_amount", "transaction_initiation_date"]);
      });
      return { transactions: txs, total_items: d?.total_items };
    }
    default: {
      const s = JSON.stringify(d ?? null);
      return s.length > 1500 ? { truncated: true, preview: s.slice(0, 1500) } : d;
    }
  }
}
