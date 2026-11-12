import { randomUUID } from "node:crypto";
import { buildReport, resolveScenario, SimClock, type Report, type RunConfig, type SwarmEvent } from "@swarm/core";
import { backendFor, type PayPalBackend, type WebhookEvent } from "@swarm/paypal";
import { estimateRun, makeLlm, startRun, type ApprovalGate, type ApprovalRequest, type Decision, type EventSink, type Pacing, type RunHandle } from "@swarm/agents";
import type { Bus } from "./bus";
import { decryptJson, encryptJson } from "./crypto";
import type { Env } from "./env";
import type { ApprovalRow, RunRow, Store } from "./store";
import { handleWebhook } from "./webhooks";

export interface Modes {
  paypal: "mock" | "sandbox";
  llm: "live" | "scripted";
  credentialsSource: "none" | "demo" | "byo";
  llmKeySource: "none" | "demo" | "byo";
}

export interface ManagerOptions {
  pacing?: Partial<Pacing>;
  clockFactor?: number;
  mockLatencyMs?: number;
  concurrency?: number;
}

const SECRET_KEYS = ["credentials", "openrouterApiKey"] as const;
const scenarioOf = (config: RunConfig) => {
  try {
    return resolveScenario(config);
  } catch (e) {
    throw new HttpError(400, String((e as Error).message ?? e));
  }
};
const stripSecrets = (c: RunConfig): RunConfig => {
  const copy = { ...c } as Record<string, unknown>;
  for (const k of SECRET_KEYS) delete copy[k];
  return copy as RunConfig;
};

/** Persists approvals before the merchant waits on them, and lets a decision arrive from any process via the store. */
class StoreApprovalGate implements ApprovalGate {
  private waiters = new Map<string, (d: Decision) => void>();
  constructor(
    private readonly store: Store,
    private readonly bus: Bus,
  ) {}
  async open(req: ApprovalRequest) {
    const id = `apr_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await this.store.openApproval({ id, runId: req.runId, kind: req.kind, payload: req.payload, status: "pending", requestedAt: new Date().toISOString() });
    return id;
  }
  wait(id: string, timeoutMs: number): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      let settled = false;
      const finish = (d: Decision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        this.waiters.delete(id);
        resolve(d);
      };
      const timer = setTimeout(async () => {
        await this.store.decideApproval(id, "timeout");
        finish("timeout");
      }, timeoutMs);
      // Cross-process decisions (another api instance, or a restart) land in the store; poll it gently.
      const poll = setInterval(async () => {
        const row = await this.store.getApproval(id);
        if (row && row.status !== "pending") finish(row.status === "granted" ? "granted" : row.status === "denied" ? "denied" : "timeout");
      }, 2000);
      this.waiters.set(id, finish);
    });
  }
  decide(id: string, decision: "granted" | "denied") {
    const w = this.waiters.get(id);
    if (w) w(decision);
    return !!w;
  }
  pending(): never[] {
    return [];
  }
}

class PublishingSink implements EventSink {
  constructor(
    private readonly store: Store,
    private readonly bus: Bus,
  ) {}
  async emit(e: Parameters<EventSink["emit"]>[0]) {
    const saved = await this.store.emit(e);
    this.bus.publish(saved);
    return saved;
  }
  list(runId: string) {
    return this.store.list(runId);
  }
}

export class RunManager {
  readonly active = new Map<string, { handle: RunHandle; modes: Modes; backend: PayPalBackend; unsubWebhook?: () => void }>();
  readonly gate: StoreApprovalGate;
  private demoUsage = new Map<string, { day: string; tokens: number }>();

  constructor(
    readonly store: Store,
    readonly bus: Bus,
    readonly env: () => Env,
    readonly opts: ManagerOptions = {},
  ) {
    this.gate = new StoreApprovalGate(store, bus);
  }

  resolveModes(config: RunConfig): Modes {
    const env = this.env();
    const byoPaypal = !!config.credentials?.clientId;
    const paypalAvailable = byoPaypal || !!env.paypal;
    const paypal: Modes["paypal"] = config.paypal === "mock" ? "mock" : config.paypal === "sandbox" ? (paypalAvailable ? "sandbox" : "mock") : paypalAvailable ? "sandbox" : "mock";
    const byoKey = !!config.openrouterApiKey;
    const keyAvailable = byoKey || !!env.openrouterKey;
    const llm: Modes["llm"] = config.llm === "scripted" ? "scripted" : config.llm === "live" ? (keyAvailable ? "live" : "scripted") : keyAvailable ? "live" : "scripted";
    return { paypal, llm, credentialsSource: paypal === "mock" ? "none" : byoPaypal ? "byo" : "demo", llmKeySource: llm === "scripted" ? "none" : byoKey ? "byo" : "demo" };
  }

  estimate(config: RunConfig) {
    const scenario = scenarioOf(config);
    const modes = this.resolveModes(config);
    const env = this.env();
    const est = estimateRun(scenario, { models: { ...env.models, ...config.models }, tokenCap: scenario.tokenCap, scripted: modes.llm === "scripted" });
    return { scenario: scenario.id, shoppers: scenario.shoppers, tokenCap: scenario.tokenCap, modes, estimate: est };
  }

  /** Demo-key fence: per-IP daily token allowance when the server's own OpenRouter key is used. */
  allowanceLeft(ip: string): number {
    const env = this.env();
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.demoUsage.get(ip);
    const used = rec && rec.day === day ? rec.tokens : 0;
    return Math.max(0, env.demoDailyTokenCap - used);
  }
  private chargeAllowance(ip: string, tokens: number) {
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.demoUsage.get(ip);
    this.demoUsage.set(ip, { day, tokens: (rec && rec.day === day ? rec.tokens : 0) + tokens });
  }

  async create(config: RunConfig, ctx: { ip?: string; start?: boolean } = {}): Promise<{ run: RunRow; modes: Modes; estimate: ReturnType<typeof estimateRun> }> {
    const scenario = scenarioOf(config);
    const modes = this.resolveModes(config);
    const env = this.env();
    const estimate = estimateRun(scenario, { models: { ...env.models, ...config.models }, tokenCap: scenario.tokenCap, scripted: modes.llm === "scripted" });
    if (estimate.overCap) throw new HttpError(400, `Estimated ${estimate.tokens.toLocaleString()} tokens exceeds the run cap of ${scenario.tokenCap.toLocaleString()}. Lower shoppers, pick a cheaper model, or raise tokenCap.`);
    if (modes.llmKeySource === "demo" && ctx.ip && this.allowanceLeft(ctx.ip) < estimate.tokens) throw new HttpError(429, `Daily demo allowance exhausted for this IP (${env.demoDailyTokenCap.toLocaleString()} tokens/day). Bring your own OpenRouter key or run in scripted mode.`);
    const id = `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const secrets = { credentials: config.credentials, openrouterApiKey: config.openrouterApiKey };
    const row: RunRow = {
      id,
      name: config.name ?? `${scenario.name} · ${config.merchantProfile}`,
      scenario: scenario.id,
      config: { ...stripSecrets(config), shoppers: scenario.shoppers, tokenCap: scenario.tokenCap, personaSeed: scenario.personaSeed },
      merchantProfile: config.merchantProfile,
      status: "created",
      credentialsEnc: secrets.credentials || secrets.openrouterApiKey ? encryptJson(secrets) : null,
      tokenCap: scenario.tokenCap,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      createdAt: new Date().toISOString(),
    };
    await this.store.createRun(row);
    if (ctx.start !== false) await this.start(id, config, ctx.ip);
    return { run: (await this.store.getRun(id)) ?? row, modes, estimate };
  }

  async start(id: string, fullConfig?: RunConfig, ip?: string) {
    const row = await this.store.getRun(id);
    if (!row) throw new HttpError(404, "run not found");
    if (this.active.has(id)) throw new HttpError(409, "run already active");
    const secrets = fullConfig ? { credentials: fullConfig.credentials, openrouterApiKey: fullConfig.openrouterApiKey } : row.credentialsEnc ? decryptJson<{ credentials?: RunConfig["credentials"]; openrouterApiKey?: string }>(row.credentialsEnc) : undefined;
    const config: RunConfig = { ...(fullConfig ?? row.config), credentials: secrets?.credentials, openrouterApiKey: secrets?.openrouterApiKey };
    const modes = this.resolveModes(config);
    const env = this.env();
    const scenario = scenarioOf(config);

    const backend = modes.paypal === "sandbox" ? backendFor(config.credentials ?? env.paypal) : backendFor(undefined, { latencyMs: this.opts.mockLatencyMs ?? 60, webhookDelayMs: 900, webhookDropRate: scenario.id === "lost-parcels" ? 0.3 : 0.05 });
    const apiKey = config.openrouterApiKey ?? env.openrouterKey;
    const llm = modes.llm === "live" && apiKey ? makeLlm({ apiKey, cache: config.llmCache ?? env.llmCache ? this.store.cache : undefined }) : null;
    const sink = new PublishingSink(this.store, this.bus);
    const clock = new SimClock(Date.now(), this.opts.clockFactor ?? scenario.simFactor);

    await this.store.updateRun(id, { status: "running", startedAt: new Date().toISOString() });
    const handle = startRun(id, config, {
      sink,
      approvals: this.gate,
      backend,
      llm,
      cache: llm && (config.llmCache ?? env.llmCache) ? this.store.cache : undefined,
      clock,
      pacing: this.opts.pacing,
      concurrency: this.opts.concurrency,
      models: env.models,
      onProgress: (s) => void this.store.updateRun(id, { tokensIn: s.tokensIn, tokensOut: s.tokensOut, costUsd: s.costUsd }),
      log: (m) => console.log(`[run ${id}] ${m}`),
    });
    const entry: { handle: RunHandle; modes: Modes; backend: PayPalBackend; unsubWebhook?: () => void } = { handle, modes, backend };
    if (backend.onWebhook) entry.unsubWebhook = backend.onWebhook((evt: WebhookEvent) => void handleWebhook({ store: this.store, bus: this.bus, manager: this }, { body: evt as unknown as Record<string, unknown>, verified: true, source: "mock", runId: id }));
    this.active.set(id, entry);
    void handle.world.then((w) => this.store.savePersonas(id, w.o.personas));

    handle.done
      .then(async (res) => {
        await this.store.saveFindings(id, res.report.findings);
        await this.store.updateRun(id, { status: res.reason === "budget" ? "finished_budget" : res.reason === "stopped" ? "stopped" : "finished", finishedAt: new Date().toISOString(), score: { score: res.report.score, stats: res.report.stats, reason: res.reason, modes }, tokensIn: res.budget.tokensIn, tokensOut: res.budget.tokensOut, costUsd: res.budget.costUsd });
        if (modes.llmKeySource === "demo" && ip) this.chargeAllowance(ip, res.budget.total);
      })
      .catch(async (e) => {
        console.error(`[run ${id}] failed`, e);
        await this.store.updateRun(id, { status: "failed", finishedAt: new Date().toISOString(), score: { error: String((e as Error).message ?? e) } });
      })
      .finally(() => {
        entry.unsubWebhook?.();
        this.active.delete(id);
      });
    return modes;
  }

  pause(id: string) {
    const a = this.mustActive(id);
    a.handle.control.pause();
    void a.handle.world.then((w) => w.emit("run.paused", "human", "human", {}));
    void this.store.updateRun(id, { status: "paused" });
  }
  resume(id: string) {
    const a = this.mustActive(id);
    a.handle.control.resume();
    void a.handle.world.then((w) => w.emit("run.resumed", "human", "human", {}));
    void this.store.updateRun(id, { status: "running" });
  }
  stop(id: string) {
    const a = this.mustActive(id);
    a.handle.control.stop("stopped");
  }
  private mustActive(id: string) {
    const a = this.active.get(id);
    if (!a) throw new HttpError(409, "run is not active");
    return a;
  }

  async decide(runId: string, approvalId: string, decision: "granted" | "denied"): Promise<ApprovalRow> {
    const row = await this.store.getApproval(approvalId);
    if (!row || row.runId !== runId) throw new HttpError(404, "approval not found");
    if (row.status !== "pending") throw new HttpError(409, `approval already ${row.status}`);
    await this.store.decideApproval(approvalId, decision);
    this.gate.decide(approvalId, decision);
    return (await this.store.getApproval(approvalId))!;
  }

  async status(id: string) {
    const run = await this.store.getRun(id);
    if (!run) throw new HttpError(404, "run not found");
    const a = this.active.get(id);
    const world = a ? await a.handle.world : undefined;
    const budget = world?.o.budget.snapshot();
    const pending = await this.store.listApprovals(id, true);
    const { credentialsEnc: _enc, ...pub } = run;
    return { ...pub, active: !!a, paused: a?.handle.control.paused ?? false, modes: a?.modes ?? (run.score?.modes as Modes | undefined) ?? null, budget: budget ?? null, pendingApprovals: pending, orders: world ? [...world.orders.values()] : [] };
  }

  async report(id: string): Promise<Report> {
    const run = await this.store.getRun(id);
    if (!run) throw new HttpError(404, "run not found");
    const events = await this.store.list(id);
    const modes = (run.score?.modes as Modes | undefined) ?? this.active.get(id)?.modes;
    return buildReport(events, { runId: id, name: run.name, scenario: run.scenario, merchantProfile: run.merchantProfile, paypalMode: modes?.paypal, llmMode: modes?.llm, tokenCap: run.tokenCap, startedAt: run.startedAt ?? undefined, finishedAt: run.finishedAt ?? undefined });
  }

  /** Whose OpenRouter key a re-run of this run would spend. */
  async rerunKeySource(id: string, patch: Partial<RunConfig>): Promise<Modes["llmKeySource"]> {
    return this.resolveModes(await this.rerunConfig(id, patch)).llmKeySource;
  }

  async rerun(id: string, patch: Partial<RunConfig>, ip?: string) {
    return this.create(await this.rerunConfig(id, patch), { ip, start: true });
  }

  private async rerunConfig(id: string, patch: Partial<RunConfig>): Promise<RunConfig> {
    const run = await this.store.getRun(id);
    if (!run) throw new HttpError(404, "run not found");
    const secrets = run.credentialsEnc ? decryptJson<{ credentials?: RunConfig["credentials"]; openrouterApiKey?: string }>(run.credentialsEnc) : undefined;
    return { ...run.config, ...patch, credentials: secrets?.credentials, openrouterApiKey: secrets?.openrouterApiKey, name: patch.name ?? `${run.name.replace(/ · (baseline|hardened).*$/, "")} · ${patch.merchantProfile ?? run.merchantProfile} (re-run)` };
  }

  /** Route an inbound webhook event into a live run's world (so it gets a sim time) or straight to the store. */
  async recordWebhookEvent(runId: string | undefined, payload: Record<string, unknown>, paypalIds: string[]): Promise<SwarmEvent | undefined> {
    if (!runId) return undefined;
    const a = this.active.get(runId);
    if (a) {
      const w = await a.handle.world;
      return w.emit("webhook.received", "paypal", "paypal", payload, paypalIds);
    }
    const saved = await this.store.emit({ runId, type: "webhook.received", actor: "paypal", actorClass: "paypal", payload, paypalIds, simT: 0, t: new Date().toISOString() });
    this.bus.publish(saved);
    return saved;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
