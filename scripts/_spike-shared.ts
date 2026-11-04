// Shared helpers for the Day-1 throwaway spikes. Not product code.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const BASE = "https://api-m.sandbox.paypal.com";
export const LAST_FILE = "scripts/.spike-last.json";

export function loadEnv() {
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env");
  } catch {
    /* no .env yet */
  }
}

export function creds() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env (sandbox Business app).");
    process.exit(1);
  }
  return { clientId, clientSecret };
}

let cachedToken: { value: string; exp: number } | null = null;
export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.value;
  const { clientId, clientSecret } = creds();
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`oauth failed ${r.status}: ${j.error_description ?? JSON.stringify(j)}`);
  cachedToken = { value: j.access_token, exp: Date.now() + ((j.expires_in ?? 300) - 60) * 1000 };
  return j.access_token;
}

export async function pp(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const token = await accessToken();
  const r = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": randomUUID(),
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: r.status, headers: r.headers, body };
}

export function parseToolResult(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Depth-first search for the first value under `key` that satisfies `test`. */
export function find(obj: unknown, key: string, test: (v: unknown) => boolean = () => true): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const hit = find(el, key, test);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (key in rec && test(rec[key])) return rec[key];
  for (const v of Object.values(rec)) {
    const hit = find(v, key, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export const isOrderId = (v: unknown) => typeof v === "string" && /^[A-Z0-9]{17}$/.test(v);
export const isTxnId = (v: unknown) => typeof v === "string" && /^[A-Z0-9]{17}$/.test(v);

export function saveLast(data: Record<string, unknown>) {
  const prev = existsSync(LAST_FILE) ? (JSON.parse(readFileSync(LAST_FILE, "utf8")) as Record<string, unknown>) : {};
  writeFileSync(LAST_FILE, JSON.stringify({ ...prev, ...data, savedAt: new Date().toISOString() }, null, 2));
}
export function loadLast(): Record<string, unknown> {
  return existsSync(LAST_FILE) ? (JSON.parse(readFileSync(LAST_FILE, "utf8")) as Record<string, unknown>) : {};
}

export function section(title: string) {
  console.log(`\n=== ${title} ===`);
}
export function show(label: string, v: unknown) {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  console.log(`${label}: ${s && s.length > 2500 ? s.slice(0, 2500) + " ...[truncated]" : s}`);
}
