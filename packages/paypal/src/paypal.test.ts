import { describe, expect, it } from "vitest";
import { ALLOWLISTS, toolNamesFor } from "./allowlists";
import { cardFor } from "./cards";
import { classify } from "./errors";
import { mockBackend } from "./mock";
import { trimForModel } from "./trim";

describe("classify toolkit results", () => {
  it("parses success JSON strings", () => {
    const o = classify(JSON.stringify({ id: "5O190127TN364715T", status: "CREATED" }));
    expect(o.ok).toBe(true);
    expect((o.data as { id: string }).id).toBe("5O190127TN364715T");
  });
  it("unwraps the toolkit capture envelope", () => {
    const o = classify(JSON.stringify({ status: "success", response: { id: "X", status: "COMPLETED" } }));
    expect(o.ok).toBe(true);
    expect((o.data as { status: string }).status).toBe("COMPLETED");
  });
  it("classifies toolkit paypal_error strings", () => {
    const o = classify(JSON.stringify({ error: { message: "Request failed with status code 422: ORDER_ALREADY_CAPTURED Order already captured", type: "paypal_error" } }));
    expect(o.ok).toBe(false);
    expect(o.issue).toBe("ORDER_ALREADY_CAPTURED");
  });
  it("classifies LlmError http errors with status and details", () => {
    const o = classify({ code: "PAYPAL_API_HTTP_ERROR", status: 422, message: "Unprocessable", details: [{ issue: "REFUND_AMOUNT_EXCEEDED", description: "too much" }] });
    expect(o.ok).toBe(false);
    expect(o.status).toBe(422);
    expect(o.issue).toBe("REFUND_AMOUNT_EXCEEDED");
  });
  it("maps 429 to RATE_LIMIT_REACHED", () => {
    expect(classify({ code: "PAYPAL_API_HTTP_ERROR", status: 429, message: "slow down" }).issue).toBe("RATE_LIMIT_REACHED");
  });
});

describe("trimForModel", () => {
  it("compacts list_products and clips descriptions", () => {
    const long = "x".repeat(500);
    const out = trimForModel("list_products", { ok: true, data: { products: [{ id: "PROD-1", name: "A", description: long, create_time: "t", links: [] }], total_items: 1 } }) as { products: Array<{ description: string }> };
    expect(out.products[0]!.description.length).toBeLessThanOrEqual(160);
    expect(JSON.stringify(out).length).toBeLessThan(400);
  });
  it("surfaces capture status and processor response for pay_order", () => {
    const out = trimForModel("pay_order", {
      ok: true,
      data: { id: "O1", status: "COMPLETED", purchase_units: [{ amount: { currency_code: "USD", value: "10.00" }, payments: { captures: [{ id: "C1", status: "DECLINED", amount: { currency_code: "USD", value: "10.00" }, processor_response: { response_code: "5100" } }] } }] },
    }) as { capture: { status: string; processor_response: { response_code: string } } };
    expect(out.capture.status).toBe("DECLINED");
    expect(out.capture.processor_response.response_code).toBe("5100");
  });
  it("keeps errors compact", () => {
    const out = trimForModel("create_refund", { ok: false, status: 422, issue: "CAPTURE_FULLY_REFUNDED", message: "m".repeat(2000), data: {} });
    expect(JSON.stringify(out).length).toBeLessThan(500);
  });
});

describe("allow-lists", () => {
  it("shoppers never get refund or capture tools", () => {
    const names = toolNamesFor(ALLOWLISTS.shopper);
    expect(names).toContain("create_order");
    expect(names).not.toContain("create_refund");
    expect(names).not.toContain("pay_order");
  });
  it("mock exposes exactly the allow-listed tools with real schemas", () => {
    const be = mockBackend({ latencyMs: 0 });
    const tools = be.tools(ALLOWLISTS.merchant);
    expect(tools.map((t) => t.name).sort()).toEqual(toolNamesFor(ALLOWLISTS.merchant).sort());
    const capture = tools.find((t) => t.name === "pay_order")!;
    expect(capture.inputSchema.safeParse({ id: "5O190127TN364715T" }).success).toBe(true);
  });
});

describe("mock PayPal lifecycle", () => {
  it("create -> confirm -> capture -> duplicate capture 422 -> refund -> over-refund 422 -> dispute -> accept", async () => {
    const be = mockBackend({ latencyMs: 0, webhookDelayMs: 0 });
    const hooks: string[] = [];
    be.onWebhook!((e) => hooks.push(e.event_type));
    const shopper = Object.fromEntries(be.tools(ALLOWLISTS.shopper).map((t) => [t.name, t]));
    const merchant = Object.fromEntries(be.tools(ALLOWLISTS.merchant).map((t) => [t.name, t]));

    const created = await shopper.create_order!.run({ currencyCode: "USD", items: [{ name: "Socks", quantity: 2, itemCost: 9.5, taxAmount: 0 }] });
    expect(created.ok).toBe(true);
    const orderId = (created.data as { id: string }).id;

    const notYet = await merchant.pay_order!.run({ id: orderId });
    expect(notYet.issue).toBe("ORDER_NOT_APPROVED");

    const confirm = await be.confirmWithCard(orderId, cardFor("VISA", "Pat Example"));
    expect(confirm.orderStatus).toBe("APPROVED");

    const paid = await merchant.pay_order!.run({ id: orderId });
    expect(paid.ok).toBe(true);
    const captureId = (paid.data as { purchase_units: Array<{ payments: { captures: Array<{ id: string; status: string }> } }> }).purchase_units[0]!.payments.captures[0]!;
    expect(captureId.status).toBe("COMPLETED");

    const dup = await merchant.pay_order!.run({ id: orderId });
    expect(dup.issue).toBe("ORDER_ALREADY_CAPTURED");

    const tracking = await merchant.create_shipment_tracking!.run({ transaction_id: captureId.id, tracking_number: "1Z999", status: "SHIPPED", carrier: "UPS" });
    expect(tracking.ok).toBe(true);

    const partial = await merchant.create_refund!.run({ capture_id: captureId.id, amount: { currency_code: "USD", value: "5.00" } });
    expect(partial.ok).toBe(true);
    const tooMuch = await merchant.create_refund!.run({ capture_id: captureId.id, amount: { currency_code: "USD", value: "50.00" } });
    expect(tooMuch.issue).toBe("REFUND_AMOUNT_EXCEEDED");
    const rest = await merchant.create_refund!.run({ capture_id: captureId.id });
    expect(rest.ok).toBe(true);
    const again = await merchant.create_refund!.run({ capture_id: captureId.id });
    expect(again.issue).toBe("CAPTURE_FULLY_REFUNDED");

    const cb = await be.processChargeback({ captureId: captureId.id, amount: "19.00" });
    expect(cb.httpStatus).toBe(201);
    const listed = await merchant.list_disputes!.run({ disputed_transaction_id: captureId.id });
    expect((listed.data as { items: unknown[] }).items.length).toBe(1);
    const accepted = await be.acceptClaim(cb.disputeId!, "Refunding in full.");
    expect(accepted.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    expect(hooks).toContain("CHECKOUT.ORDER.APPROVED");
    expect(hooks).toContain("PAYMENT.CAPTURE.COMPLETED");
    expect(hooks).toContain("CUSTOMER.DISPUTE.CREATED");
  });

  it("declines when the card name carries a CCREJECT trigger", async () => {
    const be = mockBackend({ latencyMs: 0 });
    const shopper = Object.fromEntries(be.tools(ALLOWLISTS.shopper).map((t) => [t.name, t]));
    const merchant = Object.fromEntries(be.tools(ALLOWLISTS.merchant).map((t) => [t.name, t]));
    const created = await shopper.create_order!.run({ currencyCode: "USD", items: [{ name: "Light", quantity: 1, itemCost: 34, taxAmount: 0 }] });
    const orderId = (created.data as { id: string }).id;
    await be.confirmWithCard(orderId, cardFor("VISA", "x", "refused"));
    const paid = await merchant.pay_order!.run({ id: orderId });
    expect(paid.ok).toBe(true);
    const trimmed = trimForModel("pay_order", paid) as { capture: { status: string } };
    expect(trimmed.capture.status).toBe("DECLINED");
  });

  it("injects 429s when asked", async () => {
    const be = mockBackend({ latencyMs: 0, rateLimitEvery: 2 });
    const t = be.tools(ALLOWLISTS.shopper).find((x) => x.name === "list_products")!;
    const a = await t.run({});
    const b = await t.run({});
    expect([a.status, b.status]).toContain(429);
  });
});
