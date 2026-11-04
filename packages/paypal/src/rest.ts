import { randomUUID } from "node:crypto";
import type { PayPalCreds } from "./types";

export const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export interface RestResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/**
 * Thin REST client for the handful of sandbox-only endpoints the Server SDK does not cover
 * (process-chargeback, adjudicate, require-evidence, accept-claim, webhook verification, simulate-event).
 */
export class PayPalRest {
  private token: { value: string; exp: number } | null = null;
  constructor(
    private readonly creds: PayPalCreds,
    private readonly base = SANDBOX_BASE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now()) return this.token.value;
    const r = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!r.ok || !j.access_token) throw new Error(`PayPal OAuth failed (${r.status}): ${j.error_description ?? "no token"}`);
    this.token = { value: j.access_token, exp: Date.now() + ((j.expires_in ?? 300) - 60) * 1000 };
    return j.access_token;
  }

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<RestResponse> {
    const token = await this.accessToken();
    const r = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": headers["PayPal-Request-Id"] ?? randomUUID(),
        Prefer: "return=representation",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: r.status, headers: r.headers, body: parsed };
  }

  // --- sandbox dispute simulation -------------------------------------------------------------

  processChargeback(input: { captureId: string; amount: string; currency?: string; merchantId: string; reasonCode?: string }) {
    const now = new Date();
    const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
    return this.call("POST", "/v2/customer-support/process-chargeback", {
      adjacency: "PAYPAL",
      file_layout: "ATCK_CB",
      merchant_id: input.merchantId,
      financial_institution: { processor: "FDMS" },
      transaction: { id_enc: input.captureId, amount: { currency_code: input.currency ?? "USD", value: input.amount } },
      instrument: { instrument_type: "CARD", card_brand: "VISA", credit_card_transaction_id: digits(16), external: false },
      dispute: {
        id: null,
        stage: "CHARGEBACK",
        response_date: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
        status: "2",
        amount: { currency_code: input.currency ?? "USD", value: input.amount },
        receive_date: now.toISOString(),
        event_code: "CHARGEBACK_INITIATED",
        money_movement_date: now.toISOString(),
        event_type: "DEBIT",
        chargeback_type: "REPORTED_TO_PROCESSOR",
        processor_info: { reference_number: digits(23), reason_code: input.reasonCode ?? "1330", notes: "SWARM_CHAOS" },
      },
    });
  }

  adjudicate(disputeId: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR") {
    return this.call("POST", `/v1/customer/disputes/${disputeId}/adjudicate`, { adjudication_outcome: outcome });
  }

  requireEvidence(disputeId: string, action: "BUYER_EVIDENCE" | "SELLER_EVIDENCE") {
    return this.call("POST", `/v1/customer/disputes/${disputeId}/require-evidence`, { action });
  }

  /** Direct accept-claim: the toolkit tool validates `note` against a dispute-id regex and rejects sentences. */
  acceptClaim(disputeId: string, note: string) {
    return this.call("POST", `/v1/customer/disputes/${disputeId}/accept-claim`, { note, accept_claim_type: "REFUND" });
  }

  // --- webhooks --------------------------------------------------------------------------------

  async verifyWebhookSignature(input: { headers: Record<string, string | undefined>; rawBody: string; webhookId: string }): Promise<boolean> {
    const h = (k: string) => input.headers[k] ?? input.headers[k.toLowerCase()];
    let event: unknown;
    try {
      event = JSON.parse(input.rawBody);
    } catch {
      return false;
    }
    const r = await this.call("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("PAYPAL-AUTH-ALGO"),
      cert_url: h("PAYPAL-CERT-URL"),
      transmission_id: h("PAYPAL-TRANSMISSION-ID"),
      transmission_sig: h("PAYPAL-TRANSMISSION-SIG"),
      transmission_time: h("PAYPAL-TRANSMISSION-TIME"),
      webhook_id: input.webhookId,
      webhook_event: event,
    });
    return r.status === 200 && (r.body as { verification_status?: string })?.verification_status === "SUCCESS";
  }

  simulateWebhook(eventType: string, webhookId?: string, url?: string) {
    return this.call("POST", "/v1/notifications/simulate-event", { event_type: eventType, ...(webhookId ? { webhook_id: webhookId } : {}), ...(url ? { url } : {}) });
  }
}
