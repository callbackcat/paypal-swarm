import { renderMarkdown, RunConfigSchema, SCENARIOS, SWARM_VERSION } from "@swarm/core";
import { ALLOWLISTS, toolNamesFor } from "@swarm/paypal";
import { describeInjection, estimateRun } from "@swarm/agents";
import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { Bus } from "./bus";
import type { Env } from "./env";
import { HttpError, RunManager } from "./runs";
import type { Store } from "./store";
import { studioTurn, StudioTurnSchema } from "./studio";
import { planRun, PlanRequestSchema } from "./plan";
import { handleWebhook } from "./webhooks";

export interface AppDeps {
  store: Store;
  bus: Bus;
  manager: RunManager;
  env: () => Env;
}

const Any = z.any();
const IdParam = z.object({ id: z.string().openapi({ example: "run_1a2b3c4d5e6f" }) });
const Err = z.object({ error: z.string() });
const json = (schema: z.ZodTypeAny, description: string) => ({ description, content: { "application/json": { schema } } });

export function createApp(deps: AppDeps) {
  const { store, bus, manager, env } = deps;
  const app = new OpenAPIHono({ defaultHook: (result, c) => (result.success ? undefined : c.json({ error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400)) });
  app.use("*", cors({ origin: env().corsOrigin === "*" ? "*" : env().corsOrigin.split(","), allowHeaders: ["Content-Type", "Authorization", "Last-Event-ID", "X-OpenRouter-Key"], exposeHeaders: ["Content-Type"] }));
  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status as 400);
    console.error(e);
    return c.json({ error: String((e as Error).message ?? e) }, 500);
  });

  // --- health -----------------------------------------------------------------------------------
  app.openapi(
    createRoute({ method: "get", path: "/healthz", tags: ["platform"], responses: { 200: json(Any, "Service health, storage kind and which integrations are configured") } }),
    async (c) => {
      const e = env();
      return c.json({ ok: await store.ping(), service: "swarm-api", version: SWARM_VERSION, storage: store.kind, paypal: e.paypal ? "sandbox" : "mock", llm: e.openrouterKey ? "live" : "scripted", webhooks: !!e.webhookId, activeRuns: manager.active.size });
    },
  );

  // --- scenarios --------------------------------------------------------------------------------
  app.openapi(
    createRoute({ method: "get", path: "/scenarios", tags: ["runs"], responses: { 200: json(Any, "Scenario presets with token/cost estimates and the per-agent PayPal allow-lists") } }),
    (c) => {
      const e = env();
      const live = !!e.openrouterKey;
      return c.json({
        scenarios: SCENARIOS.map((s) => ({ ...s, chaosDescription: s.chaos.map(describeInjection), liveEstimate: s.status === "ready" ? estimateRun(s, { models: e.models, scripted: false }) : null })),
        modes: { paypal: e.paypal ? "sandbox" : "mock", llm: live ? "live" : "scripted", webhooks: !!e.webhookId },
        allowlists: Object.fromEntries(Object.entries(ALLOWLISTS).map(([k, v]) => [k, { actions: v, tools: toolNamesFor(v) }])),
      });
    },
  );

  // --- runs -------------------------------------------------------------------------------------
  app.openapi(
    createRoute({ method: "post", path: "/runs/estimate", tags: ["runs"], request: { body: { content: { "application/json": { schema: RunConfigSchema } } } }, responses: { 200: json(Any, "Token and USD estimate before anything is spent"), 400: json(Err, "Bad config") } }),
    (c) => c.json(manager.estimate(c.req.valid("json"))),
  );
  app.openapi(
    createRoute({ method: "post", path: "/runs", tags: ["runs"], request: { body: { content: { "application/json": { schema: RunConfigSchema } } } }, responses: { 201: json(Any, "Run created and started"), 400: json(Err, "Over cap or bad config"), 429: json(Err, "Demo allowance exhausted") } }),
    async (c) => {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("cf-connecting-ip") ?? "local";
      const r = await manager.create(c.req.valid("json"), { ip, start: true });
      const { credentialsEnc: _e, ...run } = r.run;
      return c.json({ ...run, modes: r.modes, estimate: r.estimate }, 201);
    },
  );
  app.openapi(createRoute({ method: "get", path: "/runs", tags: ["runs"], responses: { 200: json(Any, "Recent runs") } }), async (c) => c.json({ runs: (await store.listRuns(50)).map(({ credentialsEnc: _e, ...r }) => ({ ...r, active: manager.active.has(r.id) })) }));
  app.openapi(createRoute({ method: "get", path: "/runs/{id}", tags: ["runs"], request: { params: IdParam }, responses: { 200: json(Any, "Run status with live token counters, pending approvals and the order board"), 404: json(Err, "Unknown run") } }), async (c) => c.json(await manager.status(c.req.valid("param").id)));
  app.openapi(createRoute({ method: "get", path: "/runs/{id}/events.json", tags: ["runs"], request: { params: IdParam, query: z.object({ since: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().positive().max(5000).default(2000), type: z.string().optional() }) }, responses: { 200: json(Any, "Paged event log (JSON). Use /runs/{id}/events for SSE.") } }), async (c) => {
    const { id } = c.req.valid("param");
    const { since, limit, type } = c.req.valid("query");
    const events = (await store.listEvents(id, since, limit)).filter((e) => !type || e.type === type);
    return c.json({ events, next: events.length ? events[events.length - 1]!.id : since });
  });

  for (const action of ["pause", "resume", "stop"] as const) {
    app.openapi(createRoute({ method: "post", path: `/runs/{id}/${action}`, tags: ["runs"], request: { params: IdParam }, responses: { 200: json(Any, `${action} the run`), 409: json(Err, "Run not active") } }), async (c) => {
      const { id } = c.req.valid("param");
      manager[action](id);
      return c.json({ id, action });
    });
  }

  app.openapi(createRoute({ method: "get", path: "/runs/{id}/approvals", tags: ["approvals"], request: { params: IdParam, query: z.object({ pending: z.enum(["1", "0"]).default("0") }) }, responses: { 200: json(Any, "Approvals for the run") } }), async (c) => c.json({ approvals: await store.listApprovals(c.req.valid("param").id, c.req.valid("query").pending === "1") }));
  app.openapi(
    createRoute({ method: "post", path: "/runs/{id}/approvals/{approvalId}", tags: ["approvals"], request: { params: z.object({ id: z.string(), approvalId: z.string() }), body: { content: { "application/json": { schema: z.object({ decision: z.enum(["granted", "denied"]) }) } } } }, responses: { 200: json(Any, "Decision recorded; the merchant continues"), 404: json(Err, "Unknown approval"), 409: json(Err, "Already decided") } }),
    async (c) => {
      const { id, approvalId } = c.req.valid("param");
      return c.json(await manager.decide(id, approvalId, c.req.valid("json").decision));
    },
  );

  app.openapi(createRoute({ method: "get", path: "/runs/{id}/report", tags: ["report"], request: { params: IdParam, query: z.object({ format: z.enum(["json", "md"]).default("json") }) }, responses: { 200: { description: "Agent-readiness report (JSON or Markdown)", content: { "application/json": { schema: Any }, "text/markdown": { schema: z.string() } } }, 404: json(Err, "Unknown run") } }), async (c) => {
    const report = await manager.report(c.req.valid("param").id);
    if (c.req.valid("query").format === "md") return c.text(renderMarkdown(report), 200, { "Content-Type": "text/markdown; charset=utf-8" }) as never;
    return c.json(report);
  });
  app.openapi(createRoute({ method: "get", path: "/runs/{id}/findings", tags: ["report"], request: { params: IdParam }, responses: { 200: json(Any, "Findings only") } }), async (c) => c.json({ findings: (await manager.report(c.req.valid("param").id)).findings }));
  app.openapi(createRoute({ method: "get", path: "/runs/{id}/personas", tags: ["runs"], request: { params: IdParam }, responses: { 200: json(Any, "Shopper personas of the run") } }), async (c) => c.json({ personas: await store.listPersonas(c.req.valid("param").id) }));
  app.openapi(createRoute({ method: "get", path: "/runs/{id}/webhooks", tags: ["webhooks"], request: { params: IdParam }, responses: { 200: json(Any, "Webhooks matched to this run, with lag") } }), async (c) => c.json({ webhooks: await store.listWebhooks(c.req.valid("param").id) }));
  app.openapi(
    createRoute({ method: "post", path: "/runs/{id}/rerun", tags: ["runs"], request: { params: IdParam, body: { content: { "application/json": { schema: z.object({ merchantProfile: z.enum(["baseline", "hardened"]).optional(), name: z.string().optional() }) } } } }, responses: { 201: json(Any, "New run started with the same config (and credentials) and the given merchant profile") } }),
    async (c) => {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      const r = await manager.rerun(c.req.valid("param").id, c.req.valid("json"), ip);
      const { credentialsEnc: _e, ...run } = r.run;
      return c.json({ ...run, modes: r.modes, estimate: r.estimate, rerunOf: c.req.valid("param").id }, 201);
    },
  );

  // --- SSE --------------------------------------------------------------------------------------
  app.openAPIRegistry.registerPath({ method: "get", path: "/runs/{id}/events", tags: ["runs"], summary: "Live event stream (SSE)", description: "Server-sent events. `?since=<eventId>` replays from the log first (also honours Last-Event-ID). Heartbeat comment every 15 s. Sends `event: done` when the run has finished.", request: { params: IdParam, query: z.object({ since: z.coerce.number().int().nonnegative().optional() }) }, responses: { 200: { description: "text/event-stream" } } });
  app.get("/runs/:id/events", async (c) => {
    const id = c.req.param("id");
    const run = await store.getRun(id);
    if (!run) return c.json({ error: "run not found" }, 404);
    const since = Number(c.req.query("since") ?? c.req.header("Last-Event-ID") ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      let last = since;
      let closed = false;
      const queue: Array<{ id: number; data: string }> = [];
      const unsub = bus.subscribe(id, (e) => {
        queue.push({ id: e.id ?? 0, data: JSON.stringify(e) });
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
      });
      for (const e of await store.listEvents(id, since)) {
        await stream.writeSSE({ id: String(e.id), event: "event", data: JSON.stringify(e) });
        last = e.id ?? last;
      }
      const finishedTypes = new Set(["run.finished"]);
      let done = !manager.active.has(id) && (run.status.startsWith("finished") || run.status === "stopped" || run.status === "failed");
      let lastBeat = Date.now();
      while (!closed && !done) {
        while (queue.length) {
          const item = queue.shift()!;
          if (item.id <= last) continue;
          last = item.id;
          await stream.writeSSE({ id: String(item.id), event: "event", data: item.data });
          if (finishedTypes.has((JSON.parse(item.data) as { type: string }).type)) done = true;
        }
        if (done) break;
        if (Date.now() - lastBeat > 15_000) {
          await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
          lastBeat = Date.now();
        }
        await stream.sleep(250);
        if (!manager.active.has(id)) {
          const fresh = await store.getRun(id);
          if (fresh && fresh.status !== "running" && fresh.status !== "paused" && fresh.status !== "created") done = true;
        }
      }
      unsub();
      if (!closed) await stream.writeSSE({ event: "done", data: JSON.stringify({ runId: id, last }) });
    });
  });

  // --- webhooks ---------------------------------------------------------------------------------
  app.openAPIRegistry.registerPath({ method: "post", path: "/webhooks/paypal", tags: ["webhooks"], summary: "PayPal webhook receiver", description: "Register this URL in the PayPal developer dashboard (Sandbox → Webhooks). Signature is verified with PAYPAL_WEBHOOK_ID when set; unverified deliveries are stored but flagged.", responses: { 200: { description: "Always 200 so PayPal does not retry forever" } } });
  // POST / is an alias: a webhook registered in PayPal with the bare host still reaches the receiver.
  app.on("POST", ["/webhooks/paypal", "/"], async (c) => {
    const raw = await c.req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 200);
    }
    const e = env();
    let verified = false;
    if (e.webhookId && e.paypal) {
      try {
        const { PayPalRest } = await import("@swarm/paypal");
        verified = await new PayPalRest(e.paypal).verifyWebhookSignature({ headers: Object.fromEntries(["PAYPAL-AUTH-ALGO", "PAYPAL-CERT-URL", "PAYPAL-TRANSMISSION-ID", "PAYPAL-TRANSMISSION-SIG", "PAYPAL-TRANSMISSION-TIME"].map((h) => [h, c.req.header(h)])), rawBody: raw, webhookId: e.webhookId });
      } catch (err) {
        console.warn("webhook verification failed", err);
      }
    }
    const result = await handleWebhook({ store, bus, manager }, { body, verified, source: "http" });
    return c.json({ ok: true, verified, ...result }, 200);
  });

  // --- Launcher: one sentence to a run config -----------------------------------------------------
  app.openAPIRegistry.registerPath({ method: "post", path: "/ai/plan-run", tags: ["runs"], summary: "Turn one sentence into a run config to confirm (LLM with a strict schema, keyword parser without a key)", request: { body: { content: { "application/json": { schema: PlanRequestSchema } } } }, responses: { 200: { description: "{ plan, config, source: llm | heuristic, usage }" } } });
  app.post("/ai/plan-run", async (c) => {
    const parsed = PlanRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const apiKey = c.req.header("x-openrouter-key") || undefined;
    return c.json(await planRun(parsed.data, { env: env(), apiKey }));
  });

  // --- AG Studio analyst turn -------------------------------------------------------------------
  app.openAPIRegistry.registerPath({ method: "post", path: "/ai/studio-turn", tags: ["studio"], summary: "LLM turn for the AG Studio analyst (NDJSON stream of AG-UI style frames)", request: { body: { content: { "application/json": { schema: StudioTurnSchema } } } }, responses: { 200: { description: "application/x-ndjson: RUN_STARTED, TEXT_MESSAGE_CHUNK, TOOL_CALL_START/ARGS/END, RUN_FINISHED | RUN_ERROR" } } });
  app.post("/ai/studio-turn", async (c) => {
    const parsed = StudioTurnSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const apiKey = c.req.header("x-openrouter-key") || undefined;
    const encoder = new TextEncoder();
    const gen = studioTurn(parsed.data, { env: env(), manager, apiKey });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      },
      cancel() {
        void gen.return(undefined);
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
  });

  // --- docs -------------------------------------------------------------------------------------
  app.doc("/openapi.json", { openapi: "3.0.0", info: { title: "Swarm API", version: SWARM_VERSION, description: "Agentic-commerce flight simulator for PayPal merchants: start runs, stream events, approve refunds, read the readiness report." }, servers: [{ url: env().publicUrl ?? `http://localhost:${env().port}` }] });
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));
  app.get("/", (c) => c.redirect("/docs"));
  return app;
}
