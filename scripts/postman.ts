/**
 * Generates a Postman v2.1 collection + local environment from the api's OpenAPI document.
 * Boots the Hono app in-process (memory store) so no server needs to be running.
 *
 *   pnpm postman          → postman/swarm.postman_collection.json, postman/swarm.local.postman_environment.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createApp } from "../apps/api/src/app";
import { Bus } from "../apps/api/src/bus";
import { RunManager } from "../apps/api/src/runs";
import { MemoryStore } from "../apps/api/src/store";

interface OpenApi {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, { summary?: string; description?: string; tags?: string[]; requestBody?: unknown; parameters?: Array<{ name: string; in: string }> }>>;
}

const EXAMPLES: Record<string, unknown> = {
  "POST /runs": { scenario: "quiet-tuesday", merchantProfile: "baseline" },
  "POST /runs/estimate": { scenario: "black-friday", merchantProfile: "baseline", shoppers: 25 },
  "POST /runs/{id}/approvals/{approvalId}": { decision: "granted" },
  "POST /runs/{id}/rerun": { merchantProfile: "hardened" },
  "POST /webhooks/paypal": { id: "WH-TEST-0000000001", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "{{captureId}}", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "{{orderId}}" } } } },
  "POST /ai/studio-turn": { runId: "{{runId}}", items: [{ type: "message", role: "user", content: "Which orders were captured without tracking? Build a table." }], tools: [{ name: "addWidget", description: "Add a widget to the page", parameters: { type: "object", properties: { title: { type: "string" } } } }] },
};

async function main() {
  const store = new MemoryStore();
  const bus = new Bus();
  const env = () => ({ llmCache: false, port: 8787, corsOrigin: "*", demoDailyTokenCap: 1_500_000, models: {}, publicUrl: "http://localhost:8787" });
  const app = createApp({ store, bus, manager: new RunManager(store, bus, env), env });
  const doc = (await (await app.request("/openapi.json")).json()) as OpenApi;

  const folders = new Map<string, unknown[]>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const M = method.toUpperCase();
      const tag = op.tags?.[0] ?? "misc";
      const pmPath = path.replace(/\{(\w+)\}/g, "{{$1}}");
      const example = EXAMPLES[`${M} ${path}`];
      const query = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ key: p.name, value: "", disabled: true }));
      const item = {
        name: op.summary ?? `${M} ${path}`,
        request: {
          method: M,
          header: [{ key: "Content-Type", value: "application/json" }, ...(path === "/runs/{id}/events" ? [{ key: "Accept", value: "text/event-stream" }] : [])],
          url: { raw: `{{baseUrl}}${pmPath}${query.length ? "?" + query.map((q) => `${q.key}=`).join("&") : ""}`, host: ["{{baseUrl}}"], path: pmPath.split("/").filter(Boolean), query },
          description: op.description ?? op.summary,
          ...(example || op.requestBody ? { body: { mode: "raw", raw: JSON.stringify(example ?? {}, null, 2), options: { raw: { language: "json" } } } } : {}),
        },
        ...(path === "/runs" && M === "POST" ? { event: [{ listen: "test", script: { type: "text/javascript", exec: ['const j = pm.response.json(); if (j.id) pm.environment.set("runId", j.id);'] } }] } : {}),
      };
      folders.set(tag, [...(folders.get(tag) ?? []), item]);
    }
  }
  const collection = {
    info: { name: doc.info.title, description: `${doc.info.description ?? ""}\n\nGenerated from /openapi.json by scripts/postman.ts. Set baseUrl; POST /runs stores runId for the other requests.`, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json", version: doc.info.version },
    variable: [{ key: "baseUrl", value: "http://localhost:8787" }, { key: "runId", value: "" }, { key: "id", value: "{{runId}}" }, { key: "approvalId", value: "" }],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
  const environment = {
    name: "Swarm local",
    values: [
      { key: "baseUrl", value: "http://localhost:8787", enabled: true },
      { key: "runId", value: "", enabled: true },
      { key: "id", value: "{{runId}}", enabled: true },
      { key: "approvalId", value: "", enabled: true },
      { key: "orderId", value: "", enabled: true },
      { key: "captureId", value: "", enabled: true },
    ],
  };
  mkdirSync("postman", { recursive: true });
  writeFileSync("postman/swarm.postman_collection.json", JSON.stringify(collection, null, 2));
  writeFileSync("postman/swarm.local.postman_environment.json", JSON.stringify(environment, null, 2));
  writeFileSync("postman/openapi.json", JSON.stringify(doc, null, 2));
  console.log(`postman: ${collection.item.length} folders, ${[...folders.values()].flat().length} requests → postman/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
