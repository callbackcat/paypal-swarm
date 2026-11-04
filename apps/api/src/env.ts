import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads the repo-root .env when present (local dev). Render injects real env vars. Never overrides existing ones. */
export function loadEnv() {
  for (const rel of [".env", "../.env", "../../.env"]) {
    const f = resolve(process.cwd(), rel);
    if (existsSync(f)) {
      try {
        const before = { ...process.env };
        process.loadEnvFile(f);
        for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
      } catch {
        /* ignore malformed .env */
      }
      return f;
    }
  }
  return undefined;
}

export interface Env {
  databaseUrl?: string;
  paypal?: { clientId: string; clientSecret: string; merchantId?: string };
  webhookId?: string;
  openrouterKey?: string;
  llmCache: boolean;
  kmsKey?: string;
  port: number;
  corsOrigin: string;
  tokenCap?: number;
  demoDailyTokenCap: number;
  publicUrl?: string;
  models: { shopper?: string; merchant?: string; analyst?: string };
}

export function readEnv(): Env {
  const e = process.env;
  const clientId = e.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = e.PAYPAL_CLIENT_SECRET?.trim();
  return {
    databaseUrl: e.DATABASE_URL?.trim() || undefined,
    paypal: clientId && clientSecret ? { clientId, clientSecret, merchantId: e.PAYPAL_MERCHANT_ID?.trim() || undefined } : undefined,
    webhookId: e.PAYPAL_WEBHOOK_ID?.trim() || undefined,
    openrouterKey: e.OPENROUTER_API_KEY?.trim() || undefined,
    llmCache: e.LLM_CACHE === "1" || e.LLM_CACHE === "true",
    kmsKey: e.SWARM_KMS_KEY?.trim() || undefined,
    port: Number(e.API_PORT ?? e.PORT ?? 8787),
    corsOrigin: e.CORS_ORIGIN?.trim() || "*",
    tokenCap: e.SWARM_RUN_TOKEN_CAP ? Number(e.SWARM_RUN_TOKEN_CAP) : undefined,
    demoDailyTokenCap: Number(e.DEMO_DAILY_TOKEN_CAP ?? 1_500_000),
    publicUrl: e.PUBLIC_API_URL?.trim() || e.RENDER_EXTERNAL_URL?.trim() || undefined,
    models: { shopper: e.SWARM_MODEL_SHOPPER || undefined, merchant: e.SWARM_MODEL_MERCHANT || undefined, analyst: e.SWARM_MODEL_ANALYST || undefined },
  };
}
