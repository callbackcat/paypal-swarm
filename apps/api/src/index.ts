import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { Bus } from "./bus";
import { loadEnv, readEnv } from "./env";
import { RunManager } from "./runs";
import { DbStore, MemoryStore, type Store } from "./store";

const envFile = loadEnv();
const env = readEnv();

async function main() {
  let store: Store;
  if (env.databaseUrl) {
    const db = new DbStore();
    store = (await db.ping()) ? db : new MemoryStore();
    if (store.kind === "memory") console.warn("[swarm-api] DATABASE_URL set but unreachable; falling back to in-memory storage");
  } else {
    store = new MemoryStore();
    console.warn("[swarm-api] DATABASE_URL not set; runs live in memory until restart");
  }
  const bus = new Bus();
  const manager = new RunManager(store, bus, readEnv);
  const app = createApp({ store, bus, manager, env: readEnv });
  const server = serve({ fetch: app.fetch, port: env.port }, () => {
    console.log(`swarm-api ${envFile ? `(env from ${envFile}) ` : ""}listening on http://localhost:${env.port}`);
    console.log(`  storage ${store.kind} · PayPal ${env.paypal ? "sandbox" : "mock"} · LLM ${env.openrouterKey ? "live via OpenRouter" : "scripted"} · webhooks ${env.webhookId ? "verified" : "off"} · docs /docs`);
  });
  // Pollers reuse a socket every few seconds; the Node default of 5 s closes it between polls and the client sees ECONNRESET.
  const node = server as unknown as { keepAliveTimeout?: number; headersTimeout?: number };
  if (typeof node.keepAliveTimeout === "number") {
    node.keepAliveTimeout = 65_000;
    node.headersTimeout = 66_000;
  }
  keepAwake();
}

/**
 * Render's free instances sleep after 15 minutes without inbound traffic and take about a minute to wake. On Render
 * the api requests its own public /healthz every 10 minutes, which counts as traffic and keeps it awake. Nothing
 * runs off Render (RENDER_EXTERNAL_URL is set only there), and KEEP_AWAKE=0 turns it off.
 */
function keepAwake() {
  const url = process.env.RENDER_EXTERNAL_URL?.trim();
  if (!url || process.env.KEEP_AWAKE === "0") return;
  const ping = () =>
    fetch(`${url}/healthz`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => console.log(`[keep-awake] ${url}/healthz ${r.status}`))
      .catch((e) => console.warn(`[keep-awake] ping failed: ${String((e as Error).message ?? e)}`));
  const timer = setInterval(ping, 10 * 60_000);
  timer.unref();
  console.log(`[keep-awake] pinging ${url}/healthz every 10 minutes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
