/**
 * The event log is Swarm's source of truth. Every agent turn, tool call, PayPal response,
 * webhook, approval and chaos injection becomes one row; the Arena streams them, the
 * Report is a pure function over them, and replay re-streams them from the database.
 */
export const EVENT_TYPES = [
  "run.started",
  "run.paused",
  "run.resumed",
  "run.finished",
  "run.settling",
  "agent.turn",
  "tool.call",
  "tool.result",
  "paypal.error",
  "message.sent",
  "order.created",
  "order.approved",
  "order.captured",
  "order.capture_declined",
  "order.shipped",
  "order.refunded",
  "order.disputed",
  "dispute.opened",
  "dispute.resolved",
  "webhook.received",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "chaos.injected",
  "analyst.insight",
  "infra.rate_limit",
  "budget.warning",
  "budget.exhausted",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ACTOR_CLASSES = ["shopper", "merchant", "chaos", "analyst", "platform", "paypal", "human"] as const;
export type ActorClass = (typeof ACTOR_CLASSES)[number];

export interface SwarmEvent {
  /** Database id; absent until persisted. */
  id?: number;
  runId: string;
  /** Wall-clock ISO timestamp. */
  t: string;
  /** Simulated minutes since run start (1 real minute = 60 sim minutes by default). */
  simT: number;
  actor: string;
  actorClass: ActorClass;
  type: EventType;
  payload: Record<string, unknown>;
  /** PayPal ids (order, capture, refund, dispute, tracking) mentioned by this event, for cross-referencing webhooks and findings. */
  paypalIds: string[];
}

export type NewEvent = Omit<SwarmEvent, "id" | "t" | "paypalIds" | "simT"> & {
  t?: string;
  simT?: number;
  paypalIds?: string[];
};

/** Orders, captures, refunds and authorizations share a 17-char uppercase alphanumeric shape. */
const PAYPAL_ID_RE = /\b(?:[A-Z0-9]{17}|PP-[A-Z]-\d{6,}|PROD-[A-Z0-9]{10,}|WH-[A-Z0-9-]{10,})\b/g;

/** Collects PayPal-looking ids anywhere inside an object. Cheap and deliberately permissive. */
export function extractPayPalIds(value: unknown, acc: Set<string> = new Set()): string[] {
  if (typeof value === "string") {
    for (const m of value.match(PAYPAL_ID_RE) ?? []) acc.add(m);
  } else if (Array.isArray(value)) {
    for (const v of value) extractPayPalIds(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) extractPayPalIds(v, acc);
  }
  return [...acc];
}

/** Severity scale shared by findings and the Arena feed. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";
