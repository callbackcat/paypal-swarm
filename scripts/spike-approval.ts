/**
 * Day-1 spike 1 (throwaway): can Swarm approve a sandbox order as the buyer without a browser,
 * and does the toolkit pay_order tool then capture it?
 *
 *   pnpm spike:approval            # path A: toolkit create_order -> card confirm -> toolkit pay_order
 *   pnpm spike:approval B          # path B: Server SDK create (no payment_source) -> card confirm -> toolkit pay_order
 *   pnpm spike:approval AUTH       # fallback: intent AUTHORIZE -> confirm -> authorizeOrder -> captureAuthorizedPayment
 *   SPIKE_CARD_NAME=CCREJECT-REFUSED pnpm spike:approval   # force a processor decline at capture time
 *
 * Decides which order-creation path the shopper agent uses. Prints PayPal ids to cross-check in the sandbox dashboard.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
} from "@paypal/paypal-server-sdk";
import { creds, find, isOrderId, isTxnId, loadEnv, parseToolResult, pp, saveLast, section, show } from "./_spike-shared";

loadEnv();
const { clientId, clientSecret } = creds();
const mode = (process.argv[2] ?? "A").toUpperCase();
const cardName = process.env.SPIKE_CARD_NAME ?? "Spike Shopper";
const AMOUNT = "12.50";

const toolkit = new PayPalAgentToolkit({
  clientId,
  clientSecret,
  configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } },
});
// AI SDK v4 tool objects: execute(args, { toolCallId, messages })
const tools = toolkit.getTools() as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<unknown> }>;
const execOpts = { toolCallId: "spike", messages: [] };
const runTool = async (name: string, args: unknown) => parseToolResult(await tools[name]!.execute(args, execOpts));

const sdk = new Client({
  clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
  environment: Environment.Sandbox,
});
const orders = new OrdersController(sdk);
const payments = new PaymentsController(sdk);

async function createOrder(): Promise<string> {
  section(`1. create order (path ${mode})`);
  if (mode === "A") {
    const res = await runTool("create_order", {
      currencyCode: "USD",
      items: [{ name: "Swarm spike widget", quantity: 1, description: "Day-1 spike", itemCost: Number(AMOUNT), taxAmount: 0, itemTotal: Number(AMOUNT) }],
    });
    show("toolkit create_order", res);
    const id = find(res, "id", isOrderId);
    if (!isOrderId(id)) throw new Error("no order id in toolkit response");
    return id as string;
  }
  const intent = mode === "AUTH" ? CheckoutPaymentIntent.Authorize : CheckoutPaymentIntent.Capture;
  const { result, statusCode } = await orders.createOrder({
    body: { intent, purchaseUnits: [{ referenceId: "spike", amount: { currencyCode: "USD", value: AMOUNT } }] },
    prefer: "return=representation",
  });
  show(`server-sdk createOrder ${statusCode}`, { id: result.id, status: result.status, intent: result.intent });
  if (!result.id) throw new Error("no order id from server sdk");
  return result.id;
}

async function confirmWithCard(orderId: string) {
  section("2. confirm-payment-source with a sandbox card (no browser)");
  const { status, body } = await pp(`/v2/checkout/orders/${orderId}/confirm-payment-source`, {
    method: "POST",
    body: {
      payment_source: {
        card: {
          number: "4012888888881881",
          expiry: "2030-12",
          security_code: "123",
          name: cardName,
          billing_address: {
            address_line_1: "2211 N First St",
            admin_area_2: "San Jose",
            admin_area_1: "CA",
            postal_code: "95131",
            country_code: "US",
          },
        },
      },
    },
  });
  const b = (body ?? {}) as { status?: string; details?: unknown; name?: string; message?: string };
  show(`HTTP ${status}`, { status: b.status, name: b.name, message: b.message, details: b.details });
  const merchantId = find(body, "merchant_id");
  if (merchantId) saveLast({ merchantId });
  if (status >= 400) {
    console.log("\nVERDICT: confirm rejected on this path." + (mode === "A" ? " Re-run with `pnpm spike:approval B`." : ""));
    process.exit(2);
  }
  if (b.status === "COMPLETED") {
    console.log("\nWARNING: PayPal captured at confirm time (status COMPLETED). The merchant never gets to call pay_order.");
    console.log("Re-run with `pnpm spike:approval AUTH` to test the authorize-then-capture fallback.");
  } else if (b.status !== "APPROVED") {
    console.log(`\nWARNING: expected APPROVED, got ${b.status}`);
  } else {
    console.log("\nOK: order is APPROVED and still uncaptured, exactly what the merchant agent should see.");
  }
  return b.status;
}

async function captureViaToolkit(orderId: string) {
  section("3. merchant captures with toolkit pay_order");
  const res = await runTool("pay_order", { id: orderId });
  show("pay_order", res);
  const captures = find(res, "captures") as Array<Record<string, unknown>> | undefined;
  const cap = captures?.[0];
  const captureId = cap && isTxnId(cap.id) ? (cap.id as string) : undefined;
  const captureStatus = cap?.status as string | undefined;
  const processor = cap?.processor_response;
  console.log(`\ncapture id=${captureId} status=${captureStatus} processor_response=${JSON.stringify(processor ?? null)}`);
  if (captureStatus === "DECLINED") console.log("NOTE: HTTP 200 with DECLINED capture. This is the signal CAPTURE_DECLINED_UNHANDLED relies on.");

  section("3b. duplicate capture attempt (expect ORDER_ALREADY_CAPTURED in the error string)");
  const dup = await runTool("pay_order", { id: orderId });
  show("second pay_order", dup);
  return { captureId, captureStatus };
}

async function captureViaAuthorize(orderId: string) {
  section("3. authorizeOrder then captureAuthorizedPayment (AUTH fallback)");
  const auth = await orders.authorizeOrder({ id: orderId, prefer: "return=representation" });
  const authorizations = find(auth.result, "authorizations") as Array<Record<string, unknown>> | undefined;
  const authId = authorizations?.[0]?.id as string | undefined;
  show(`authorizeOrder ${auth.statusCode}`, { authId, status: authorizations?.[0]?.status });
  if (!authId) throw new Error("no authorization id");
  const cap = await payments.captureAuthorizedPayment({
    authorizationId: authId,
    body: { finalCapture: true },
    prefer: "return=representation",
  });
  show(`captureAuthorizedPayment ${cap.statusCode}`, { id: cap.result.id, status: cap.result.status });
  return { captureId: cap.result.id, captureStatus: cap.result.status as string | undefined };
}

(async () => {
  const orderId = await createOrder();
  saveLast({ orderId, path: mode, cardName });
  const confirmStatus = await confirmWithCard(orderId);
  let result: { captureId?: string; captureStatus?: string } = {};
  if (confirmStatus === "APPROVED") {
    result = mode === "AUTH" ? await captureViaAuthorize(orderId) : await captureViaToolkit(orderId);
  }
  section("4. get_order (what the merchant sees afterwards)");
  const got = await runTool("get_order", { id: orderId });
  show("get_order status", find(got, "status"));
  saveLast({ ...result, confirmStatus, amount: AMOUNT });
  section("SUMMARY");
  console.log(JSON.stringify({ path: mode, orderId, confirmStatus, ...result }, null, 2));
  console.log("Saved to scripts/.spike-last.json for spike-chargeback.");
})().catch((e: unknown) => {
  const err = e as { result?: unknown; body?: unknown };
  console.error("SPIKE FAILED:", err?.result ?? err?.body ?? e);
  process.exit(1);
});
