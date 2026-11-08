import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { extractPayPalIds, redactDeep, SimClock, type ActorClass, type EventType, type NewEvent, type Persona, type RunConfig, type Scenario, type SwarmEvent } from "@swarm/core";
import type { PayPalBackend } from "@swarm/paypal";
import type { BudgetGuard } from "./budget";
import type { CacheStore } from "./cache";
import type { LlmFactory } from "./llm";

// ---------------------------------------------------------------------------------------------
// Event sink
// ---------------------------------------------------------------------------------------------
export interface EventSink {
  emit(e: NewEvent & { simT: number; t: string; paypalIds: string[] }): Promise<SwarmEvent>;
  list(runId: string): Promise<SwarmEvent[]>;
}

export class MemoryEventSink implements EventSink {
  readonly events: SwarmEvent[] = [];
  private nextId = 1;
  private listeners = new Set<(e: SwarmEvent) => void>();
  async emit(e: NewEvent & { simT: number; t: string; paypalIds: string[] }): Promise<SwarmEvent> {
    const full: SwarmEvent = { ...e, id: this.nextId++ };
    this.events.push(full);
    for (const l of this.listeners) l(full);
    return full;
  }
  async list(runId: string) {
    return this.events.filter((e) => e.runId === runId);
  }
  on(l: (e: SwarmEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

// ---------------------------------------------------------------------------------------------
// Human-in-the-loop approvals
// ---------------------------------------------------------------------------------------------
export type ApprovalKind = "refund" | "accept_claim" | "other";
export interface ApprovalRequest {
  runId: string;
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  timeoutMs: number;
}
export type Decision = "granted" | "denied" | "timeout";
export interface ApprovalGate {
  /** Must persist (or at least register) the request BEFORE returning the id so a restart can find it. */
  open(req: ApprovalRequest): Promise<string>;
  wait(id: string, timeoutMs: number): Promise<Decision>;
  decide(id: string, decision: "granted" | "denied"): boolean;
  pending(runId: string): Array<{ id: string; kind: ApprovalKind; payload: Record<string, unknown>; requestedAt: string }>;
}

export class MemoryApprovalGate implements ApprovalGate {
  private items = new Map<string, { runId: string; kind: ApprovalKind; payload: Record<string, unknown>; requestedAt: string; resolve?: (d: Decision) => void; decision?: Decision }>();
  constructor(private readonly auto?: "granted" | "denied") {}
  async open(req: ApprovalRequest) {
    const id = `apr_${randomUUID().slice(0, 8)}`;
    this.items.set(id, { runId: req.runId, kind: req.kind, payload: req.payload, requestedAt: new Date().toISOString() });
    return id;
  }
  wait(id: string, timeoutMs: number): Promise<Decision> {
    const it = this.items.get(id);
    if (!it) return Promise.resolve("denied");
    if (it.decision) return Promise.resolve(it.decision);
    if (this.auto) {
      it.decision = this.auto;
      return Promise.resolve(this.auto);
    }
    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      const finish = (d: Decision) => {
        clearTimeout(timer);
        it.decision = d;
        resolve(d);
      };
      it.resolve = finish;
    });
  }
  decide(id: string, decision: "granted" | "denied") {
    const it = this.items.get(id);
    if (!it || it.decision) return false;
    if (it.resolve) it.resolve(decision);
    else it.decision = decision;
    return true;
  }
  pending(runId: string) {
    return [...this.items.entries()].filter(([, v]) => v.runId === runId && !v.decision).map(([id, v]) => ({ id, kind: v.kind, payload: v.payload, requestedAt: v.requestedAt }));
  }
}

// ---------------------------------------------------------------------------------------------
// Run control (pause / resume / stop)
// ---------------------------------------------------------------------------------------------
export class RunControl {
  private _paused = false;
  private _stopped = false;
  private _stopReason: string | undefined;
  private waiters: Array<() => void> = [];
  readonly abort = new AbortController();
  constructor() {
    // Dozens of concurrent sleeps/waits legitimately listen on one signal.
    setMaxListeners(500, this.abort.signal);
  }
  get paused() {
    return this._paused;
  }
  get stopped() {
    return this._stopped;
  }
  get stopReason() {
    return this._stopReason;
  }
  pause() {
    this._paused = true;
  }
  resume() {
    this._paused = false;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  stop(reason = "stopped") {
    if (this._stopped) return;
    this._stopped = true;
    this._stopReason = reason;
    this.resume();
    this.abort.abort();
  }
  /** Resolves immediately unless paused; stop() also releases waiters. */
  waitIfPaused(): Promise<void> {
    if (!this._paused || this._stopped) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}

// ---------------------------------------------------------------------------------------------
// Inboxes
// ---------------------------------------------------------------------------------------------
export class Inbox<T> {
  private items: T[] = [];
  private waiters: Array<() => void> = [];
  push(item: T) {
    this.items.push(item);
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  take(): T | undefined {
    return this.items.shift();
  }
  takeAll(): T[] {
    const all = this.items;
    this.items = [];
    return all;
  }
  get size() {
    return this.items.length;
  }
  /** Wait until something arrives, a timeout passes, or the signal fires. Returns true when an item is available. */
  wait(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.items.length) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      };
      const timer = setTimeout(() => done(this.items.length > 0), timeoutMs);
      const onAbort = () => done(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(() => done(true));
    });
  }
}

export type MerchantInboxItem =
  | { kind: "approved"; orderId: string; personaId: string; replay?: boolean }
  | { kind: "message"; personaId: string; personaName: string; text: string; orderId?: string }
  | { kind: "dispute"; disputeId: string; orderId?: string; captureId: string; amount: string; reason: string };

export type ShopperInboxItem = { kind: "message"; text: string } | { kind: "status"; orderId: string; status: "captured" | "declined" | "shipped" | "refunded"; detail?: string };

// ---------------------------------------------------------------------------------------------
// Catalog + orders
// ---------------------------------------------------------------------------------------------
export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  description: string;
  tags: string[];
  injected?: boolean;
}

export interface OrderRecord {
  orderId: string;
  personaId: string;
  personaName: string;
  amount: number;
  currency: string;
  items: Array<{ name: string; productId?: string; quantity: number; price: number }>;
  status: "created" | "approved" | "captured" | "declined" | "refunded" | "disputed";
  captureId?: string;
  captureStatus?: string;
  refunded: number;
  shipped?: { trackingNumber: string; simT: number };
  disputeIds: string[];
  createdSimT: number;
  approvedSimT?: number;
  capturedSimT?: number;
  catalogPosition?: number;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------
export interface Pacing {
  /** Real ms a scripted agent waits between steps. */
  stepMs: number;
  chaosTickMs: number;
  analystIntervalMs: number;
  /** Real ms to let the merchant finish after the last shopper. */
  drainMs: number;
  /** Real ms between simulated-hour jumps in the settle phase. */
  settleStepMs: number;
}
export const DEFAULT_PACING: Pacing = { stepMs: 700, chaosTickMs: 1000, analystIntervalMs: 60_000, drainMs: 15_000, settleStepMs: 1500 };

export interface WorldOptions {
  runId: string;
  scenario: Scenario;
  config: RunConfig;
  clock: SimClock;
  sink: EventSink;
  backend: PayPalBackend;
  approvals: ApprovalGate;
  budget: BudgetGuard;
  llm: LlmFactory | null;
  cache?: CacheStore;
  personas: Persona[];
  catalog: CatalogItem[];
  control: RunControl;
  pacing: Pacing;
  models: { shopper: string; merchant: string; analyst: string };
  /** Which code path creates shopper orders: toolkit create_order or Server SDK without payment_source. */
  orderCreatePath: "toolkit" | "server";
  log?: (msg: string) => void;
}

export class World {
  readonly orders = new Map<string, OrderRecord>();
  readonly merchantInbox = new Inbox<MerchantInboxItem>();
  readonly shopperInboxes = new Map<string, Inbox<ShopperInboxItem>>();
  readonly counts = new Map<string, number>();
  readonly captureLatenciesSim: number[] = [];
  readonly flags = { captureLock: new Set<string>() };
  /** True while the merchant is inside a turn: the inbox is already empty then, but the work is not done. */
  merchantBusy = false;
  private shoppersDone = 0;

  constructor(readonly o: WorldOptions) {
    for (const p of o.personas) this.shopperInboxes.set(p.id, new Inbox());
  }

  get runId() {
    return this.o.runId;
  }
  get llmMode(): "live" | "scripted" {
    return this.o.llm ? "live" : "scripted";
  }
  get merchantProfile() {
    return this.o.config.merchantProfile;
  }
  get hardened() {
    return this.o.config.merchantProfile === "hardened";
  }

  count(type: string) {
    return this.counts.get(type) ?? 0;
  }
  personaById(id: string) {
    return this.o.personas.find((p) => p.id === id);
  }
  inboxFor(personaId: string) {
    let ib = this.shopperInboxes.get(personaId);
    if (!ib) {
      ib = new Inbox();
      this.shopperInboxes.set(personaId, ib);
    }
    return ib;
  }
  markShopperDone() {
    this.shoppersDone++;
  }
  get allShoppersDone() {
    return this.shoppersDone >= this.o.personas.length;
  }

  /** The catalog as this persona sees it: a stable per-persona shuffle, so position bias is measurable. */
  catalogViewFor(persona: Persona): CatalogItem[] {
    const cat = this.o.catalog;
    return persona.catalogOrder.filter((i) => i < cat.length).map((i) => cat[i]!);
  }

  async emit(type: EventType, actor: string, actorClass: ActorClass, payload: Record<string, unknown> = {}, paypalIds: string[] = []): Promise<SwarmEvent> {
    this.counts.set(type, this.count(type) + 1);
    const safe = redactDeep(payload) as Record<string, unknown>;
    const ids = [...new Set([...paypalIds, ...extractPayPalIds(safe)])];
    return this.o.sink.emit({ runId: this.o.runId, type, actor, actorClass, payload: safe, paypalIds: ids, simT: this.o.clock.now(), t: new Date().toISOString() });
  }

  async sleep(ms: number) {
    if (this.o.control.stopped) return;
    const signal = this.o.control.abort.signal;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  log(msg: string) {
    this.o.log?.(msg);
  }

  /** Opens an approval, emits the request before waiting, and emits the decision. */
  async approve(kind: ApprovalKind, actor: string, payload: Record<string, unknown>): Promise<Decision> {
    const timeoutMs = this.o.config.approvalTimeoutSec * 1000;
    const id = await this.o.approvals.open({ runId: this.o.runId, kind, payload, timeoutMs });
    await this.emit("approval.requested", actor, "merchant", { approvalId: id, kind, ...payload });
    const decision = await this.o.approvals.wait(id, timeoutMs);
    await this.emit(decision === "granted" ? "approval.granted" : "approval.denied", decision === "granted" || decision === "denied" ? "human" : "platform", decision === "timeout" ? "platform" : "human", { approvalId: id, kind, decision });
    return decision;
  }
}
