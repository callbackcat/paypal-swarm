import { amountOf, type SwarmEvent } from "./api";

export interface OrderRow {
  orderId: string;
  personaId: string;
  personaName: string;
  amount: number;
  status: "created" | "approved" | "captured" | "declined" | "shipped" | "refunded" | "disputed";
  captureId?: string;
  trackingNumber?: string;
  refunded: number;
  disputeIds: string[];
  createdSimT: number;
  approvedSimT?: number;
  capturedSimT?: number;
  shippedSimT?: number;
  declineReason?: string;
  errors: number;
  lastEventId: number;
}
export interface WebhookTick {
  id: number;
  simT: number;
  eventType: string;
  lagMs: number | null;
  matchedType?: string;
  verified: boolean;
}
export interface ApprovalView {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: "pending" | "granted" | "denied" | "timeout";
  simT: number;
}
export interface ArenaState {
  started?: Record<string, unknown>;
  finished?: Record<string, unknown>;
  paused: boolean;
  orders: Map<string, OrderRow>;
  feed: SwarmEvent[];
  webhooks: WebhookTick[];
  approvals: Map<string, ApprovalView>;
  chaos: Array<{ id: number; simT: number; kind: string; payload: Record<string, unknown> }>;
  insights: Array<{ id: number; key: string; title: string; prompt: string; metrics?: Record<string, unknown> }>;
  budget: { tokensIn: number; tokensOut: number; costUsd: number; cached: number; warnings: number; exhausted: string[] };
  counts: { turns: number; toolCalls: number; errors: number; rateLimits: number; messages: number; disputes: number; refunds: number };
  simT: number;
  lastId: number;
  total: number;
}

export const emptyArena = (): ArenaState => ({
  paused: false,
  orders: new Map(),
  feed: [],
  webhooks: [],
  approvals: new Map(),
  chaos: [],
  insights: [],
  budget: { tokensIn: 0, tokensOut: 0, costUsd: 0, cached: 0, warnings: 0, exhausted: [] },
  counts: { turns: 0, toolCalls: 0, errors: 0, rateLimits: 0, messages: 0, disputes: 0, refunds: 0 },
  simT: 0,
  lastId: 0,
  total: 0,
});

const FEED_CAP = 600;
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** Mutates maps in place and returns a new top-level object so React re-renders. */
export function applyEvent(state: ArenaState, e: SwarmEvent): ArenaState {
  const p = e.payload ?? {};
  const id = e.id ?? state.lastId + 1;
  const s: ArenaState = { ...state, lastId: Math.max(state.lastId, id), simT: Math.max(state.simT, e.simT), total: state.total + 1 };
  s.feed = state.feed.length >= FEED_CAP ? [...state.feed.slice(state.feed.length - FEED_CAP + 1), e] : [...state.feed, e];
  const order = (oid: unknown) => (typeof oid === "string" ? s.orders.get(oid) : undefined);
  switch (e.type) {
    case "run.started":
      s.started = p;
      break;
    case "run.finished":
      s.finished = p;
      break;
    case "run.paused":
      s.paused = true;
      break;
    case "run.resumed":
      s.paused = false;
      break;
    case "order.created": {
      const oid = str(p.orderId);
      if (oid) s.orders.set(oid, { orderId: oid, personaId: str(p.personaId) || e.actor, personaName: str(p.personaName) || e.actor, amount: amountOf(p.amount), status: "created", refunded: 0, disputeIds: [], createdSimT: e.simT, errors: 0, lastEventId: id });
      break;
    }
    case "order.approved": {
      const o = order(p.orderId);
      if (o) Object.assign(o, { status: o.status === "created" ? "approved" : o.status, approvedSimT: o.approvedSimT ?? e.simT, lastEventId: id });
      break;
    }
    case "order.captured": {
      const o = order(p.orderId);
      if (o) Object.assign(o, { status: "captured", captureId: str(p.captureId) || o.captureId, capturedSimT: e.simT, lastEventId: id });
      break;
    }
    case "order.capture_declined": {
      const o = order(p.orderId);
      if (o) Object.assign(o, { status: "declined", declineReason: str((p.processorResponse as { response_code?: string } | undefined)?.response_code ?? p.captureStatus ?? "DECLINED"), lastEventId: id });
      break;
    }
    case "order.shipped": {
      const o = order(p.orderId);
      if (o) Object.assign(o, { status: o.status === "refunded" || o.status === "disputed" ? o.status : "shipped", trackingNumber: str(p.trackingNumber), shippedSimT: e.simT, lastEventId: id });
      break;
    }
    case "order.refunded": {
      const o = order(p.orderId);
      s.counts = { ...s.counts, refunds: s.counts.refunds + 1 };
      if (o) Object.assign(o, { refunded: o.refunded + amountOf(p.amount), status: "refunded", lastEventId: id });
      break;
    }
    case "order.disputed":
    case "dispute.opened": {
      const o = order(p.orderId);
      if (e.type === "dispute.opened") s.counts = { ...s.counts, disputes: s.counts.disputes + 1 };
      if (o && typeof p.disputeId === "string" && !o.disputeIds.includes(p.disputeId)) {
        o.disputeIds.push(p.disputeId);
        o.status = "disputed";
        o.lastEventId = id;
      }
      break;
    }
    case "webhook.received":
      s.webhooks = [...state.webhooks.slice(-199), { id, simT: e.simT, eventType: str(p.eventType), lagMs: typeof p.lagMs === "number" ? p.lagMs : null, matchedType: typeof p.matchedType === "string" ? p.matchedType : undefined, verified: !!p.verified }];
      break;
    case "approval.requested": {
      const aid = str(p.approvalId);
      if (aid) s.approvals.set(aid, { id: aid, kind: str(p.kind), payload: p, status: "pending", simT: e.simT });
      break;
    }
    case "approval.granted":
    case "approval.denied": {
      const aid = str(p.approvalId);
      const a = s.approvals.get(aid);
      if (a) a.status = e.type === "approval.granted" ? "granted" : str(p.decision) === "timeout" ? "timeout" : "denied";
      break;
    }
    case "chaos.injected":
      s.chaos = [...state.chaos, { id, simT: e.simT, kind: str(p.kind), payload: p }];
      break;
    case "analyst.insight":
      s.insights = [...state.insights.filter((i) => i.key !== p.key), { id, key: str(p.key), title: str(p.title), prompt: str(p.prompt), metrics: p.metrics as Record<string, unknown> | undefined }];
      break;
    case "agent.turn": {
      const u = (p.usage ?? {}) as { inputTokens?: number; outputTokens?: number; cachedTokens?: number };
      s.budget = { ...state.budget, tokensIn: state.budget.tokensIn + (u.inputTokens ?? 0), tokensOut: state.budget.tokensOut + (u.outputTokens ?? 0), cached: state.budget.cached + (u.cachedTokens ?? 0), costUsd: state.budget.costUsd + (typeof p.costUsd === "number" ? p.costUsd : 0) };
      s.counts = { ...s.counts, turns: s.counts.turns + 1 };
      break;
    }
    case "tool.call":
      s.counts = { ...s.counts, toolCalls: s.counts.toolCalls + 1 };
      break;
    case "paypal.error": {
      s.counts = { ...s.counts, errors: s.counts.errors + 1 };
      const oid = (p.input as { id?: string; order_id?: string } | undefined)?.id ?? (p.input as { order_id?: string } | undefined)?.order_id;
      const o = order(oid);
      if (o) o.errors++;
      break;
    }
    case "infra.rate_limit":
      s.counts = { ...s.counts, rateLimits: s.counts.rateLimits + 1 };
      break;
    case "message.sent":
      s.counts = { ...s.counts, messages: s.counts.messages + 1 };
      break;
    case "budget.warning":
      s.budget = { ...state.budget, warnings: state.budget.warnings + 1 };
      break;
    case "budget.exhausted":
      s.budget = { ...state.budget, exhausted: [...state.budget.exhausted, str(p.actor)] };
      break;
    default:
      break;
  }
  return s;
}

export function reduceAll(events: SwarmEvent[], base: ArenaState = emptyArena()): ArenaState {
  return events.reduce(applyEvent, base);
}

const short = (id: unknown) => (typeof id === "string" && id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : str(id));
const money = (v: unknown) => `$${amountOf(v).toFixed(2)}`;

/** One human line per event for the feed, the report trails and the Studio events table. */
export function summarize(e: SwarmEvent): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "run.started":
      return `Run started · ${str(p.shoppers)} shoppers · ${str(p.merchantProfile)} merchant · PayPal ${str(p.paypalMode)} · LLM ${str(p.llmMode)}`;
    case "run.finished":
      return `Run finished (${str(p.reason)}) · ${str(p.orders)} orders · ${str(p.tokens)} tokens`;
    case "run.paused":
      return "Paused by operator";
    case "run.resumed":
      return "Resumed";
    case "agent.turn":
      return `${str(p.model)}${p.scripted ? "" : ` · ${(p.usage as { inputTokens?: number })?.inputTokens ?? 0}→${(p.usage as { outputTokens?: number })?.outputTokens ?? 0} tok`}${Array.isArray(p.toolCalls) && p.toolCalls.length ? ` · ${(p.toolCalls as string[]).join(", ")}` : ""}${p.text ? ` · "${str(p.text).slice(0, 110)}"` : ""}`;
    case "tool.call":
      return `→ ${str(p.tool)}`;
    case "tool.result":
      return `← ${str(p.tool)} ${p.ok ? "ok" : `FAILED ${str(p.status)} ${str(p.issue)}`} · ${str(p.durationMs)} ms`;
    case "paypal.error":
      return `PayPal ${str(p.status)} ${str(p.issue)} on ${str(p.tool)}: ${str(p.message).slice(0, 140)}`;
    case "message.sent":
      return `${str(p.fromName ?? p.from)} → ${str(p.toName ?? p.to)}: "${str(p.text).slice(0, 140)}"`;
    case "order.created":
      return `${str(p.personaName)} created order ${short(p.orderId)} for ${money(p.amount)}`;
    case "order.approved":
      return `${str(p.personaName)} approved ${short(p.orderId)} with ${str(p.cardBrand)}${p.declineScheduled ? " (decline scheduled)" : ""}`;
    case "order.captured":
      return `Captured ${short(p.orderId)} → ${short(p.captureId)} ${money(p.amount)}`;
    case "order.capture_declined":
      return `Capture DECLINED on ${short(p.orderId)} (${str((p.processorResponse as { response_code?: string } | undefined)?.response_code ?? p.captureStatus)})`;
    case "order.shipped":
      return `Shipped ${short(p.orderId)} · ${str(p.carrier)} ${str(p.trackingNumber)}`;
    case "order.refunded":
      return `Refunded ${money(p.amount)} on ${short(p.orderId)} → ${short(p.refundId)}`;
    case "order.disputed":
      return `Order ${short(p.orderId)} disputed (${short(p.disputeId)})`;
    case "dispute.opened":
      return `Chargeback ${short(p.disputeId)} · ${str(p.reason)} · ${money(p.amount)}`;
    case "dispute.resolved":
      return `Dispute ${short(p.disputeId)} resolved · ${str(p.outcome)}`;
    case "webhook.received":
      return `${str(p.eventType)} · lag ${typeof p.lagMs === "number" ? `${p.lagMs} ms` : "n/a"}${p.verified ? " · verified" : ""}`;
    case "approval.requested":
      return `Approval needed: ${str(p.kind)}${p.amount ? ` ${money(p.amount)}` : ""}${p.reason ? ` · ${str(p.reason)}` : ""}`;
    case "approval.granted":
      return `Approval granted (${str(p.kind)})`;
    case "approval.denied":
      return `Approval ${str(p.decision) === "timeout" ? "timed out" : "denied"} (${str(p.kind)})`;
    case "chaos.injected":
      return `Chaos: ${str(p.kind)}${p.description ? ` · ${str(p.description)}` : ""}`;
    case "analyst.insight":
      return `Insight: ${str(p.title)}`;
    case "infra.rate_limit":
      return `429 on ${str(p.tool)} · retry ${str(p.attempt)} in ${str(p.backoffMs)} ms`;
    case "budget.warning":
      return `Budget at ${Math.round(Number(p.fraction ?? 0) * 100)}% · ${str(p.action)}`;
    case "budget.exhausted":
      return `Budget exhausted for ${str(p.actor)} · ${str(p.action)}`;
    default:
      return JSON.stringify(p).slice(0, 160);
  }
}

export const ACTOR_COLORS: Record<string, string> = {
  shopper: "var(--info)",
  merchant: "var(--accent)",
  chaos: "var(--bad)",
  analyst: "#c084fc",
  platform: "var(--muted)",
  paypal: "var(--accent-2)",
  human: "var(--ok)",
};

export const ORDER_STATUS_CLASS: Record<OrderRow["status"], string> = {
  created: "chip-muted",
  approved: "chip-info",
  captured: "chip-ok",
  shipped: "chip-ok",
  declined: "chip-bad",
  refunded: "chip-warn",
  disputed: "chip-bad",
};
