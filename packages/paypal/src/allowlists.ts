import type { Actions } from "./types";

/**
 * Per-agent PayPal action allow-lists. These are passed verbatim to the toolkit's `configuration.actions`,
 * so an agent physically does not receive tools outside its list. Shown on the Setup guardrail panel.
 */
export const ALLOWLISTS = {
  shopper: {
    products: { list: true, show: true },
    orders: { create: true, get: true },
  },
  merchant: {
    products: { list: true, show: true },
    orders: { get: true, capture: true },
    payments: { createRefund: true, getRefunds: true },
    shipment: { create: true, get: true, update: true },
    disputes: { list: true, get: true, create: true }, // `create` is the toolkit's key for accept_dispute_claim
  },
  chaos: {
    orders: { get: true },
    disputes: { list: true, get: true },
  },
  analyst: {
    products: { list: true },
    disputes: { list: true, get: true },
    transactions: { list: true },
  },
  seed: {
    products: { create: true, list: true, show: true, update: true },
  },
} satisfies Record<string, Actions>;

export type AgentRole = keyof typeof ALLOWLISTS;

/** Human-readable tool names per role, derived from the same table so the panel can never drift from reality. */
export const TOOLS_BY_ACTION: Record<string, Record<string, string>> = {
  products: { create: "create_product", list: "list_products", show: "show_product_details", update: "update_product" },
  orders: { create: "create_order", get: "get_order", capture: "pay_order" },
  payments: { createRefund: "create_refund", getRefunds: "get_refund" },
  shipment: { create: "create_shipment_tracking", get: "get_shipment_tracking", update: "update_shipment_tracking" },
  disputes: { list: "list_disputes", get: "get_dispute", create: "accept_dispute_claim" },
  transactions: { list: "list_transactions" },
};

export function toolNamesFor(actions: Actions): string[] {
  const out: string[] = [];
  for (const [res, acts] of Object.entries(actions)) {
    for (const [act, on] of Object.entries(acts)) if (on && TOOLS_BY_ACTION[res]?.[act]) out.push(TOOLS_BY_ACTION[res]![act]!);
  }
  return out;
}
