import type { Scenario } from "@swarm/core";
import { costFor, DEFAULT_MODELS, type Usage } from "./llm";

export type ActorKind = "shopper" | "merchant" | "analyst" | "chaos";

export interface BudgetLimits {
  runTokenCap: number;
  shopperTokenCap: number;
  merchantTokenCap: number;
  analystTokenCap: number;
  shopperMaxOutput: number;
  merchantMaxOutput: number;
  analystMaxOutput: number;
  shopperMaxSteps: number;
  merchantMaxSteps: number;
  /** Fraction of the run cap at which new shoppers stop being admitted. */
  warnAt: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  runTokenCap: 400_000,
  shopperTokenCap: 12_000,
  merchantTokenCap: 60_000,
  analystTokenCap: 20_000,
  shopperMaxOutput: 400,
  merchantMaxOutput: 800,
  analystMaxOutput: 1_500,
  shopperMaxSteps: 8,
  merchantMaxSteps: 12,
  warnAt: 0.8,
};

export interface BudgetSnapshot {
  tokensIn: number;
  tokensOut: number;
  /** Cached prefix reads, already included in tokensIn. */
  tokensCached: number;
  /** Billable tokens (uncached input + output); the caps compare against this. */
  total: number;
  rawTotal: number;
  costUsd: number;
  cap: number;
  fraction: number;
  warned: boolean;
  exhausted: boolean;
  actors: Record<string, { total: number; rawTotal: number; costUsd: number }>;
}

export type BudgetEvent = { type: "budget.warning" | "budget.exhausted"; actor: string; payload: Record<string, unknown> };

/**
 * Three levels of caps, all checked BEFORE a model call is made, never after:
 * per turn (maxOutputTokens + step count, applied by the caller), per actor, per run.
 * The guard never throws; callers ask `check()` and degrade gracefully.
 */
export class BudgetGuard {
  readonly limits: BudgetLimits;
  private tokensIn = 0;
  private tokensOut = 0;
  private costUsd = 0;
  private tokensCached = 0;
  private actors = new Map<string, { in: number; out: number; cached: number; cost: number }>();
  private warned = false;
  private exhaustedRun = false;
  private exhaustedActors = new Set<string>();

  constructor(
    limits: Partial<BudgetLimits> = {},
    private readonly onEvent: (e: BudgetEvent) => void = () => {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Billable tokens: uncached input plus output. This is what the caps and the Arena meter count. */
  get total() {
    return this.tokensIn - this.tokensCached + this.tokensOut;
  }
  /** Every token that went through a model, cached prefix reads included. */
  get rawTotal() {
    return this.tokensIn + this.tokensOut;
  }
  get isExhausted() {
    return this.exhaustedRun;
  }

  capFor(kind: ActorKind): number {
    return kind === "shopper" ? this.limits.shopperTokenCap : kind === "merchant" ? this.limits.merchantTokenCap : kind === "analyst" ? this.limits.analystTokenCap : this.limits.merchantTokenCap;
  }
  maxOutputFor(kind: ActorKind): number {
    return kind === "shopper" ? this.limits.shopperMaxOutput : kind === "analyst" ? this.limits.analystMaxOutput : this.limits.merchantMaxOutput;
  }
  maxStepsFor(kind: ActorKind): number {
    return kind === "shopper" ? this.limits.shopperMaxSteps : this.limits.merchantMaxSteps;
  }

  /** Should a NEW shopper be started? Stops admitting at warnAt and emits budget.warning once. */
  admit(): boolean {
    if (this.exhaustedRun) return false;
    const frac = this.total / this.limits.runTokenCap;
    if (frac >= this.limits.warnAt) {
      if (!this.warned) {
        this.warned = true;
        this.onEvent({ type: "budget.warning", actor: "run", payload: { tokens: this.total, cap: this.limits.runTokenCap, fraction: Math.round(frac * 100) / 100, action: "no new shoppers admitted" } });
      }
      return false;
    }
    return true;
  }

  /** May this actor make another model call right now? */
  check(actor: string, kind: ActorKind): { ok: true } | { ok: false; reason: "run" | "actor" } {
    if (this.exhaustedRun) return { ok: false, reason: "run" };
    if (this.total >= this.limits.runTokenCap) {
      this.markRunExhausted(actor);
      return { ok: false, reason: "run" };
    }
    const a = this.actors.get(actor);
    const spent = a ? a.in - a.cached + a.out : 0;
    if (a && spent >= this.capFor(kind)) {
      if (!this.exhaustedActors.has(actor)) {
        this.exhaustedActors.add(actor);
        this.onEvent({ type: "budget.exhausted", actor, payload: { actor, kind, tokens: spent, rawTokens: a.in + a.out, cap: this.capFor(kind), action: "scripted fallback" } });
      }
      return { ok: false, reason: "actor" };
    }
    return { ok: true };
  }

  record(actor: string, usage: Usage) {
    this.tokensIn += usage.inputTokens;
    this.tokensOut += usage.outputTokens;
    this.costUsd += usage.costUsd;
    const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens);
    this.tokensCached += cached;
    const a = this.actors.get(actor) ?? { in: 0, out: 0, cached: 0, cost: 0 };
    a.in += usage.inputTokens;
    a.out += usage.outputTokens;
    a.cached += cached;
    a.cost += usage.costUsd;
    this.actors.set(actor, a);
    if (this.total >= this.limits.runTokenCap) this.markRunExhausted(actor);
  }

  private markRunExhausted(actor: string) {
    if (this.exhaustedRun) return;
    this.exhaustedRun = true;
    this.onEvent({ type: "budget.exhausted", actor: "run", payload: { actor: "run", lastActor: actor, tokens: this.total, cap: this.limits.runTokenCap, action: "draining in-flight turns, run will finish early" } });
  }

  snapshot(): BudgetSnapshot {
    return {
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      tokensCached: this.tokensCached,
      total: this.total,
      rawTotal: this.rawTotal,
      costUsd: Math.round(this.costUsd * 1e6) / 1e6,
      cap: this.limits.runTokenCap,
      fraction: Math.round((this.total / this.limits.runTokenCap) * 1000) / 1000,
      warned: this.warned,
      exhausted: this.exhaustedRun,
      actors: Object.fromEntries([...this.actors.entries()].map(([k, v]) => [k, { total: v.in - v.cached + v.out, rawTotal: v.in + v.out, costUsd: Math.round(v.cost * 1e6) / 1e6 }])),
    };
  }
}

/** Rough per-call token shapes measured on fixture runs (prompt sizes after trimming). */
const SHAPE = {
  /** Usage of one shopper call summed over its tool steps (measured 15-18k on live runs, 8 Nov 2026). */
  shopperPrompt: 16_000,
  shopperOut: 700,
  /** Shoppers usually say DONE before the turn cap. */
  shopperTurnShare: 0.5,
  merchantPrompt: 11_000,
  merchantOut: 500,
  /** Inbox items are batched, so a merchant call covers more than one order (measured 4-6 calls per 5-10 orders). */
  merchantTurnsPerOrder: 0.6,
  merchantCacheShare: 0.6,
  analystPrompt: 2_000,
  analystOut: 300,
  analystTurns: 3,
  shopperCacheShare: 0.85,
};

export interface Estimate {
  /** Billable tokens (uncached input + output), the number the run cap is compared with. */
  tokens: number;
  /** Every token through a model, cached prefix reads included. */
  rawTokens: number;
  usd: number;
  breakdown: { shoppers: { tokens: number; usd: number }; merchant: { tokens: number; usd: number }; analyst: { tokens: number; usd: number } };
  overCap: boolean;
  models: { shopper: string; merchant: string; analyst: string };
}

export function estimateRun(scenario: Scenario, opts: { models?: Partial<typeof DEFAULT_MODELS>; tokenCap?: number; scripted?: boolean } = {}): Estimate {
  const models = { ...DEFAULT_MODELS, ...Object.fromEntries(Object.entries(opts.models ?? {}).filter(([, v]) => v)) } as typeof DEFAULT_MODELS;
  const cap = opts.tokenCap ?? scenario.tokenCap;
  if (opts.scripted) return { tokens: 0, rawTokens: 0, usd: 0, breakdown: { shoppers: { tokens: 0, usd: 0 }, merchant: { tokens: 0, usd: 0 }, analyst: { tokens: 0, usd: 0 } }, overCap: false, models };
  const shopperCalls = scenario.shoppers * Math.max(2, Math.ceil(scenario.shopperTurns * SHAPE.shopperTurnShare));
  const shopperIn = shopperCalls * SHAPE.shopperPrompt;
  const shopperOut = shopperCalls * SHAPE.shopperOut;
  const shopperCached = Math.round(shopperIn * SHAPE.shopperCacheShare);
  const shoppersUsd = costFor(models.shopper, { inputTokens: shopperIn, outputTokens: shopperOut, cachedTokens: shopperCached });
  const merchantCalls = Math.max(2, Math.round(scenario.shoppers * SHAPE.merchantTurnsPerOrder) + scenario.chaos.length);
  const merchantIn = merchantCalls * SHAPE.merchantPrompt;
  const merchantOut = merchantCalls * SHAPE.merchantOut;
  const merchantCached = Math.round(merchantIn * SHAPE.merchantCacheShare);
  const merchantUsd = costFor(models.merchant, { inputTokens: merchantIn, outputTokens: merchantOut, cachedTokens: merchantCached });
  const analystIn = SHAPE.analystTurns * SHAPE.analystPrompt;
  const analystOut = SHAPE.analystTurns * SHAPE.analystOut;
  const analystUsd = costFor(models.analyst, { inputTokens: analystIn, outputTokens: analystOut });
  const shopperTokens = shopperIn - shopperCached + shopperOut;
  const merchantTokens = merchantIn - merchantCached + merchantOut;
  const analystTokens = analystIn + analystOut;
  const tokens = shopperTokens + merchantTokens + analystTokens;
  const rawTokens = shopperIn + shopperOut + merchantIn + merchantOut + analystIn + analystOut;
  const usd = shoppersUsd + merchantUsd + analystUsd;
  return {
    tokens,
    rawTokens,
    usd: Math.round(usd * 10000) / 10000,
    breakdown: { shoppers: { tokens: shopperTokens, usd: r4(shoppersUsd) }, merchant: { tokens: merchantTokens, usd: r4(merchantUsd) }, analyst: { tokens: analystTokens, usd: r4(analystUsd) } },
    overCap: tokens > cap,
    models,
  };
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;
