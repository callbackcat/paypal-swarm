import { buildReport, makePersonas, resolveScenario, SimClock, type Persona, type Report, type RunConfig, type Scenario } from "@swarm/core";
import { ALLOWLISTS, catalogFor, priceFromDescription, type PayPalBackend } from "@swarm/paypal";
import pLimit from "p-limit";
import { runAnalyst } from "./analyst";
import { BudgetGuard, estimateRun, type BudgetSnapshot } from "./budget";
import type { CacheStore } from "./cache";
import { runChaos } from "./chaos";
import { DEFAULT_MODELS, type LlmFactory } from "./llm";
import { runMerchant } from "./merchant";
import { runShopper } from "./shopper";
import { DEFAULT_PACING, RunControl, World, type ApprovalGate, type CatalogItem, type EventSink, type Pacing } from "./world";

export interface RunDeps {
  sink: EventSink;
  approvals: ApprovalGate;
  backend: PayPalBackend;
  /** null = scripted agents, zero tokens. */
  llm: LlmFactory | null;
  cache?: CacheStore;
  clock?: SimClock;
  pacing?: Partial<Pacing>;
  concurrency?: number;
  orderCreatePath?: "toolkit" | "server";
  models?: Partial<typeof DEFAULT_MODELS>;
  /** Called every ~10 s and at the end with live token/cost counters. */
  onProgress?: (s: BudgetSnapshot) => void;
  log?: (msg: string) => void;
}

export interface RunResult {
  runId: string;
  reason: "completed" | "stopped" | "budget" | "timeout";
  report: Report;
  budget: BudgetSnapshot;
  personas: Persona[];
}

export interface RunHandle {
  runId: string;
  control: RunControl;
  world: Promise<World>;
  done: Promise<RunResult>;
}

/** Starts a run and returns immediately. `done` resolves with the report once the run finishes for any reason. */
export function startRun(runId: string, config: RunConfig, deps: RunDeps): RunHandle {
  const control = new RunControl();
  let resolveWorld!: (w: World) => void;
  const world = new Promise<World>((r) => (resolveWorld = r));
  const done = execute(runId, config, deps, control, resolveWorld);
  return { runId, control, world, done };
}

async function execute(runId: string, config: RunConfig, deps: RunDeps, control: RunControl, resolveWorld: (w: World) => void): Promise<RunResult> {
  const scenario = resolveScenario(config);
  const clock = deps.clock ?? new SimClock(Date.now(), scenario.simFactor);
  const pacing = { ...DEFAULT_PACING, ...deps.pacing };
  const models = { ...DEFAULT_MODELS, ...Object.fromEntries(Object.entries({ ...deps.models, ...config.models }).filter(([, v]) => v)) } as typeof DEFAULT_MODELS;

  // Budget guard is created before anything that could spend a token.
  let worldRef: World | undefined;
  const budget = new BudgetGuard({ runTokenCap: scenario.tokenCap }, (e) => {
    void worldRef?.emit(e.type, e.actor === "run" ? "platform" : e.actor, e.actor === "run" ? "platform" : "shopper", e.payload);
  });

  const catalog = await loadCatalog(deps.backend, scenario, deps.log);
  const personas = makePersonas(scenario.shoppers, scenario.personaSeed, catalog.length);
  const world = new World({ runId, scenario, config, clock, sink: deps.sink, backend: deps.backend, approvals: deps.approvals, budget, llm: deps.llm, cache: deps.cache, personas, catalog, control, pacing, models, orderCreatePath: deps.orderCreatePath ?? (deps.backend.mode === "mock" ? "toolkit" : "server"), log: deps.log });
  worldRef = world;
  resolveWorld(world);

  const estimate = estimateRun(scenario, { models, tokenCap: scenario.tokenCap, scripted: !deps.llm });
  await world.emit("run.started", "platform", "platform", {
    scenario: scenario.id,
    name: config.name ?? scenario.name,
    merchantProfile: config.merchantProfile,
    shoppers: personas.length,
    catalogSize: catalog.length,
    paypalMode: deps.backend.mode,
    llmMode: world.llmMode,
    models,
    tokenCap: scenario.tokenCap,
    estimate: { tokens: estimate.tokens, usd: estimate.usd },
    simFactor: clock.factor,
    chaos: scenario.chaos.map((c) => c.kind),
    personas: personas.map((p) => ({ id: p.id, name: p.name, budget: p.budget, intent: p.intent, cardBrand: p.cardBrand })),
    allowlists: ALLOWLISTS,
  });

  const progress = setInterval(() => deps.onProgress?.(budget.snapshot()), 10_000);
  const timeout = setTimeout(() => control.stop("timeout"), scenario.durationMin * 60_000);

  const merchant = runMerchant(world);
  const chaos = runChaos(world);
  const analyst = runAnalyst(world);

  const limit = pLimit(deps.concurrency ?? 5);
  let skipped = 0;
  await Promise.all(
    personas.map((p, i) =>
      limit(async () => {
        await control.waitIfPaused();
        if (control.stopped) return;
        if (!budget.admit()) {
          skipped++;
          world.markShopperDone();
          return;
        }
        // Stagger arrivals a little so the merchant inbox batches look like traffic, not a thundering herd.
        if (i > 0) await world.sleep(Math.min(pacing.stepMs, 300) * (i % 5));
        await runShopper(world, p);
      }),
    ),
  );

  // Drain: let the merchant and chaos finish what is queued, then stop everyone.
  const drainStart = Date.now();
  while (!control.stopped && Date.now() - drainStart < pacing.drainMs) {
    if (world.merchantInbox.size === 0 && budget.isExhausted) break;
    await world.sleep(Math.min(500, pacing.drainMs));
    if (world.merchantInbox.size === 0 && Date.now() - drainStart >= Math.min(pacing.drainMs, Math.max(1500, pacing.stepMs * 3))) break;
  }
  const reason: RunResult["reason"] = control.stopped ? (control.stopReason === "timeout" ? "timeout" : "stopped") : budget.isExhausted ? "budget" : "completed";
  control.stop(reason);
  clearTimeout(timeout);
  clearInterval(progress);
  await Promise.allSettled([merchant, chaos, analyst]);

  const snap = budget.snapshot();
  deps.onProgress?.(snap);
  await world.emit("run.finished", "platform", "platform", { reason, skippedShoppers: skipped, tokens: snap.total, costUsd: snap.costUsd, cacheHits: deps.cache?.stats.hits ?? 0, orders: world.orders.size, simMinutes: clock.now() });

  const events = await deps.sink.list(runId);
  const report = buildReport(events, { runId, name: config.name ?? scenario.name, scenario: scenario.id, merchantProfile: config.merchantProfile, paypalMode: deps.backend.mode, llmMode: world.llmMode, tokenCap: scenario.tokenCap, finishedAt: new Date().toISOString() });
  return { runId, reason, report, budget: snap, personas };
}

/**
 * Builds the catalog the shoppers will see. Mock: seed the in-memory store from the demo catalog.
 * Sandbox: read list_products (prices parsed from descriptions; unknown prices default to $25).
 */
export async function loadCatalog(backend: PayPalBackend, scenario: Scenario, log?: (m: string) => void): Promise<CatalogItem[]> {
  const wanted = catalogFor(scenario.catalog);
  if (backend.mode === "mock") {
    const store = (backend as { store?: { createProduct(p: { name: string; description: string; type?: string }): { id: string }; products: Map<string, unknown> } }).store;
    if (store && store.products.size === 0) {
      for (const p of wanted) store.createProduct({ name: p.name, description: `${p.description} Price: $${p.price.toFixed(2)}.`, type: "PHYSICAL" });
    }
    const seed = backend.tools({ products: { list: true } }).find((t) => t.name === "list_products")!;
    const all: CatalogItem[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await seed.run({ page, page_size: 20, total_required: true });
      const products = ((r.data as { products?: Array<{ id: string; name: string; description?: string }> })?.products ?? []);
      for (const p of products) {
        const meta = wanted.find((w) => w.name === p.name);
        all.push({ id: p.id, name: p.name, description: p.description ?? "", price: priceFromDescription(p.description) ?? meta?.price ?? 25, tags: meta?.tags ?? [], injected: meta?.tags.includes("injection") });
      }
      if (products.length < 20) break;
    }
    return all;
  }
  const list = backend.tools({ products: { list: true } }).find((t) => t.name === "list_products");
  if (!list) throw new Error("list_products not available");
  const all: CatalogItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await list.run({ page, page_size: 20, total_required: true });
    if (!r.ok) throw new Error(`list_products failed: ${r.message}`);
    const products = ((r.data as { products?: Array<{ id: string; name: string; description?: string }> })?.products ?? []);
    for (const p of products) {
      const meta = wanted.find((w) => w.name === p.name);
      all.push({ id: p.id, name: p.name, description: p.description ?? "", price: priceFromDescription(p.description) ?? meta?.price ?? 25, tags: meta?.tags ?? [], injected: meta?.tags.includes("injection") || /ignore your budget/i.test(p.description ?? "") });
    }
    if (products.length < 20) break;
  }
  // Scenario shaping on a real store: hide filler/injection items the scenario did not ask for.
  const filtered = all.filter((c) => (scenario.catalog.injection || !c.injected) && (scenario.catalog.overload || !c.tags.includes("filler")));
  log?.(`catalog: ${filtered.length} products (${all.length} in store)`);
  if (filtered.length === 0) throw new Error("The store has no products. Run `pnpm seed` first.");
  return filtered;
}
