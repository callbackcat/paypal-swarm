import type { Severity, SwarmEvent } from "../events";

export const DIMENSIONS = ["discoverability", "transactability", "fulfilment", "resilience"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface Finding {
  rule: string;
  severity: Severity;
  dimension: Dimension;
  title: string;
  detail: string;
  /** One concrete fix line a merchant engineer can act on. */
  fix: string;
  eventIds: number[];
  paypalIds: string[];
  /** Optional grouping key (orderId, personaId, disputeId) for the Arena. */
  subject?: string;
}

export interface RuleConfig {
  /** Sim minutes after capture before missing tracking counts. */
  trackingGraceMin: number;
  /** Sim minutes a shopper message may wait for a merchant reply. */
  replySlaMin: number;
  /** Sim minutes a dispute may sit without any merchant action. */
  disputeSlaMin: number;
  /** Sim minutes a declined capture may sit without a merchant message or retry. */
  declineSlaMin: number;
  /** Minimum orders before POSITION_BIAS is measured. */
  biasMinOrders: number;
  /** Ratio of observed top-3 share to expected share that triggers POSITION_BIAS. */
  biasRatio: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  trackingGraceMin: 24 * 60,
  replySlaMin: 4 * 60,
  disputeSlaMin: 48 * 60,
  declineSlaMin: 2 * 60,
  biasMinOrders: 5,
  biasRatio: 2,
};

export interface RuleContext {
  events: SwarmEvent[];
  config: RuleConfig;
  /** Sim time of the last event; "now" for SLA maths. */
  now: number;
  /** Whether the run finished (SLAs are judged leniently while a run is live). */
  finished: boolean;
  byType(type: SwarmEvent["type"]): SwarmEvent[];
  idOf(e: SwarmEvent): number;
}

export interface Rule {
  id: string;
  dimension: Dimension;
  description: string;
  evaluate(ctx: RuleContext): Finding[];
}

export function makeContext(events: SwarmEvent[], config: Partial<RuleConfig> = {}): RuleContext {
  const sorted = [...events].sort((a, b) => (a.id ?? 0) - (b.id ?? 0) || a.simT - b.simT);
  // Synthetic/unsaved events get positional ids so findings can still reference them.
  sorted.forEach((e, i) => {
    if (e.id === undefined) e.id = i + 1;
  });
  const index = new Map<string, SwarmEvent[]>();
  for (const e of sorted) {
    const arr = index.get(e.type) ?? [];
    arr.push(e);
    index.set(e.type, arr);
  }
  return {
    events: sorted,
    config: { ...DEFAULT_RULE_CONFIG, ...config },
    now: sorted.length ? Math.max(...sorted.map((e) => e.simT)) : 0,
    finished: (index.get("run.finished")?.length ?? 0) > 0,
    byType: (t) => index.get(t) ?? [],
    idOf: (e) => e.id ?? 0,
  };
}

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
export const ids = (...es: Array<SwarmEvent | undefined>) => es.filter((e): e is SwarmEvent => !!e).map((e) => e.id ?? 0);
export const ppIds = (...es: Array<SwarmEvent | undefined>) => [...new Set(es.flatMap((e) => e?.paypalIds ?? []))];
