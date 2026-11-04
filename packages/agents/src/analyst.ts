import type { World } from "./world";

const MAX_INSIGHTS = 8;

/**
 * Server-side analyst. Runs on a timer over code-computed aggregates (never the raw event stream) and
 * emits analyst.insight events that the Arena shows as chips and the Studio can turn into widgets.
 * Zero LLM calls here; the LLM-driven analyst lives in the AG Studio adapter.
 */
export async function runAnalyst(world: World): Promise<void> {
  let emitted = 0;
  const seen = new Set<string>();
  const say = async (key: string, title: string, prompt: string, metrics: Record<string, unknown>) => {
    if (seen.has(key) || emitted >= MAX_INSIGHTS) return;
    seen.add(key);
    emitted++;
    await world.emit("analyst.insight", "analyst", "analyst", { key, title, prompt, metrics });
  };

  while (!world.o.control.stopped) {
    await world.sleep(world.o.pacing.analystIntervalMs);
    if (world.o.control.stopped) break;
    const orders = [...world.orders.values()];
    const captured = orders.filter((o) => o.status === "captured" || o.status === "refunded" || o.status === "disputed");
    const declined = orders.filter((o) => o.status === "declined");
    const unshipped = captured.filter((o) => !o.shipped);
    const refunds = world.count("order.refunded");
    const disputes = world.count("dispute.opened");
    const errors = world.count("paypal.error");
    const lat = world.captureLatenciesSim;

    if (declined.length >= 2) await say("declines", `${declined.length} declined captures`, `Add a bar chart of captures by status (COMPLETED vs DECLINED) per customer and highlight declined orders that were never followed up.`, { declined: declined.length, captured: captured.length });
    if (lat.length >= 3) {
      const sorted = [...lat].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length / 2)]!;
      const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      if (p95 > 30) await say("capture-latency", `Capture latency p95 ${p95} sim minutes`, `Plot approve→capture latency per order as a histogram and mark the p50 (${p50}) and p95 (${p95}) lines.`, { p50, p95, n: lat.length });
    }
    if (unshipped.length >= 3 && unshipped.length / Math.max(1, captured.length) > 0.5) await say("unshipped", `${unshipped.length} paid orders without tracking`, `Build a table of captured orders with capture time and shipped time, sorted by how long they have waited without tracking.`, { unshipped: unshipped.length, captured: captured.length });
    if (refunds >= 2 && refunds / Math.max(1, captured.length) > 0.2) await say("refund-spike", `Refund rate ${Math.round((refunds / Math.max(1, captured.length)) * 100)}%`, `Create an alert tile for refund rate and a timeline of refund events against captures.`, { refunds, captured: captured.length });
    if (disputes >= 1) await say("disputes", `${disputes} dispute(s) opened`, `Add a dispute board: dispute id, reason, amount, time open, seller response status.`, { disputes });
    if (errors >= 3) await say("paypal-errors", `${errors} PayPal API errors`, `Chart PayPal errors by issue code (ORDER_ALREADY_CAPTURED, REFUND_AMOUNT_EXCEEDED, ...) and by agent.`, { errors });
    if (world.count("infra.rate_limit") >= 2) await say("rate-limits", `${world.count("infra.rate_limit")} rate-limit retries`, `Overlay PayPal 429s on the request-rate timeline; these are excluded from the readiness score.`, { rateLimits: world.count("infra.rate_limit") });
  }
}
