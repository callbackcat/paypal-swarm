import type { ZodTypeAny } from "zod";

export interface PayPalCreds {
  clientId: string;
  clientSecret: string;
  /** Business sandbox account merchant id; needed only for process-chargeback. Learned from the first order payee when absent. */
  merchantId?: string;
}

/** Mirrors the toolkit's `configuration.actions` shape: resource -> action -> enabled. */
export type Actions = Record<string, Record<string, boolean>>;

/** Normalised outcome of any PayPal call, toolkit or REST. `data` is the raw (already redaction-safe) response. */
export interface ToolOutcome {
  ok: boolean;
  /** HTTP status when known. */
  status?: number;
  /** PayPal `details[].issue` or error name, e.g. ORDER_ALREADY_CAPTURED, INSTRUMENT_DECLINED, RATE_LIMIT_REACHED. */
  issue?: string;
  message?: string;
  data: unknown;
}

/** A PayPal capability exposed to an agent. Same shape for the real toolkit and the mock. */
export interface SwarmTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  run(input: unknown): Promise<ToolOutcome>;
}

export interface CardDetails {
  number: string;
  expiry: string; // YYYY-MM
  securityCode: string;
  name: string;
  brand: "VISA" | "MASTERCARD" | "AMEX";
}

export interface ConfirmResult {
  httpStatus: number;
  /** Order status after confirm: APPROVED (expected), COMPLETED (captured at confirm), PAYER_ACTION_REQUIRED, ... */
  orderStatus?: string;
  issue?: string;
  merchantId?: string;
  raw: unknown;
}

export interface CaptureSummary {
  captureId?: string;
  captureStatus?: string; // COMPLETED | DECLINED | PENDING
  amount?: { currency_code: string; value: string };
  processorResponse?: Record<string, unknown>;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  create_time: string;
  resource_type?: string;
  resource: Record<string, unknown>;
}

export interface PayPalBackend {
  readonly mode: "mock" | "sandbox";
  /** Tools filtered by an allow-list. Names and schemas are identical in mock and sandbox. */
  tools(actions: Actions): SwarmTool[];
  /** Path B order creation (no payment_source) so a card can be confirmed later. */
  createOrderWithoutSource(input: { amount: string; currency?: string; description?: string; referenceId?: string }): Promise<ToolOutcome>;
  /** Buyer approval without a browser: confirm-payment-source with a sandbox card. */
  confirmWithCard(orderId: string, card: CardDetails): Promise<ConfirmResult>;
  /** Orders v2 tracking (POST /v2/checkout/orders/{id}/track). The fallback when the REST app lacks the v1 trackers permission. */
  addTracking(input: { orderId: string; captureId: string; trackingNumber: string; carrier?: string; status?: string }): Promise<ToolOutcome>;
  /** Hardened merchant capture: idempotent request id, optional forced decline. */
  captureOrder(orderId: string, opts?: { requestId?: string; mockIssue?: "INSTRUMENT_DECLINED" | "TRANSACTION_REFUSED" }): Promise<ToolOutcome>;
  processChargeback(input: { captureId: string; amount: string; currency?: string; merchantId?: string; reasonCode?: string }): Promise<{ httpStatus: number; disputeId?: string; raw: unknown }>;
  adjudicate(disputeId: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR"): Promise<ToolOutcome>;
  acceptClaim(disputeId: string, note: string): Promise<ToolOutcome>;
  verifyWebhook(input: { headers: Record<string, string | undefined>; rawBody: string; webhookId: string }): Promise<boolean>;
  /** Mock only: subscribe to synthetic webhooks. Sandbox delivers real ones to /webhooks/paypal. */
  onWebhook?(handler: (evt: WebhookEvent) => void): () => void;
}

export function summariseCapture(orderOrCapture: unknown): CaptureSummary {
  const o = orderOrCapture as Record<string, unknown> | undefined;
  if (!o) return {};
  type PU = Array<{ payments?: { captures?: Array<Record<string, unknown>> } }> | undefined;
  const units = (o.purchase_units ?? o.purchaseUnits) as PU;
  const captures = units?.[0]?.payments?.captures ?? (o.captures as Array<Record<string, unknown>> | undefined);
  const cap = captures?.[0] ?? (typeof o.status === "string" && typeof o.id === "string" && !units ? o : undefined);
  if (!cap) return {};
  return {
    captureId: cap.id as string | undefined,
    captureStatus: cap.status as string | undefined,
    amount: cap.amount as CaptureSummary["amount"],
    processorResponse: (cap.processor_response ?? cap.processorResponse) as Record<string, unknown> | undefined,
  };
}
