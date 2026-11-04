import { fmtSim } from "./clock";
import type { SwarmEvent } from "./events";
import { evaluateRules, type Finding, type RuleConfig } from "./rules";
import { DIMENSION_LABELS, scoreFindings, type Score } from "./score";

export interface RunMeta {
  runId: string;
  name?: string;
  scenario: string;
  merchantProfile: string;
  startedAt?: string;
  finishedAt?: string;
  paypalMode?: "mock" | "sandbox";
  llmMode?: "scripted" | "live";
  tokenCap?: number;
}

export interface RunStats {
  shoppers: number;
  ordersCreated: number;
  ordersApproved: number;
  captured: number;
  declined: number;
  shipped: number;
  refunded: number;
  disputesOpened: number;
  disputesResolved: number;
  webhooks: number;
  webhookMedianLagMs: number | null;
  paypalErrors: number;
  rateLimits: number;
  messages: number;
  agentTurns: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  cacheHits: number;
  budgetWarnings: number;
  budgetExhausted: string[];
  simMinutes: number;
  chaos: Array<{ kind: string; simT: number }>;
  gmvUsd: number;
}

export interface Report {
  meta: RunMeta;
  score: Score;
  findings: Finding[];
  stats: RunStats;
  generatedAt: string;
  ruleConfig: Partial<RuleConfig>;
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);
const amountOf = (p: Record<string, unknown>) => n((p.amount as Record<string, unknown> | undefined)?.value ?? p.amount);

export function computeStats(events: SwarmEvent[]): RunStats {
  const by = (t: SwarmEvent["type"]) => events.filter((e) => e.type === t);
  const turns = by("agent.turn");
  const usage = turns.reduce(
    (acc, e) => {
      const u = (e.payload.usage as Record<string, unknown> | undefined) ?? {};
      acc.in += n(u.inputTokens);
      acc.out += n(u.outputTokens);
      acc.cached += n(u.cachedTokens);
      acc.cost += n(e.payload.costUsd);
      if (e.payload.cached === true) acc.hits++;
      return acc;
    },
    { in: 0, out: 0, cached: 0, cost: 0, hits: 0 },
  );
  const lags = by("webhook.received")
    .map((e) => n(e.payload.lagMs))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const captured = by("order.captured");
  return {
    shoppers: new Set(events.filter((e) => e.actorClass === "shopper").map((e) => e.actor)).size,
    ordersCreated: by("order.created").length,
    ordersApproved: by("order.approved").length,
    captured: captured.length,
    declined: by("order.capture_declined").length,
    shipped: by("order.shipped").length,
    refunded: by("order.refunded").length,
    disputesOpened: by("dispute.opened").length,
    disputesResolved: by("dispute.resolved").length,
    webhooks: lags.length + by("webhook.received").filter((e) => !(n(e.payload.lagMs) > 0)).length,
    webhookMedianLagMs: lags.length ? lags[Math.floor(lags.length / 2)]! : null,
    paypalErrors: by("paypal.error").length,
    rateLimits: by("infra.rate_limit").length,
    messages: by("message.sent").length,
    agentTurns: turns.length,
    tokensIn: usage.in,
    tokensOut: usage.out,
    cachedTokens: usage.cached,
    costUsd: Math.round(usage.cost * 1e6) / 1e6,
    cacheHits: usage.hits,
    budgetWarnings: by("budget.warning").length,
    budgetExhausted: by("budget.exhausted").map((e) => String(e.payload.actor ?? e.actor)),
    simMinutes: events.length ? Math.max(...events.map((e) => e.simT)) : 0,
    chaos: by("chaos.injected").map((e) => ({ kind: String(e.payload.kind), simT: e.simT })),
    gmvUsd: Math.round(captured.reduce((s, e) => s + amountOf(e.payload), 0) * 100) / 100,
  };
}

export function buildReport(events: SwarmEvent[], meta: RunMeta, ruleConfig: Partial<RuleConfig> = {}): Report {
  const findings = evaluateRules(events, ruleConfig);
  return { meta, score: scoreFindings(findings), findings, stats: computeStats(events), generatedAt: new Date().toISOString(), ruleConfig };
}

export function renderMarkdown(r: Report): string {
  const s = r.stats;
  const sev = (x: Finding["severity"]) => ({ critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" })[x];
  const lines: string[] = [];
  lines.push(`# Swarm agent-readiness report: ${r.meta.name ?? r.meta.scenario}`);
  lines.push("");
  lines.push(`Run \`${r.meta.runId}\` · scenario **${r.meta.scenario}** · merchant profile **${r.meta.merchantProfile}** · PayPal ${r.meta.paypalMode ?? "?"} · LLM ${r.meta.llmMode ?? "?"} · generated ${r.generatedAt}`);
  lines.push("");
  lines.push(`## Score: ${r.score.overall}/100 (${r.score.grade})`);
  lines.push("");
  lines.push("| Dimension | Score |");
  lines.push("|---|---|");
  for (const [d, v] of Object.entries(r.score.dimensions)) lines.push(`| ${DIMENSION_LABELS[d as keyof typeof DIMENSION_LABELS]} | ${v} |`);
  lines.push("");
  lines.push("## What happened");
  lines.push("");
  lines.push(`- ${s.shoppers} shoppers, ${s.ordersCreated} orders created, ${s.ordersApproved} approved, ${s.captured} captured ($${s.gmvUsd.toFixed(2)} GMV), ${s.declined} declined, ${s.shipped} shipped, ${s.refunded} refunds`);
  lines.push(`- ${s.disputesOpened} disputes opened, ${s.disputesResolved} resolved · ${s.webhooks} webhooks${s.webhookMedianLagMs !== null ? ` (median lag ${s.webhookMedianLagMs} ms)` : ""} · ${s.paypalErrors} PayPal errors · ${s.rateLimits} rate limits`);
  lines.push(`- ${s.messages} buyer/merchant messages · ${s.agentTurns} agent turns · simulated time ${fmtSim(s.simMinutes)}`);
  if (s.chaos.length) lines.push(`- Chaos injected: ${s.chaos.map((c) => `${c.kind} @ ${fmtSim(c.simT)}`).join(", ")}`);
  lines.push("");
  lines.push(`## Findings (${r.findings.length})`);
  lines.push("");
  if (r.findings.length === 0) lines.push("No findings. Either the merchant is solid or the scenario was too gentle; try Black Friday.");
  for (const f of r.findings) {
    lines.push(`### ${sev(f.severity)} ${f.rule}: ${f.title}`);
    lines.push("");
    lines.push(f.detail);
    lines.push("");
    lines.push(`**Fix:** ${f.fix}`);
    lines.push("");
    lines.push(`Events: ${f.eventIds.map((id) => `#${id}`).join(", ") || "n/a"}${f.paypalIds.length ? ` · PayPal ids: ${f.paypalIds.map((id) => `\`${id}\``).join(", ")}` : ""}`);
    lines.push("");
  }
  lines.push("## Cost and budget");
  lines.push("");
  lines.push(`Tokens in ${s.tokensIn.toLocaleString()} (cached ${s.cachedTokens.toLocaleString()}) · out ${s.tokensOut.toLocaleString()} · cost $${s.costUsd.toFixed(4)}${r.meta.tokenCap ? ` · cap ${r.meta.tokenCap.toLocaleString()}` : ""}${s.cacheHits ? ` · ${s.cacheHits} dev-cache hits (this was not a fully live run)` : ""}`);
  if (s.budgetWarnings || s.budgetExhausted.length) lines.push(`Budget guard: ${s.budgetWarnings} warnings, exhausted for ${s.budgetExhausted.length ? s.budgetExhausted.join(", ") : "nobody"}.`);
  lines.push("");
  lines.push("_Scores are deductions per finding (critical 25, high 15, medium 8, low 3), capped at 40 points per rule and per dimension; infrastructure rate limits are reported but never scored._");
  return lines.join("\n");
}
