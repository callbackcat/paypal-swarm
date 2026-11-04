import type { ToolOutcome } from "./types";

/** Issues the readiness rules and merchant prompts key on. */
export const KNOWN_ISSUES = [
  "ORDER_ALREADY_CAPTURED",
  "ORDER_NOT_APPROVED",
  "INSTRUMENT_DECLINED",
  "TRANSACTION_REFUSED",
  "PAYER_ACTION_REQUIRED",
  "CAPTURE_FULLY_REFUNDED",
  "REFUND_AMOUNT_EXCEEDED",
  "MAX_NUMBER_OF_REFUNDS_EXCEEDED",
  "DUPLICATE_INVOICE_ID",
  "RATE_LIMIT_REACHED",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_FOUND",
  "INVALID_RESOURCE_ID",
  "MISSING_REQUIRED_PARAMETER",
  "INVALID_REQUEST",
  "UNPROCESSABLE_ENTITY",
  "NOT_AUTHORIZED",
  "COMPLIANCE_VIOLATION",
  "PAYEE_ACCOUNT_RESTRICTED",
  "AUTHENTICATION_FAILURE",
  "INTERNAL_SERVER_ERROR",
] as const;
export type KnownIssue = (typeof KNOWN_ISSUES)[number];

const ISSUE_RE = new RegExp(`\\b(${KNOWN_ISSUES.join("|")})\\b`);

export function parseJsonish(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * The toolkit returns errors as JSON strings rather than throwing:
 *   {"error":{"message":"...","type":"paypal_error"}}
 *   {"code":"PAYPAL_API_HTTP_ERROR","status":422,"message":"... ORDER_ALREADY_CAPTURED ..."}
 * Successful captures come back as {"status":"success","response":{...}}.
 */
export function classify(raw: unknown): ToolOutcome {
  const data = parseJsonish(raw);
  if (data === null || data === undefined) return { ok: false, message: "empty response", data };
  if (typeof data === "string") {
    const issue = data.match(ISSUE_RE)?.[1];
    const looksBad = /error|fail|invalid|denied|unauthori[sz]ed/i.test(data);
    return looksBad || issue ? { ok: false, issue, message: data.slice(0, 500), data } : { ok: true, data };
  }
  if (typeof data !== "object") return { ok: true, data };
  const rec = data as Record<string, unknown>;

  const err = (rec.error && typeof rec.error === "object" ? (rec.error as Record<string, unknown>) : undefined) ?? (rec.code === "PAYPAL_API_HTTP_ERROR" ? rec : undefined);
  const paypalName = typeof rec.name === "string" && /^[A-Z_]{6,}$/.test(rec.name) && rec.debug_id ? rec : undefined;
  const source = err ?? paypalName;
  if (!source) {
    if (rec.status === "success" && "response" in rec) return { ok: true, data: rec.response };
    return { ok: true, data };
  }
  const statusNum = [source.status, source.statusCode, rec.status, rec.statusCode].find((v) => typeof v === "number") as number | undefined;
  const details = source.details as Array<{ issue?: string; description?: string }> | undefined;
  const messageParts = [source.message, source.name, details?.map((d) => `${d.issue ?? ""} ${d.description ?? ""}`).join("; ")].filter(Boolean);
  const message = messageParts.join(" | ").slice(0, 800) || "PayPal error";
  const issue = details?.find((d) => d.issue)?.issue ?? message.match(ISSUE_RE)?.[1] ?? (statusNum === 429 ? "RATE_LIMIT_REACHED" : typeof source.name === "string" ? (source.name as string) : undefined);
  return { ok: false, status: statusNum, issue, message, data };
}

export const isRateLimit = (o: ToolOutcome) => o.status === 429 || o.issue === "RATE_LIMIT_REACHED";
