import type { Dimension, Finding, Persona, Report, Scenario, Severity, SwarmEvent } from "@swarm/core";
import { ACCESS_HEADER, askForAccessCode, storeAccessCode, storedAccessCode } from "./access";

export type { Dimension, Finding, Persona, Report, Scenario, Severity, SwarmEvent };

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface Estimate {
  tokens: number;
  usd: number;
  overCap: boolean;
  breakdown: Record<string, { tokens: number; usd: number }>;
  models: Record<string, string>;
}
export interface Modes {
  paypal: "mock" | "sandbox";
  llm: "live" | "scripted";
  credentialsSource: "none" | "demo" | "byo";
  llmKeySource: "none" | "demo" | "byo";
}
export interface ScenarioView extends Scenario {
  chaosDescription: string[];
  /** Live estimate with the server's configured models; null for "coming" scenarios. */
  liveEstimate: Estimate | null;
}
export interface ScenariosResponse {
  scenarios: ScenarioView[];
  modes: { paypal: "mock" | "sandbox"; llm: "live" | "scripted"; webhooks: boolean };
  allowlists: Record<string, { actions: Record<string, unknown>; tools: string[] }>;
}
export interface RunConfigInput {
  scenario: string;
  name?: string;
  merchantProfile?: "baseline" | "hardened";
  shoppers?: number;
  tokenCap?: number;
  personaSeed?: number;
  models?: { shopper?: string; merchant?: string; analyst?: string };
  approvalThresholdUsd?: number;
  approvalTimeoutSec?: number;
  paypal?: "mock" | "sandbox" | "auto";
  llm?: "scripted" | "live" | "auto";
  llmCache?: boolean;
  credentials?: { clientId: string; clientSecret: string; merchantId?: string };
  openrouterApiKey?: string;
  /** Free text handed to every shopper: who they are this run and what to try to break. */
  brief?: string;
}
/** What POST /ai/plan-run makes of one sentence: a strict plan, the config it maps to, and how it was produced. */
export interface PlanResult {
  plan: {
    scenario: string;
    merchantProfile: "baseline" | "hardened";
    bothProfiles: boolean;
    shoppers: number | null;
    model: string | null;
    brief: string | null;
    name: string;
    reading: string;
  };
  config: Pick<RunConfigInput, "scenario" | "merchantProfile" | "name" | "shoppers" | "brief" | "models">;
  source: "llm" | "heuristic";
  usage: { costUsd: number; inputTokens: number; outputTokens: number };
  model?: string;
}
export interface BudgetSnapshot {
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
  /** Billable tokens (uncached input + output), compared with the cap. */
  total: number;
  rawTotal?: number;
  costUsd: number;
  cap: number;
  fraction: number;
  warned: boolean;
  exhausted: boolean;
  actors: Record<string, { total: number; costUsd: number }>;
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
export interface RunStatus {
  id: string;
  name: string;
  scenario: string;
  config: RunConfigInput & Record<string, unknown>;
  merchantProfile: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  score?: { score?: Report["score"]; stats?: Report["stats"]; reason?: string; modes?: Modes; error?: string } | null;
  tokenCap: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  createdAt: string;
  active: boolean;
  paused: boolean;
  modes: Modes | null;
  budget: BudgetSnapshot | null;
  pendingApprovals: ApprovalRow[];
}
export interface RunListItem {
  id: string;
  name: string;
  scenario: string;
  merchantProfile: string;
  status: string;
  createdAt: string;
  finishedAt?: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  score?: RunStatus["score"];
  active: boolean;
}
export interface WebhookRow {
  id: number;
  eventType: string;
  resourceId: string | null;
  receivedAt: string;
  matchedEventId: number | null;
  lagMs: number | null;
  verified: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
const post = <T>(path: string, body: unknown) => j<T>(path, { method: "POST", body: JSON.stringify(body) });

/**
 * A request that may spend the demo OpenRouter key. It carries the stored access code; when the api answers 401 the
 * access dialog opens once, and the request goes again after the person enters the code.
 */
async function gated<T>(path: string, body: unknown): Promise<T> {
  const send = () => {
    const code = storedAccessCode();
    return j<T>(path, { method: "POST", body: JSON.stringify(body), headers: code ? { [ACCESS_HEADER]: code } : undefined });
  };
  try {
    return await send();
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    storeAccessCode(null);
    if (!(await askForAccessCode())) throw new ApiError(401, "A live run needs the access code. Enter it to start, or switch the run to scripted in settings.");
    return send();
  }
}

export const api = {
  health: () => j<{ ok: boolean; storage: string; paypal: string; llm: string; webhooks: boolean; activeRuns: number; version: string }>("/healthz"),
  scenarios: () => j<ScenariosResponse>("/scenarios"),
  estimate: (cfg: RunConfigInput) => post<{ scenario: string; shoppers: number; tokenCap: number; modes: Modes; estimate: Estimate }>("/runs/estimate", cfg),
  createRun: (cfg: RunConfigInput) => gated<RunStatus & { modes: Modes; estimate: Estimate }>("/runs", cfg),
  checkAccess: (code: string) => post<{ ok: boolean }>("/access", { code }),
  planRun: (text: string) => post<PlanResult>("/ai/plan-run", { text }),
  listRuns: () => j<{ runs: RunListItem[] }>("/runs"),
  getRun: (id: string) => j<RunStatus>(`/runs/${id}`),
  events: (id: string, since = 0, type?: string, limit = 5000) => j<{ events: SwarmEvent[]; next: number }>(`/runs/${id}/events.json?since=${since}&limit=${limit}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
  report: (id: string) => j<Report>(`/runs/${id}/report`),
  reportMd: async (id: string) => {
    const res = await fetch(`${API}/runs/${id}/report?format=md`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.text();
  },
  rerun: (id: string, body: { merchantProfile?: "baseline" | "hardened"; name?: string }) => gated<RunStatus & { rerunOf: string }>(`/runs/${id}/rerun`, body),
  pause: (id: string) => post<{ id: string }>(`/runs/${id}/pause`, {}),
  resume: (id: string) => post<{ id: string }>(`/runs/${id}/resume`, {}),
  stop: (id: string) => post<{ id: string }>(`/runs/${id}/stop`, {}),
  approvals: (id: string, pending = false) => j<{ approvals: ApprovalRow[] }>(`/runs/${id}/approvals?pending=${pending ? 1 : 0}`),
  decide: (id: string, approvalId: string, decision: "granted" | "denied") => post<ApprovalRow>(`/runs/${id}/approvals/${approvalId}`, { decision }),
  personas: (id: string) => j<{ personas: Persona[] }>(`/runs/${id}/personas`),
  webhooks: (id: string) => j<{ webhooks: WebhookRow[] }>(`/runs/${id}/webhooks`),
};

/** Server-sent events with replay. Returns an unsubscribe function. */
export function subscribe(runId: string, since: number, handlers: { onEvent: (e: SwarmEvent) => void; onDone?: (info: { last: number }) => void; onError?: (err: Event) => void; onOpen?: () => void }): () => void {
  const es = new EventSource(`${API}/runs/${runId}/events?since=${since}`);
  es.addEventListener("event", (m) => {
    try {
      handlers.onEvent(JSON.parse((m as MessageEvent).data as string) as SwarmEvent);
    } catch {
      /* ignore malformed frame */
    }
  });
  es.addEventListener("done", (m) => {
    try {
      handlers.onDone?.(JSON.parse((m as MessageEvent).data as string) as { last: number });
    } catch {
      handlers.onDone?.({ last: since });
    }
    es.close();
  });
  es.onopen = () => handlers.onOpen?.();
  es.onerror = (e) => handlers.onError?.(e);
  return () => es.close();
}

export const fmtUsd = (n: number | undefined | null, digits = 2) => (n === undefined || n === null ? "–" : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(digits)}`);
export const fmtTokens = (n: number | undefined | null) => (n === undefined || n === null ? "–" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const fmtSim = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return d > 0 ? `day ${d + 1} ${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};
export const fmtLag = (ms: number | null | undefined) => (ms === null || ms === undefined ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const amountOf = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "value" in v) return Number((v as { value: string }).value);
  return Number(v ?? 0) || 0;
};
export const isTerminal = (status: string) => !["created", "running", "paused"].includes(status);
