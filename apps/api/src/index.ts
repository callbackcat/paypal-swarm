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
  serve({ fetch: app.fetch, port: env.port }, () => {
    console.log(`swarm-api ${envFile ? `(env from ${envFile}) ` : ""}listening on http://localhost:${env.port}`);
    console.log(`  storage ${store.kind} · PayPal ${env.paypal ? "sandbox" : "mock"} · LLM ${env.openrouterKey ? "live via OpenRouter" : "scripted"} · webhooks ${env.webhookId ? "verified" : "off"} · docs /docs`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
