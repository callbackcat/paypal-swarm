import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import type { ZodTypeAny } from "zod";
import { isDeclineName } from "./cards";
import type { Actions, CardDetails, ConfirmResult, PayPalBackend, SwarmTool, ToolOutcome, WebhookEvent } from "./types";

/**
 * In-memory PayPal that speaks the toolkit's tool contract exactly (same names, same zod schemas, same
 * JSON shapes, same 422 issues). Lets the whole pipeline run with no credentials, drives the vitest
 * fixtures, and is the zero-cost replay backend for judges.
 */
export interface MockOptions {
  /** Base latency per call in ms; actual latency is uniform in [base, 3*base]. */
  latencyMs?: number;
  /** Every Nth call returns a 429 (0 = never). */
  rateLimitEvery?: number;
  /** Delay before synthetic webhooks are delivered. */
  webhookDelayMs?: number;
  /** Fraction of webhooks that are silently dropped (for WEBHOOK_GAP). */
  webhookDropRate?: number;
  seed?: number;
}

type Money = { currency_code: string; value: string };
interface MockOrder {
  id: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "VOIDED";
  amount: Money;
  items: Array<{ name: string; quantity: number; unit_amount: Money; sku?: string }>;
  cardName?: string;
  captureId?: string;
  create_time: string;
}
interface MockCapture {
  id: string;
  orderId: string;
  status: "COMPLETED" | "DECLINED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  amount: Money;
  refunded: number;
  processor_response?: Record<string, unknown>;
  create_time: string;
}
interface MockDispute {
  dispute_id: string;
  captureId: string;
  reason: string;
  status: string;
  dispute_amount: Money;
  dispute_life_cycle_stage: string;
  create_time: string;
  seller_response_due_date: string;
  dispute_outcome?: { outcome_code: string };
}

const id17 = (rng: () => number) => Array.from({ length: 17 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[Math.floor(rng() * 34)]).join("");
const money = (v: number, c = "USD"): Money => ({ currency_code: c, value: v.toFixed(2) });
const err = (status: number, issue: string, message: string): ToolOutcome => ({ ok: false, status, issue, message: `${issue}: ${message}`, data: { name: status === 422 ? "UNPROCESSABLE_ENTITY" : "RESOURCE_NOT_FOUND", message, details: [{ issue, description: message }], debug_id: randomUUID().slice(0, 13) } });
const ok = (data: unknown, status = 200): ToolOutcome => ({ ok: true, status, data });

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockBackend(opts: MockOptions = {}): PayPalBackend & { store: MockStore } {
  const store = new MockStore(opts);
  return {
    mode: "mock",
    store,
    tools: (actions) => store.tools(actions),
    createOrderWithoutSource: async (i) => store.guard(() => ok(store.createOrder({ amount: Number(i.amount), items: [{ name: i.description ?? "item", quantity: 1, unit_amount: money(Number(i.amount)) }] }), 201)),
    confirmWithCard: (orderId, card) => store.confirm(orderId, card),
    captureOrder: async (orderId, o) => store.guard(() => store.capture(orderId, o?.mockIssue)),
    addTracking: async (i) => {
      const t = store.tools({ shipment: { create: true } }).find((x) => x.name === "create_shipment_tracking")!;
      return t.run({ transaction_id: i.captureId, tracking_number: i.trackingNumber, status: i.status ?? "SHIPPED", carrier: i.carrier });
    },
    processChargeback: async (i) => {
      const d = store.openDispute(i.captureId, Number(i.amount), i.reasonCode);
      return d ? { httpStatus: 201, disputeId: d.dispute_id, raw: { links: [{ href: `https://api-m.sandbox.paypal.com/v1/customer/disputes/${d.dispute_id}`, rel: "self" }] } } : { httpStatus: 404, raw: { name: "RESOURCE_NOT_FOUND" } };
    },
    adjudicate: async (id, outcome) => store.adjudicate(id, outcome),
    acceptClaim: async (id, note) => store.acceptClaim(id, note),
    verifyWebhook: async () => true,
    onWebhook: (h) => store.onWebhook(h),
  };
}

export class MockStore {
  readonly products = new Map<string, { id: string; name: string; description: string; type: string; create_time: string }>();
  readonly orders = new Map<string, MockOrder>();
  readonly captures = new Map<string, MockCapture>();
  readonly refunds = new Map<string, { id: string; captureId: string; status: string; amount: Money; create_time: string }>();
  readonly disputes = new Map<string, MockDispute>();
  readonly trackers = new Map<string, { transaction_id: string; tracking_number: string; status: string; carrier?: string }>();
  readonly rng: () => number;
  private calls = 0;
  private webhookHandlers = new Set<(e: WebhookEvent) => void>();
  private schemaToolkit: Record<string, { description: string; parameters: ZodTypeAny }>;

  constructor(readonly opts: MockOptions) {
    this.rng = mulberry32(opts.seed ?? 42);
    // Borrow the real tool descriptions and zod schemas so agents cannot tell mock from sandbox.
    const tk = new PayPalAgentToolkit({ clientId: "mock", clientSecret: "mock", configuration: { actions: ALL_ACTIONS, context: { sandbox: true } } });
    this.schemaToolkit = tk.getTools() as unknown as Record<string, { description: string; parameters: ZodTypeAny }>;
  }

  /** Chaos hook: every Nth call answers 429 (0 disables). */
  setRateLimitEvery(n: number) {
    this.opts.rateLimitEvery = n;
  }

  onWebhook(h: (e: WebhookEvent) => void) {
    this.webhookHandlers.add(h);
    return () => this.webhookHandlers.delete(h);
  }
  private emit(event_type: string, resource: Record<string, unknown>) {
    if (this.webhookHandlers.size === 0) return;
    if (this.opts.webhookDropRate && this.rng() < this.opts.webhookDropRate) return;
    const evt: WebhookEvent = { id: `WH-${randomUUID().slice(0, 12).toUpperCase()}`, event_type, create_time: new Date().toISOString(), resource };
    setTimeout(() => this.webhookHandlers.forEach((h) => h(evt)), this.opts.webhookDelayMs ?? 800);
  }

  async guard<T extends ToolOutcome>(fn: () => T | Promise<T>): Promise<ToolOutcome> {
    this.calls++;
    const base = this.opts.latencyMs ?? 60;
    await new Promise((r) => setTimeout(r, base + this.rng() * base * 2));
    if (this.opts.rateLimitEvery && this.calls % this.opts.rateLimitEvery === 0) {
      return { ok: false, status: 429, issue: "RATE_LIMIT_REACHED", message: "RATE_LIMIT_REACHED: Too many requests", data: { name: "RATE_LIMIT_REACHED" } };
    }
    return fn();
  }

  // ---- catalog ---------------------------------------------------------------------------------
  createProduct(p: { name: string; description?: string; type?: string }) {
    const id = `PROD-${id17(this.rng).slice(0, 13)}`;
    const rec = { id, name: p.name, description: p.description ?? "", type: p.type ?? "PHYSICAL", create_time: new Date().toISOString() };
    this.products.set(id, rec);
    return rec;
  }
  listProducts(page = 1, pageSize = 20) {
    const all = [...this.products.values()];
    const start = (page - 1) * pageSize;
    return { products: all.slice(start, start + pageSize), total_items: all.length, total_pages: Math.max(1, Math.ceil(all.length / pageSize)) };
  }

  // ---- orders ----------------------------------------------------------------------------------
  createOrder(input: { amount: number; items: MockOrder["items"] }) {
    const id = id17(this.rng);
    const o: MockOrder = { id, status: "CREATED", amount: money(input.amount), items: input.items, create_time: new Date().toISOString() };
    this.orders.set(id, o);
    return this.orderJson(o, 201);
  }
  orderJson(o: MockOrder, _status = 200) {
    const cap = o.captureId ? this.captures.get(o.captureId) : undefined;
    return {
      id: o.id,
      status: o.status,
      intent: "CAPTURE",
      create_time: o.create_time,
      purchase_units: [
        {
          reference_id: "swarm",
          amount: o.amount,
          payee: { merchant_id: "MOCKMERCHANT1234", email_address: "merchant@swarm.mock" },
          items: o.items,
          payments: cap ? { captures: [this.captureJson(cap)] } : undefined,
        },
      ],
      payer: o.cardName ? { name: { given_name: o.cardName.split(" ")[0] } } : undefined,
      links: [{ href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${o.id}`, rel: "self", method: "GET" }],
    };
  }
  captureJson(c: MockCapture) {
    return { id: c.id, status: c.status, amount: c.amount, final_capture: true, processor_response: c.processor_response, create_time: c.create_time, seller_receivable_breakdown: { gross_amount: c.amount } };
  }
  async confirm(orderId: string, card: CardDetails): Promise<ConfirmResult> {
    const o = this.orders.get(orderId);
    if (!o) return { httpStatus: 404, issue: "INVALID_RESOURCE_ID", raw: { name: "RESOURCE_NOT_FOUND" } };
    if (o.status !== "CREATED") return { httpStatus: 422, issue: "ORDER_ALREADY_CAPTURED", orderStatus: o.status, raw: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } };
    o.status = "APPROVED";
    o.cardName = card.name;
    this.emit("CHECKOUT.ORDER.APPROVED", this.orderJson(o));
    return { httpStatus: 200, orderStatus: "APPROVED", merchantId: "MOCKMERCHANT1234", raw: this.orderJson(o) };
  }
  capture(orderId: string, mockIssue?: string): ToolOutcome {
    const o = this.orders.get(orderId);
    if (!o) return err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
    if (o.status === "COMPLETED") return err(422, "ORDER_ALREADY_CAPTURED", "Order already captured. If 'intent=CAPTURE' only one capture per order is allowed.");
    if (o.status !== "APPROVED") return err(422, "ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.");
    if (mockIssue) return err(422, mockIssue, mockIssue === "INSTRUMENT_DECLINED" ? "The instrument presented was either declined by the processor or bank, or it can't be used for this payment." : "The request was refused.");
    const declined = isDeclineName(o.cardName ?? "");
    const c: MockCapture = {
      id: id17(this.rng),
      orderId,
      status: declined ? "DECLINED" : "COMPLETED",
      amount: o.amount,
      refunded: 0,
      processor_response: declined ? { avs_code: "Y", cvv_code: "M", response_code: "5100" } : { avs_code: "Y", cvv_code: "M", response_code: "0000" },
      create_time: new Date().toISOString(),
    };
    this.captures.set(c.id, c);
    o.captureId = c.id;
    o.status = "COMPLETED";
    this.emit(declined ? "PAYMENT.CAPTURE.DENIED" : "PAYMENT.CAPTURE.COMPLETED", { ...this.captureJson(c), supplementary_data: { related_ids: { order_id: orderId } } });
    return ok({ status: "success", response: this.orderJson(o) }).data ? ok(this.orderJson(o), 201) : ok(this.orderJson(o), 201);
  }

  // ---- refunds ---------------------------------------------------------------------------------
  refund(captureId: string, amount?: Money) {
    const c = this.captures.get(captureId);
    if (!c) return err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
    if (c.status === "DECLINED") return err(422, "TRANSACTION_REFUSED", "Cannot refund a declined capture.");
    const total = Number(c.amount.value);
    const remaining = total - c.refunded;
    if (remaining <= 0.001) return err(422, "CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.");
    const v = amount ? Number(amount.value) : remaining;
    if (v > remaining + 0.001) return err(422, "REFUND_AMOUNT_EXCEEDED", "The refund amount must be less than or equal to the capture amount that has not yet been refunded.");
    c.refunded += v;
    c.status = c.refunded >= total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const r = { id: id17(this.rng), captureId, status: "COMPLETED", amount: money(v, c.amount.currency_code), create_time: new Date().toISOString() };
    this.refunds.set(r.id, r);
    this.emit("PAYMENT.CAPTURE.REFUNDED", { id: r.id, status: r.status, amount: r.amount, links: [{ rel: "up", href: `/v2/payments/captures/${captureId}` }] });
    return ok({ id: r.id, status: r.status, amount: r.amount, create_time: r.create_time }, 201);
  }

  // ---- disputes --------------------------------------------------------------------------------
  openDispute(captureId: string, amount: number, reasonCode = "1330") {
    const c = this.captures.get(captureId);
    if (!c) return undefined;
    const reason = reasonCode === "1310" ? "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" : reasonCode === "1320" ? "UNAUTHORISED" : "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
    const d: MockDispute = {
      dispute_id: `PP-D-${Math.floor(10_000_000 + this.rng() * 89_999_999)}`,
      captureId,
      reason,
      status: "WAITING_FOR_SELLER_RESPONSE",
      dispute_amount: money(amount, c.amount.currency_code),
      dispute_life_cycle_stage: "CHARGEBACK",
      create_time: new Date().toISOString(),
      seller_response_due_date: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    };
    this.disputes.set(d.dispute_id, d);
    this.emit("CUSTOMER.DISPUTE.CREATED", this.disputeJson(d));
    return d;
  }
  disputeJson(d: MockDispute) {
    return {
      dispute_id: d.dispute_id,
      reason: d.reason,
      status: d.status,
      dispute_amount: d.dispute_amount,
      dispute_life_cycle_stage: d.dispute_life_cycle_stage,
      create_time: d.create_time,
      seller_response_due_date: d.seller_response_due_date,
      dispute_outcome: d.dispute_outcome,
      disputed_transactions: [{ seller_transaction_id: d.captureId, gross_amount: d.dispute_amount }],
      links: [{ rel: "self", href: `/v1/customer/disputes/${d.dispute_id}` }, ...(d.status !== "RESOLVED" ? [{ rel: "adjudicate" }, { rel: "accept_claim" }] : [])],
    };
  }
  adjudicate(id: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR"): ToolOutcome {
    const d = this.disputes.get(id);
    if (!d) return err(404, "RESOURCE_NOT_FOUND", "Dispute not found");
    d.status = "RESOLVED";
    d.dispute_outcome = { outcome_code: outcome === "BUYER_FAVOR" ? "RESOLVED_BUYER_FAVOUR" : "RESOLVED_SELLER_FAVOUR" };
    this.emit("CUSTOMER.DISPUTE.RESOLVED", this.disputeJson(d));
    return ok({ links: [{ rel: "self", href: `/v1/customer/disputes/${id}` }] });
  }
  acceptClaim(id: string, _note: string): ToolOutcome {
    const d = this.disputes.get(id);
    if (!d) return err(404, "RESOURCE_NOT_FOUND", "Dispute not found");
    if (d.status === "RESOLVED") return err(422, "INVALID_REQUEST", "Dispute already resolved");
    d.status = "RESOLVED";
    d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR" };
    this.refund(d.captureId, d.dispute_amount);
    this.emit("CUSTOMER.DISPUTE.RESOLVED", this.disputeJson(d));
    return ok({ links: [{ rel: "self", href: `/v1/customer/disputes/${id}` }] });
  }

  // ---- toolkit-shaped tools --------------------------------------------------------------------
  tools(actions: Actions): SwarmTool[] {
    const impl: Record<string, (a: Record<string, unknown>) => ToolOutcome> = {
      create_product: (a) => ok(this.createProduct({ name: String(a.name), description: a.description as string | undefined, type: a.type as string | undefined }), 201),
      list_products: (a) => ok(this.listProducts(Number(a.page ?? 1), Number(a.page_size ?? 2))),
      show_product_details: (a) => {
        const p = this.products.get(String(a.product_id));
        return p ? ok(p) : err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
      },
      update_product: (a) => {
        const p = this.products.get(String(a.product_id));
        if (!p) return err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
        for (const op of (a.operations as Array<{ op: string; path: string; value: unknown }>) ?? []) {
          if (op.path === "/description") p.description = String(op.value);
          if (op.path === "/name") p.name = String(op.value);
        }
        return ok(p, 204);
      },
      create_order: (a) => {
        const items = ((a.items as Array<Record<string, unknown>>) ?? []).map((i) => ({ name: String(i.name), quantity: Number(i.quantity ?? 1), unit_amount: money(Number(i.itemCost ?? 0)), sku: i.sku as string | undefined }));
        const total = items.reduce((s, i) => s + Number(i.unit_amount.value) * i.quantity, 0) + Number(a.shippingCost ?? 0) - Number(a.discount ?? 0);
        return ok(this.createOrder({ amount: total, items }), 201);
      },
      get_order: (a) => {
        const o = this.orders.get(String(a.id));
        return o ? ok(this.orderJson(o)) : err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
      },
      pay_order: (a) => this.capture(String(a.id)),
      create_refund: (a) => this.refund(String(a.capture_id), a.amount as Money | undefined),
      get_refund: (a) => {
        const r = this.refunds.get(String(a.refund_id));
        return r ? ok(r) : err(404, "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
      },
      create_shipment_tracking: (a) => {
        const tx = String(a.transaction_id);
        if (!this.captures.has(tx)) return err(404, "INVALID_RESOURCE_ID", "transaction_id does not match a capture.");
        const t = { transaction_id: tx, tracking_number: String(a.tracking_number), status: String(a.status ?? "SHIPPED"), carrier: a.carrier as string | undefined };
        this.trackers.set(tx, t);
        return ok({ trackers: [t] }, 201);
      },
      get_shipment_tracking: (a) => {
        const t = this.trackers.get(String(a.transaction_id));
        return t ? ok({ trackers: [t] }) : err(404, "RESOURCE_NOT_FOUND", "No tracker for transaction.");
      },
      update_shipment_tracking: (a) => {
        const t = this.trackers.get(String(a.transaction_id));
        if (!t) return err(404, "RESOURCE_NOT_FOUND", "No tracker for transaction.");
        if (a.status) t.status = String(a.status);
        if (a.new_tracking_number) t.tracking_number = String(a.new_tracking_number);
        return ok({ trackers: [t] });
      },
      list_disputes: (a) => {
        let items = [...this.disputes.values()];
        if (a.disputed_transaction_id) items = items.filter((d) => d.captureId === a.disputed_transaction_id);
        return ok({ items: items.map((d) => this.disputeJson(d)), total_items: items.length });
      },
      get_dispute: (a) => {
        const d = this.disputes.get(String(a.dispute_id));
        return d ? ok(this.disputeJson(d)) : err(404, "RESOURCE_NOT_FOUND", "Dispute not found");
      },
      accept_dispute_claim: (a) => this.acceptClaim(String(a.dispute_id), String(a.note ?? "")),
      list_transactions: () =>
        ok({
          transaction_details: [...this.captures.values()].map((c) => ({ transaction_info: { transaction_id: c.id, transaction_status: c.status === "COMPLETED" ? "S" : c.status === "DECLINED" ? "D" : "V", transaction_amount: c.amount, transaction_initiation_date: c.create_time } })),
          total_items: this.captures.size,
        }),
    };
    const allowed = new Set(toolNames(actions));
    return Object.entries(impl)
      .filter(([name]) => allowed.has(name))
      .map(([name, fn]) => ({
        name,
        description: this.schemaToolkit[name]?.description ?? name,
        inputSchema: this.schemaToolkit[name]!.parameters,
        run: (input) => this.guard(() => fn((input ?? {}) as Record<string, unknown>)),
      }));
  }
}

const ALL_ACTIONS: Actions = {
  products: { create: true, list: true, show: true, update: true },
  orders: { create: true, get: true, capture: true },
  payments: { createRefund: true, getRefunds: true },
  shipment: { create: true, get: true, update: true },
  disputes: { list: true, get: true, create: true },
  transactions: { list: true },
};
const NAME_MAP: Record<string, Record<string, string>> = {
  products: { create: "create_product", list: "list_products", show: "show_product_details", update: "update_product" },
  orders: { create: "create_order", get: "get_order", capture: "pay_order" },
  payments: { createRefund: "create_refund", getRefunds: "get_refund" },
  shipment: { create: "create_shipment_tracking", get: "get_shipment_tracking", update: "update_shipment_tracking" },
  disputes: { list: "list_disputes", get: "get_dispute", create: "accept_dispute_claim" },
  transactions: { list: "list_transactions" },
};
function toolNames(actions: Actions): string[] {
  const out: string[] = [];
  for (const [res, acts] of Object.entries(actions)) for (const [act, on] of Object.entries(acts)) if (on && NAME_MAP[res]?.[act]) out.push(NAME_MAP[res]![act]!);
  return out;
}
