import type { Bus } from "./bus";
import type { RunManager } from "./runs";
import type { Store } from "./store";

export interface WebhookInput {
  body: Record<string, unknown>;
  verified: boolean;
  source: "http" | "mock";
  /** Known for mock deliveries; discovered by resource id for real ones. */
  runId?: string;
}

/**
 * Stores every webhook, matches it to the event that caused it (capture/refund/dispute id, or the order id
 * in supplementary_data), and emits webhook.received with the lag. Always resolves; PayPal must get a 200.
 */
export async function handleWebhook(deps: { store: Store; bus: Bus; manager: RunManager }, input: WebhookInput) {
  const body = input.body;
  const eventType = String(body.event_type ?? "UNKNOWN");
  const resource = (body.resource ?? {}) as Record<string, unknown>;
  const resourceId = typeof resource.id === "string" ? resource.id : undefined;
  const orderId = (resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id ?? (typeof resource.dispute_id === "string" ? undefined : undefined);
  const disputeId = typeof resource.dispute_id === "string" ? resource.dispute_id : undefined;
  const upLink = (resource.links as Array<{ rel?: string; href?: string }> | undefined)?.find((l) => l.rel === "up")?.href?.match(/[A-Z0-9]{17}/)?.[0];
  const ids = [resourceId, orderId, disputeId, upLink].filter((x): x is string => !!x);

  const matched = await deps.store.findEventByPayPalIds(ids);
  const runId = input.runId ?? matched?.runId;
  const lagMs = matched ? Math.max(0, Date.now() - new Date(matched.t).getTime()) : null;
  const row = await deps.store.insertWebhook({ runId: runId ?? null, eventType, resourceId: resourceId ?? disputeId ?? null, receivedAt: new Date().toISOString(), raw: body, matchedEventId: matched?.id ?? null, lagMs, verified: input.verified });
  const ev = await deps.manager.recordWebhookEvent(runId, { eventType, resourceId: resourceId ?? disputeId, orderId, matchedEventId: matched?.id ?? null, matchedType: matched?.type, lagMs, verified: input.verified, source: input.source, webhookId: body.id }, ids);
  return { stored: row.id, runId, matchedEventId: matched?.id ?? null, lagMs, eventId: ev?.id ?? null };
}
