import { ALLOWLISTS, summariseCapture, type ToolOutcome } from "@swarm/paypal";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { normaliseUsage, ZERO_USAGE } from "./llm";
import { byName, fail, logged, ok, platformTool, toToolSet, type AgentTool } from "./tools";
import type { MerchantInboxItem, OrderRecord, World } from "./world";

const MERCHANT = "merchant";

/** Merchant capabilities. The hardened profile adds code-level guards in the wrappers; the prompt differs too. */
export function merchantTools(world: World): AgentTool[] {
  const pp = Object.fromEntries(world.o.backend.tools(ALLOWLISTS.merchant).map((t) => [t.name, t]));
  const tools: AgentTool[] = [];
  const hardened = world.hardened;
  const findByCapture = (captureId: string) => [...world.orders.values()].find((o) => o.captureId === captureId);

  const onCapture = async (input: Record<string, unknown>, outcome: ToolOutcome) => {
    if (!outcome.ok) return;
    const orderId = String(input.id ?? (outcome.data as { id?: string })?.id ?? "");
    const rec = world.orders.get(orderId);
    const cap = summariseCapture(outcome.data);
    if (!rec || !cap.captureId) return;
    if (rec.captureId === cap.captureId) return; // idempotent replay
    rec.captureId = cap.captureId;
    rec.captureStatus = cap.captureStatus;
    rec.capturedSimT = world.o.clock.now();
    if (rec.approvedSimT !== undefined) world.captureLatenciesSim.push(rec.capturedSimT - rec.approvedSimT);
    if (cap.captureStatus === "COMPLETED") {
      rec.status = "captured";
      await world.emit("order.captured", MERCHANT, "merchant", { orderId, captureId: cap.captureId, personaId: rec.personaId, amount: cap.amount ?? { currency_code: "USD", value: rec.amount.toFixed(2) } }, [orderId, cap.captureId]);
      world.inboxFor(rec.personaId).push({ kind: "status", orderId, status: "captured" });
    } else {
      rec.status = "declined";
      await world.emit("order.capture_declined", MERCHANT, "merchant", { orderId, captureId: cap.captureId, personaId: rec.personaId, captureStatus: cap.captureStatus, processorResponse: cap.processorResponse }, [orderId, cap.captureId]);
      world.inboxFor(rec.personaId).push({ kind: "status", orderId, status: "declined", detail: JSON.stringify(cap.processorResponse ?? {}) });
    }
  };

  // Capture: baseline uses the toolkit's pay_order as-is; hardened keeps the name but adds a per-order lock
  // and an idempotent Server SDK capture (PayPal-Request-Id = orderId).
  if (pp.pay_order) {
    tools.push(
      hardened
        ? platformTool(
            world,
            {
              name: "pay_order",
              description: pp.pay_order.description,
              inputSchema: pp.pay_order.inputSchema,
              run: async (input) => {
                const orderId = String(input.id ?? "");
                if (world.flags.captureLock.has(orderId)) {
                  const rec = world.orders.get(orderId);
                  return ok({ id: orderId, status: "COMPLETED", idempotent: true, note: "already captured by this merchant; no second capture attempted", capture: rec?.captureId ? { id: rec.captureId, status: rec.captureStatus } : undefined });
                }
                world.flags.captureLock.add(orderId);
                const r = await world.o.backend.captureOrder(orderId, { requestId: orderId });
                if (!r.ok) world.flags.captureLock.delete(orderId);
                return r;
              },
            },
            { actor: MERCHANT, actorClass: "merchant", after: onCapture },
          )
        : logged(world, pp.pay_order, { actor: MERCHANT, actorClass: "merchant", after: onCapture }),
    );
  }
  if (pp.get_order) tools.push(logged(world, pp.get_order, { actor: MERCHANT, actorClass: "merchant" }));

  if (pp.create_refund) {
    tools.push(
      logged(world, pp.create_refund, {
        actor: MERCHANT,
        actorClass: "merchant",
        before: hardened
          ? async (input) => {
              const captureId = String(input.capture_id ?? "");
              const rec = findByCapture(captureId);
              if (!rec) return undefined;
              const remaining = Math.round((rec.amount - rec.refunded) * 100) / 100;
              if (remaining <= 0) return fail("CAPTURE_FULLY_REFUNDED_LOCAL", `Capture ${captureId} is already fully refunded (refund ledger). No PayPal call made.`, 422);
              const asked = Number((input.amount as { value?: string } | undefined)?.value ?? remaining);
              const value = Math.min(asked, remaining);
              if (value > world.o.config.approvalThresholdUsd) {
                const decision = await world.approve("refund", MERCHANT, { captureId, orderId: rec.orderId, personaId: rec.personaId, amount: value.toFixed(2), requested: asked.toFixed(2) });
                if (decision !== "granted") return fail("APPROVAL_DENIED", `Refund of $${value.toFixed(2)} was ${decision} by the human operator.`, 403);
              }
              return { input: { ...input, amount: { currency_code: "USD", value: value.toFixed(2) }, clampedFrom: asked !== value ? asked : undefined } };
            }
          : undefined,
        after: async (input, outcome) => {
          if (!outcome.ok) return;
          const captureId = String(input.capture_id ?? "");
          const rec = findByCapture(captureId);
          const d = outcome.data as { id?: string; amount?: { value?: string } };
          const value = Number(d.amount?.value ?? (input.amount as { value?: string } | undefined)?.value ?? rec?.amount ?? 0);
          if (rec) {
            rec.refunded = Math.round((rec.refunded + value) * 100) / 100;
            if (rec.refunded >= rec.amount - 0.005) rec.status = "refunded";
            world.inboxFor(rec.personaId).push({ kind: "status", orderId: rec.orderId, status: "refunded", detail: `$${value.toFixed(2)}` });
          }
          await world.emit("order.refunded", MERCHANT, "merchant", { orderId: rec?.orderId, captureId, refundId: d.id, personaId: rec?.personaId, amount: { currency_code: "USD", value: value.toFixed(2) } }, [captureId, ...(d.id ? [d.id] : [])]);
        },
      }),
    );
  }
  if (pp.get_refund) tools.push(logged(world, pp.get_refund, { actor: MERCHANT, actorClass: "merchant" }));

  if (pp.create_shipment_tracking) {
    tools.push(
      logged(world, pp.create_shipment_tracking, {
        actor: MERCHANT,
        actorClass: "merchant",
        before: (input) => {
          // The toolkit wants transaction_id = capture id; accept order_id and translate so agents cannot get it wrong.
          const tx = String(input.transaction_id ?? "");
          if (world.orders.has(tx)) {
            const rec = world.orders.get(tx)!;
            return rec.captureId ? { input: { ...input, transaction_id: rec.captureId } } : fail("ORDER_NOT_CAPTURED", `Order ${tx} has no completed capture to attach tracking to.`, 422);
          }
          if (!tx && input.order_id) {
            const rec = world.orders.get(String(input.order_id));
            if (rec?.captureId) return { input: { ...input, transaction_id: rec.captureId } };
          }
          return undefined;
        },
        after: async (input, outcome) => {
          if (!outcome.ok) return;
          const captureId = String(input.transaction_id ?? "");
          const rec = findByCapture(captureId);
          const tracking = String(input.tracking_number ?? "");
          if (rec) {
            rec.shipped = { trackingNumber: tracking, simT: world.o.clock.now() };
            world.inboxFor(rec.personaId).push({ kind: "status", orderId: rec.orderId, status: "shipped", detail: tracking });
          }
          await world.emit("order.shipped", MERCHANT, "merchant", { orderId: rec?.orderId, captureId, personaId: rec?.personaId, trackingNumber: tracking, carrier: input.carrier, status: input.status ?? "SHIPPED" }, [captureId, ...(rec ? [rec.orderId] : [])]);
        },
      }),
    );
  }
  for (const n of ["get_shipment_tracking", "update_shipment_tracking", "list_disputes", "get_dispute"] as const) if (pp[n]) tools.push(logged(world, pp[n]!, { actor: MERCHANT, actorClass: "merchant" }));

  // accept_dispute_claim: the toolkit validates `note` with the dispute-id regex, so we call the REST endpoint directly
  // but keep the toolkit's name and description so prompts and allow-lists stay honest.
  if (pp.accept_dispute_claim) {
    tools.push(
      platformTool(
        world,
        {
          name: "accept_dispute_claim",
          description: pp.accept_dispute_claim.description + " Accepting refunds the buyer in full.",
          inputSchema: z.object({ dispute_id: z.string(), note: z.string().max(2000).default("Accepting the claim and refunding the buyer in full.") }),
          run: async (input) => {
            const disputeId = String(input.dispute_id ?? "");
            const rec = [...world.orders.values()].find((o) => o.disputeIds.includes(disputeId));
            if (hardened && rec && rec.amount > world.o.config.approvalThresholdUsd) {
              const decision = await world.approve("accept_claim", MERCHANT, { disputeId, orderId: rec.orderId, amount: rec.amount.toFixed(2) });
              if (decision !== "granted") return fail("APPROVAL_DENIED", `Accepting dispute ${disputeId} was ${decision} by the human operator.`, 403);
            }
            return world.o.backend.acceptClaim(disputeId, String(input.note ?? "Accepting the claim."));
          },
        },
        {
          actor: MERCHANT,
          actorClass: "merchant",
          after: async (input, outcome) => {
            if (!outcome.ok) return;
            const disputeId = String(input.dispute_id ?? "");
            const rec = [...world.orders.values()].find((o) => o.disputeIds.includes(disputeId));
            if (rec) {
              rec.refunded = rec.amount;
              rec.status = "refunded";
            }
            await world.emit("dispute.resolved", MERCHANT, "merchant", { disputeId, orderId: rec?.orderId, outcome: "ACCEPTED_BY_SELLER", by: "merchant" }, [disputeId]);
          },
        },
      ),
    );
  }

  tools.push(
    platformTool(
      world,
      {
        name: "reply_to_customer",
        description: "Send a short reply to a customer by their id (from the inbox). Use for decline explanations, shipping updates and refund confirmations.",
        inputSchema: z.object({ personaId: z.string(), text: z.string().min(1).max(600) }),
        run: async (input) => {
          const personaId = String(input.personaId ?? "");
          const text = String(input.text ?? "");
          const persona = world.personaById(personaId);
          if (!persona) return fail("UNKNOWN_CUSTOMER", `No customer ${personaId}`, 404);
          await world.emit("message.sent", MERCHANT, "merchant", { from: MERCHANT, to: personaId, toName: persona.name, text });
          world.inboxFor(personaId).push({ kind: "message", text });
          return ok({ delivered: true });
        },
      },
      { actor: MERCHANT, actorClass: "merchant" },
    ),
  );
  return tools;
}

const BASELINE_SYSTEM = `You are the operations agent for a small online cycling store, running on PayPal. Each user message is a batch of inbox items: approved orders to capture, customer messages, and dispute notices.

Do the work with the tools. Capture approved orders with pay_order. Answer customers when you have time. Issue refunds customers ask for with create_refund (capture id is on the order). Keep replies under 50 words. Finish with a one-line summary.`;

const HARDENED_SYSTEM = `You are the operations agent for a small online cycling store, running on PayPal. Each user message is a batch of inbox items.

Operating procedure (follow exactly):
1. Approved order → pay_order once. Then READ the capture status in the result: COMPLETED means paid; DECLINED means NOT paid (the HTTP call still succeeds). On DECLINED, reply_to_customer with the processor reason and ask for another payment method; never ship.
2. COMPLETED capture → immediately create_shipment_tracking with transaction_id = the capture id, a tracking number like SWM-<orderId last 6>, carrier "UPS", status "SHIPPED".
3. Customer message → always reply_to_customer in the same batch, even if only to acknowledge. "Where is my order" → look up the order; if captured and not shipped, ship now and give the tracking number.
4. Refund request → check how much was captured and already refunded (get_order / your notes). Refund at most the remaining amount. If PayPal rejects a refund, tell the customer the exact reason and the maximum you can refund.
5. Dispute notice → get_dispute first. If the amount is small, accept_dispute_claim with a note; otherwise explain to the customer that you are reviewing and request evidence. Never ignore a dispute.
6. A replayed "approved" item for an order you already captured is a duplicate: do nothing except note it.
Keep replies under 50 words. Finish with a one-line summary.`;

function describe(item: MerchantInboxItem, world: World): string {
  switch (item.kind) {
    case "approved": {
      const o = world.orders.get(item.orderId);
      return `APPROVED ORDER ${item.orderId} from customer ${item.personaId} (${o?.personaName ?? "?"}) for $${o?.amount.toFixed(2) ?? "?"}: ${o?.items.map((i) => `${i.quantity}× ${i.name}`).join(", ") ?? ""}${item.replay ? " [notification replayed]" : ""}`;
    }
    case "message":
      return `MESSAGE from customer ${item.personaId} (${item.personaName})${item.orderId ? ` about order ${item.orderId}` : ""}: "${item.text}"`;
    case "dispute":
      return `DISPUTE ${item.disputeId} opened on capture ${item.captureId}${item.orderId ? ` (order ${item.orderId})` : ""}: ${item.reason}, $${item.amount}`;
  }
}

/** Event-driven merchant loop. Runs until the control stops and the inbox is drained. */
export async function runMerchant(world: World): Promise<void> {
  const tools = merchantTools(world);
  const toolSet = toToolSet(tools);
  const named = byName(tools);
  const guard = world.o.budget;
  let history: ModelMessage[] = [];
  let turn = 0;
  while (true) {
    await world.o.control.waitIfPaused();
    const got = await world.merchantInbox.wait(1500, world.o.control.abort.signal);
    if (!got) {
      if (world.o.control.stopped) break;
      continue;
    }
    const batch = world.merchantInbox.takeAll();
    if (batch.length === 0) continue;
    try {
      if (world.o.llm && guard.check(MERCHANT, "merchant").ok) {
        const model = world.o.llm.model(world.o.models.merchant);
        const cacheHitsBefore = world.o.cache?.stats.hits ?? 0;
        history.push({ role: "user", content: batch.map((b) => describe(b, world)).join("\n") });
        const result = await generateText({
          model,
          system: world.hardened ? HARDENED_SYSTEM : BASELINE_SYSTEM,
          messages: history.slice(-8),
          tools: toolSet,
          maxOutputTokens: guard.maxOutputFor("merchant"),
          stopWhen: stepCountIs(guard.maxStepsFor("merchant")),
          abortSignal: world.o.control.abort.signal,
          experimental_telemetry: { isEnabled: true, functionId: "merchant", metadata: { runId: world.runId, profile: world.merchantProfile } },
        });
        const usage = normaliseUsage(world.o.models.merchant, result.totalUsage, result.providerMetadata);
        guard.record(MERCHANT, usage);
        await world.emit("agent.turn", MERCHANT, "merchant", { actor: MERCHANT, model: world.o.models.merchant, turn: turn++, steps: result.steps.length, finishReason: result.finishReason, text: result.text.slice(0, 400), toolCalls: result.toolCalls.map((c) => c.toolName), batch: batch.length, usage, costUsd: usage.costUsd, cached: (world.o.cache?.stats.hits ?? 0) > cacheHitsBefore });
        history = [...history, ...result.response.messages].slice(-12);
      } else {
        for (const item of batch) await scriptedMerchantStep(world, named, item, turn++);
      }
    } catch (e) {
      if (world.o.control.stopped) break;
      world.log(`merchant turn failed: ${(e as Error).stack ?? e}`);
      await world.emit("agent.turn", MERCHANT, "merchant", { actor: MERCHANT, error: String((e as Error).message ?? e), usage: ZERO_USAGE, costUsd: 0 });
    }
  }
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Deterministic merchant behaviour: the baseline makes the classic mistakes, the hardened profile does not. */
async function scriptedMerchantStep(world: World, t: Map<string, AgentTool>, item: MerchantInboxItem, turn: number) {
  const hardened = world.hardened;
  const say = (personaId: string, text: string) => t.get("reply_to_customer")!.call({ personaId, text });
  const ship = async (rec: OrderRecord) => {
    if (!rec.captureId || rec.shipped) return;
    await t.get("create_shipment_tracking")!.call({ transaction_id: rec.captureId, tracking_number: `SWM-${rec.orderId.slice(-6)}`, status: "SHIPPED", carrier: "UPS" });
  };
  const note = (text: string) => world.emit("agent.turn", MERCHANT, "merchant", { actor: MERCHANT, model: "scripted", turn, text, usage: ZERO_USAGE, costUsd: 0, scripted: true, profile: world.merchantProfile });

  switch (item.kind) {
    case "approved": {
      const rec = world.orders.get(item.orderId);
      // Baseline: captures on every notification (no lock). Hardened: wrapper lock makes the replay a no-op.
      const r = await t.get("pay_order")!.call({ id: item.orderId });
      const cap = summariseCapture(r.ok ? r.data : undefined);
      if (r.ok && cap.captureStatus === "DECLINED") {
        if (hardened && rec) await say(rec.personaId, `Your card was declined by the bank (code ${String(cap.processorResponse?.response_code ?? "n/a")}). Nothing was charged. Please try another card and we will ship right away.`);
        await note(hardened ? "Capture declined; told the customer, not shipping." : "Captured order (200 OK).");
      } else if (r.ok && rec) {
        if (hardened) await ship(rec);
        await note(hardened ? `Captured and shipped ${rec.orderId}.` : `Captured ${rec.orderId}. Will ship when the warehouse gets to it.`);
      } else {
        await note(`Capture call failed: ${r.issue ?? r.message}`);
      }
      return;
    }
    case "message": {
      const text = item.text.toLowerCase();
      const rec = (item.orderId && world.orders.get(item.orderId)) || [...world.orders.values()].filter((o) => o.personaId === item.personaId).at(-1);
      const refundAmount = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/)?.[1];
      const wantsRefund = /refund|money back|charge ?back/.test(text);
      const whereIsIt = /where|update|shipping|tracking|arrive|deliver/.test(text);
      if (wantsRefund && rec?.captureId) {
        const asked = refundAmount ? Number(refundAmount) : rec.amount;
        const r = await t.get("create_refund")!.call({ capture_id: rec.captureId, amount: { currency_code: "USD", value: asked.toFixed(2) }, note_to_payer: "Refund as requested." });
        if (hardened) await say(item.personaId, r.ok ? `Done: refunded $${Number((r.data as { amount?: { value?: string } }).amount?.value ?? asked).toFixed(2)} to your card (refund ${(r.data as { id?: string }).id}).` : `I could not refund that: ${r.message?.slice(0, 160)}. The maximum I can refund on this order is $${(rec.amount - rec.refunded).toFixed(2)}.`);
        else if (r.ok) await say(item.personaId, "Refund issued.");
        await note(`Refund request from ${item.personaId}: ${r.ok ? "refunded" : `failed ${r.issue}`}`);
        return;
      }
      if (whereIsIt && rec) {
        if (hardened) {
          if (rec.captureId && !rec.shipped) await ship(rec);
          await say(item.personaId, rec.shipped ? `Your order ${rec.orderId} shipped with UPS, tracking ${rec.shipped.trackingNumber}.` : rec.status === "declined" ? "Your payment was declined, so the order has not shipped. Please try another card." : "Your payment is being processed; I will send tracking as soon as it ships.");
        } else if (hash(item.personaId) % 2 === 0) {
          await say(item.personaId, "Thanks for your patience, it is on its way!");
        }
        await note(`"Where is it" from ${item.personaId}${hardened ? ": shipped + replied" : ": " + (hash(item.personaId) % 2 === 0 ? "canned reply" : "ignored (busy)")}`);
        return;
      }
      if (hardened || hash(item.personaId + text) % 2 === 0) await say(item.personaId, "Thanks for your message! Let me know if there is anything else.");
      await note(`Message from ${item.personaId} handled.`);
      return;
    }
    case "dispute": {
      if (!hardened) {
        await note(`Dispute ${item.disputeId} noted; will look at it later.`);
        return;
      }
      await t.get("get_dispute")!.call({ dispute_id: item.disputeId });
      const rec = item.orderId ? world.orders.get(item.orderId) : undefined;
      const amount = Number(item.amount);
      if (amount <= world.o.config.approvalThresholdUsd || !rec) {
        const r = await t.get("accept_dispute_claim")!.call({ dispute_id: item.disputeId, note: "Accepting the claim; refunding the buyer in full. Sorry for the trouble." });
        if (rec) await say(rec.personaId, r.ok ? `We accepted your dispute ${item.disputeId} and refunded $${item.amount} in full.` : `We are reviewing dispute ${item.disputeId} and will respond within 48 hours.`);
        await note(`Dispute ${item.disputeId}: ${r.ok ? "accepted" : `accept failed (${r.issue})`}`);
      } else {
        const r = await t.get("accept_dispute_claim")!.call({ dispute_id: item.disputeId, note: "Accepting after human review." });
        await say(rec.personaId, r.ok ? `We accepted dispute ${item.disputeId} and refunded $${item.amount}.` : `Dispute ${item.disputeId} is under review; we have shipping evidence and will respond through PayPal.`);
        await note(`Dispute ${item.disputeId} above threshold: ${r.ok ? "approved + accepted" : r.issue}`);
      }
      return;
    }
  }
}
