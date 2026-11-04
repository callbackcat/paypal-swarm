import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { CheckoutPaymentIntent, Client, Environment, OrdersController } from "@paypal/paypal-server-sdk";
import type { ZodTypeAny } from "zod";
import { BILLING_ADDRESS } from "./cards";
import { classify } from "./errors";
import { PayPalRest } from "./rest";
import type { Actions, CardDetails, ConfirmResult, PayPalBackend, PayPalCreds, SwarmTool, ToolOutcome } from "./types";

type RawToolkitTool = { description: string; parameters: ZodTypeAny; execute: (args: unknown, opts: unknown) => Promise<unknown> };

/**
 * The real thing: PayPal Agent Toolkit for every agent-facing capability, PayPal Server SDK for buyer
 * approval and the hardened merchant capture, raw REST for sandbox-only dispute simulation.
 */
export function sandboxBackend(creds: PayPalCreds): PayPalBackend {
  const rest = new PayPalRest(creds);
  const sdk = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: creds.clientId, oAuthClientSecret: creds.clientSecret },
    environment: Environment.Sandbox,
    timeout: 30_000,
  });
  const orders = new OrdersController(sdk);
  let learnedMerchantId = creds.merchantId;

  const sdkOutcome = async (fn: () => Promise<{ result: unknown; statusCode: number }>): Promise<ToolOutcome> => {
    try {
      const { result, statusCode } = await fn();
      return { ok: true, status: statusCode, data: result };
    } catch (e: unknown) {
      const err = e as { statusCode?: number; result?: unknown; body?: unknown; message?: string };
      const body = err.result ?? (typeof err.body === "string" ? safeJson(err.body) : err.body) ?? { message: err.message };
      const c = classify(body);
      return { ...c, ok: false, status: err.statusCode ?? c.status, data: body };
    }
  };

  return {
    mode: "sandbox",

    tools(actions: Actions): SwarmTool[] {
      const toolkit = new PayPalAgentToolkit({ clientId: creds.clientId, clientSecret: creds.clientSecret, configuration: { actions, context: { sandbox: true } } });
      const raw = toolkit.getTools() as unknown as Record<string, RawToolkitTool>;
      return Object.entries(raw).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.parameters,
        run: async (input) => classify(await t.execute(input, { toolCallId: randomUUID(), messages: [] })),
      }));
    },

    createOrderWithoutSource: (input) =>
      sdkOutcome(() =>
        orders.createOrder({
          body: {
            intent: CheckoutPaymentIntent.Capture,
            purchaseUnits: [{ referenceId: input.referenceId ?? "swarm", description: input.description, amount: { currencyCode: input.currency ?? "USD", value: input.amount } }],
          },
          paypalRequestId: randomUUID(),
          prefer: "return=representation",
        }),
      ),

    async confirmWithCard(orderId: string, card: CardDetails): Promise<ConfirmResult> {
      // Raw REST rather than the SDK's confirmOrder so a 422 body (issue, details) is preserved verbatim for the log.
      const r = await rest.call("POST", `/v2/checkout/orders/${orderId}/confirm-payment-source`, {
        payment_source: {
          card: { number: card.number, expiry: card.expiry, security_code: card.securityCode, name: card.name, billing_address: BILLING_ADDRESS },
        },
      });
      const body = (r.body ?? {}) as Record<string, unknown>;
      const merchantId = (body.purchase_units as Array<{ payee?: { merchant_id?: string } }> | undefined)?.[0]?.payee?.merchant_id;
      if (merchantId && !learnedMerchantId) learnedMerchantId = merchantId;
      const c = r.status >= 400 ? classify(body) : undefined;
      return { httpStatus: r.status, orderStatus: body.status as string | undefined, issue: c?.issue, merchantId, raw: body };
    },

    captureOrder: (orderId, opts) =>
      sdkOutcome(() =>
        orders.captureOrder({
          id: orderId,
          paypalRequestId: opts?.requestId ?? orderId,
          prefer: "return=representation",
          ...(opts?.mockIssue ? { paypalMockResponse: JSON.stringify({ mock_application_codes: opts.mockIssue }) } : {}),
        }),
      ),

    async processChargeback(input) {
      const merchantId = input.merchantId ?? learnedMerchantId;
      if (!merchantId) return { httpStatus: 0, raw: { error: "merchant id unknown; set PAYPAL_MERCHANT_ID or confirm one order first" } };
      const r = await rest.processChargeback({ ...input, merchantId });
      const links = (r.body as { links?: Array<{ href?: string }> } | null)?.links ?? [];
      const href = links[0]?.href ?? r.headers.get("location") ?? "";
      const disputeId = (r.body as { dispute_id?: string } | null)?.dispute_id ?? href.match(/PP-[A-Z]-\d+/)?.[0];
      return { httpStatus: r.status, disputeId, raw: r.body };
    },

    adjudicate: async (id, outcome) => toOutcome(await rest.adjudicate(id, outcome)),
    acceptClaim: async (id, note) => toOutcome(await rest.acceptClaim(id, note)),
    verifyWebhook: (input) => rest.verifyWebhookSignature(input),
  };
}

function toOutcome(r: { status: number; body: unknown }): ToolOutcome {
  if (r.status >= 400) return { ...classify(r.body), ok: false, status: r.status };
  return { ok: true, status: r.status, data: r.body };
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
