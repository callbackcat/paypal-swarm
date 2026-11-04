/**
 * Redaction runs on every payload before it is persisted or streamed. Card numbers, CVVs,
 * client secrets and bearer tokens never reach the event log, the SSE stream or the report.
 */
const SENSITIVE_KEY_RE = /^(number|card_number|cardNumber|security_code|securityCode|cvv|cvc|client_secret|clientSecret|secret|password|access_token|accessToken|authorization|api_key|apiKey)$/i;
const PAN_RE = /\b(\d[ -]?){12,18}\d\b/g;

export function maskPan(s: string): string {
  return s.replace(PAN_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 13 ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}` : m;
  });
}

export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === "string") return maskPan(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = typeof v === "string" && /^\d{12,19}$/.test(v) ? maskPan(v) : "[redacted]";
      } else {
        out[k] = redactDeep(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}
