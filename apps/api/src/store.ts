import type { Finding, NewEvent, Persona, RunConfig, SwarmEvent } from "@swarm/core";
import { MemoryCacheStore, type CacheStore, type EventSink } from "@swarm/agents";
import { and, arrayOverlaps, asc, desc, eq, gt, sql } from "drizzle-orm";
import { approvals, events, findings, getDb, llmCache, personas, runs, webhooks, type Db } from "@swarm/db";

export interface RunRow {
  id: string;
  name: string;
  scenario: string;
  /** Config with secrets removed. */
  config: RunConfig;
  merchantProfile: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  score?: Record<string, unknown> | null;
  credentialsEnc?: string | null;
  tokenCap: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  createdAt: string;
}
export interface ApprovalRow {
  id: string;
  runId: string;
  kind: string;
  payload: Record<string, unknown>;
  status: "pending" | "granted" | "denied" | "timeout";
  requestedAt: string;
  decidedAt?: string | null;
}
export interface WebhookRow {
  id?: number;
  runId?: string | null;
  eventType: string;
  resourceId?: string | null;
  receivedAt: string;
  raw: Record<string, unknown>;
  matchedEventId?: number | null;
  lagMs?: number | null;
  verified: boolean;
}

export interface Store extends EventSink {
  readonly kind: "memory" | "postgres";
  readonly cache: CacheStore;
  createRun(row: RunRow): Promise<void>;
  updateRun(id: string, patch: Partial<RunRow>): Promise<void>;
  getRun(id: string): Promise<RunRow | undefined>;
  listRuns(limit?: number): Promise<RunRow[]>;
  listEvents(runId: string, since?: number, limit?: number): Promise<SwarmEvent[]>;
  findEventByPayPalIds(ids: string[]): Promise<SwarmEvent | undefined>;
  savePersonas(runId: string, list: Persona[]): Promise<void>;
  listPersonas(runId: string): Promise<Persona[]>;
  saveFindings(runId: string, list: Finding[]): Promise<void>;
  listFindings(runId: string): Promise<Finding[]>;
  openApproval(row: ApprovalRow): Promise<void>;
  getApproval(id: string): Promise<ApprovalRow | undefined>;
  decideApproval(id: string, status: ApprovalRow["status"]): Promise<boolean>;
  listApprovals(runId: string, onlyPending?: boolean): Promise<ApprovalRow[]>;
  insertWebhook(row: WebhookRow): Promise<WebhookRow>;
  listWebhooks(runId: string): Promise<WebhookRow[]>;
  ping(): Promise<boolean>;
}

type Emitted = NewEvent & { simT: number; t: string; paypalIds: string[] };

// ---------------------------------------------------------------------------------------------
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  readonly cache = new MemoryCacheStore();
  private runs = new Map<string, RunRow>();
  private events = new Map<string, SwarmEvent[]>();
  private nextEventId = 1;
  private personas = new Map<string, Persona[]>();
  private findings = new Map<string, Finding[]>();
  private approvals = new Map<string, ApprovalRow>();
  private webhooks: WebhookRow[] = [];

  async emit(e: Emitted) {
    const full: SwarmEvent = { ...e, id: this.nextEventId++ };
    const arr = this.events.get(e.runId) ?? [];
    arr.push(full);
    this.events.set(e.runId, arr);
    return full;
  }
  async list(runId: string) {
    return [...(this.events.get(runId) ?? [])];
  }
  async listEvents(runId: string, since = 0, limit = 5000) {
    return (this.events.get(runId) ?? []).filter((e) => (e.id ?? 0) > since).slice(0, limit);
  }
  async findEventByPayPalIds(ids: string[]) {
    for (const arr of this.events.values()) for (let i = arr.length - 1; i >= 0; i--) if (arr[i]!.paypalIds.some((x) => ids.includes(x)) && arr[i]!.type !== "webhook.received") return arr[i];
    return undefined;
  }
  async createRun(row: RunRow) {
    this.runs.set(row.id, row);
  }
  async updateRun(id: string, patch: Partial<RunRow>) {
    const r = this.runs.get(id);
    if (r) this.runs.set(id, { ...r, ...patch });
  }
  async getRun(id: string) {
    return this.runs.get(id);
  }
  async listRuns(limit = 50) {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async savePersonas(runId: string, list: Persona[]) {
    this.personas.set(runId, list);
  }
  async listPersonas(runId: string) {
    return this.personas.get(runId) ?? [];
  }
  async saveFindings(runId: string, list: Finding[]) {
    this.findings.set(runId, list);
  }
  async listFindings(runId: string) {
    return this.findings.get(runId) ?? [];
  }
  async openApproval(row: ApprovalRow) {
    this.approvals.set(row.id, row);
  }
  async getApproval(id: string) {
    return this.approvals.get(id);
  }
  async decideApproval(id: string, status: ApprovalRow["status"]) {
    const a = this.approvals.get(id);
    if (!a || a.status !== "pending") return false;
    a.status = status;
    a.decidedAt = new Date().toISOString();
    return true;
  }
  async listApprovals(runId: string, onlyPending = false) {
    return [...this.approvals.values()].filter((a) => a.runId === runId && (!onlyPending || a.status === "pending"));
  }
  async insertWebhook(row: WebhookRow) {
    const r = { ...row, id: this.webhooks.length + 1 };
    this.webhooks.push(r);
    return r;
  }
  async listWebhooks(runId: string) {
    return this.webhooks.filter((w) => w.runId === runId);
  }
  async ping() {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
class DbCacheStore implements CacheStore {
  readonly stats = { hits: 0, misses: 0 };
  constructor(private readonly db: Db) {}
  async get(hash: string) {
    const row = (await this.db.select().from(llmCache).where(eq(llmCache.hash, hash)).limit(1))[0];
    if (!row) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    void this.db.update(llmCache).set({ hits: sql`${llmCache.hits} + 1` }).where(eq(llmCache.hash, hash));
    return row.responseJson;
  }
  async set(hash: string, model: string, value: unknown) {
    await this.db.insert(llmCache).values({ hash, model, responseJson: value as Record<string, unknown> }).onConflictDoNothing();
  }
}

export class DbStore implements Store {
  readonly kind = "postgres" as const;
  readonly cache: CacheStore;
  constructor(private readonly db: Db = getDb()) {
    this.cache = new DbCacheStore(this.db);
  }
  private toEvent(r: typeof events.$inferSelect): SwarmEvent {
    return { id: r.id, runId: r.runId, t: r.t.toISOString(), simT: r.simT, actor: r.actor, actorClass: r.actorClass as SwarmEvent["actorClass"], type: r.type as SwarmEvent["type"], payload: r.payloadJson, paypalIds: r.paypalIds };
  }
  private toRun(r: typeof runs.$inferSelect): RunRow {
    return { id: r.id, name: r.name, scenario: r.scenario, config: r.configJson as unknown as RunConfig, merchantProfile: r.merchantProfile, status: r.status, startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null, score: r.scoreJson ?? null, credentialsEnc: r.credentialsEnc, tokenCap: r.tokenCap, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: Number(r.costUsd), createdAt: r.createdAt.toISOString() };
  }
  async emit(e: Emitted) {
    const [row] = await this.db.insert(events).values({ runId: e.runId, t: new Date(e.t), simT: e.simT, actor: e.actor, actorClass: e.actorClass, type: e.type, payloadJson: e.payload, paypalIds: e.paypalIds }).returning();
    return this.toEvent(row!);
  }
  async list(runId: string) {
    return (await this.db.select().from(events).where(eq(events.runId, runId)).orderBy(asc(events.id))).map((r) => this.toEvent(r));
  }
  async listEvents(runId: string, since = 0, limit = 5000) {
    return (await this.db.select().from(events).where(and(eq(events.runId, runId), gt(events.id, since))).orderBy(asc(events.id)).limit(limit)).map((r) => this.toEvent(r));
  }
  async findEventByPayPalIds(ids: string[]) {
    if (ids.length === 0) return undefined;
    const row = (await this.db.select().from(events).where(and(arrayOverlaps(events.paypalIds, ids), sql`${events.type} <> 'webhook.received'`)).orderBy(desc(events.id)).limit(1))[0];
    return row ? this.toEvent(row) : undefined;
  }
  async createRun(row: RunRow) {
    await this.db.insert(runs).values({ id: row.id, name: row.name, scenario: row.scenario, configJson: row.config as unknown as Record<string, unknown>, merchantProfile: row.merchantProfile, status: row.status, credentialsEnc: row.credentialsEnc ?? null, tokenCap: row.tokenCap, startedAt: row.startedAt ? new Date(row.startedAt) : null });
  }
  async updateRun(id: string, patch: Partial<RunRow>) {
    const set: Partial<typeof runs.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
    if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt ? new Date(patch.finishedAt) : null;
    if (patch.score !== undefined) set.scoreJson = patch.score ?? null;
    if (patch.tokensIn !== undefined) set.tokensIn = patch.tokensIn;
    if (patch.tokensOut !== undefined) set.tokensOut = patch.tokensOut;
    if (patch.costUsd !== undefined) set.costUsd = String(patch.costUsd);
    if (patch.credentialsEnc !== undefined) set.credentialsEnc = patch.credentialsEnc;
    if (Object.keys(set).length) await this.db.update(runs).set(set).where(eq(runs.id, id));
  }
  async getRun(id: string) {
    const r = (await this.db.select().from(runs).where(eq(runs.id, id)).limit(1))[0];
    return r ? this.toRun(r) : undefined;
  }
  async listRuns(limit = 50) {
    return (await this.db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit)).map((r) => this.toRun(r));
  }
  async savePersonas(runId: string, list: Persona[]) {
    if (!list.length) return;
    await this.db.insert(personas).values(list.map((p) => ({ id: `${runId}:${p.id}`, runId, name: p.name, traitsJson: p as unknown as Record<string, unknown>, budget: String(p.budget), intent: p.intent, cardBrand: p.cardBrand, seed: p.seed % 2_147_483_647 }))).onConflictDoNothing();
  }
  async listPersonas(runId: string) {
    return (await this.db.select().from(personas).where(eq(personas.runId, runId))).map((r) => r.traitsJson as unknown as Persona);
  }
  async saveFindings(runId: string, list: Finding[]) {
    await this.db.delete(findings).where(eq(findings.runId, runId));
    if (list.length) await this.db.insert(findings).values(list.map((f) => ({ runId, rule: f.rule, severity: f.severity, title: f.title, fix: f.fix, eventIds: f.eventIds, paypalIds: f.paypalIds })));
  }
  async listFindings(runId: string) {
    return (await this.db.select().from(findings).where(eq(findings.runId, runId))).map((r) => ({ rule: r.rule, severity: r.severity as Finding["severity"], dimension: "resilience" as const, title: r.title, detail: "", fix: r.fix, eventIds: r.eventIds, paypalIds: r.paypalIds }));
  }
  async openApproval(row: ApprovalRow) {
    await this.db.insert(approvals).values({ id: row.id, runId: row.runId, kind: row.kind, payloadJson: row.payload, status: row.status, requestedAt: new Date(row.requestedAt) });
  }
  async getApproval(id: string) {
    const r = (await this.db.select().from(approvals).where(eq(approvals.id, id)).limit(1))[0];
    return r ? { id: r.id, runId: r.runId, kind: r.kind, payload: r.payloadJson, status: r.status as ApprovalRow["status"], requestedAt: r.requestedAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null } : undefined;
  }
  async decideApproval(id: string, status: ApprovalRow["status"]) {
    const res = await this.db.update(approvals).set({ status, decidedAt: new Date() }).where(and(eq(approvals.id, id), eq(approvals.status, "pending"))).returning({ id: approvals.id });
    return res.length > 0;
  }
  async listApprovals(runId: string, onlyPending = false) {
    const rows = await this.db.select().from(approvals).where(onlyPending ? and(eq(approvals.runId, runId), eq(approvals.status, "pending")) : eq(approvals.runId, runId)).orderBy(asc(approvals.requestedAt));
    return rows.map((r) => ({ id: r.id, runId: r.runId, kind: r.kind, payload: r.payloadJson, status: r.status as ApprovalRow["status"], requestedAt: r.requestedAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null }));
  }
  async insertWebhook(row: WebhookRow) {
    const [r] = await this.db.insert(webhooks).values({ runId: row.runId ?? null, eventType: row.eventType, resourceId: row.resourceId ?? null, receivedAt: new Date(row.receivedAt), rawJson: row.raw, matchedEventId: row.matchedEventId ?? null, lagMs: row.lagMs ?? null, verified: row.verified ? 1 : 0 }).returning();
    return { ...row, id: r!.id };
  }
  async listWebhooks(runId: string) {
    return (await this.db.select().from(webhooks).where(eq(webhooks.runId, runId)).orderBy(asc(webhooks.id))).map((r) => ({ id: r.id, runId: r.runId, eventType: r.eventType, resourceId: r.resourceId, receivedAt: r.receivedAt.toISOString(), raw: r.rawJson, matchedEventId: r.matchedEventId, lagMs: r.lagMs, verified: r.verified === 1 }));
  }
  async ping() {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }
}
