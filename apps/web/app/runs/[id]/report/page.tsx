"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, fmtLag, fmtSim, fmtTokens, fmtUsd, isTerminal, type Dimension, type Finding, type Report, type RunStatus, type SwarmEvent } from "@/lib/api";
import { ACTOR_COLORS, summarize } from "@/lib/arena";
import { Bar, Chip, Empty, ErrorBox, ModeBadges, ScoreRing, Section, SeverityChip, Stat, StatusChip } from "@/components/ui";

const DIM_LABEL: Record<Dimension, string> = { discoverability: "Discoverability", transactability: "Transactability", fulfilment: "Fulfilment", resilience: "Resilience" };
const DIM_BLURB: Record<Dimension, string> = {
  discoverability: "Can agents find the right product? Position bias, prompt-injection susceptibility.",
  transactability: "Do payments complete correctly? Duplicate captures, unhandled declines, refund errors.",
  fulfilment: "Does the merchant ship and answer? Capture without tracking, buyers left waiting.",
  resilience: "Does it survive trouble? Disputes answered in time, webhooks matched.",
};
const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [events, setEvents] = useState<Map<number, SwarmEvent>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [r, s] = await Promise.all([api.report(id), api.getRun(id)]);
        if (!alive) return;
        setReport(r);
        setRun(s);
        const ids = new Set(r.findings.flatMap((f) => f.eventIds));
        if (ids.size) {
          const ev = await api.events(id, 0);
          if (!alive) return;
          setEvents(new Map(ev.events.filter((e) => e.id !== undefined && ids.has(e.id)).map((e) => [e.id as number, e])));
        }
      } catch (e) {
        if (alive) setError(e);
      }
    };
    load();
    const t = setInterval(() => {
      if (run && isTerminal(run.status)) return;
      load();
    }, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, run?.status]);

  const grouped = useMemo(() => {
    const g = new Map<string, Finding[]>();
    for (const f of report?.findings ?? []) g.set(f.severity, [...(g.get(f.severity) ?? []), f]);
    return g;
  }, [report]);

  async function download(kind: "md" | "json") {
    const text = kind === "md" ? await api.reportMd(id) : JSON.stringify(report, null, 2);
    const blob = new Blob([text], { type: kind === "md" ? "text/markdown" : "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `swarm-report-${id}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function rerun(profile: "baseline" | "hardened") {
    setBusy(true);
    try {
      const r = await api.rerun(id, { merchantProfile: profile });
      router.push(`/runs/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (!report) return error ? <ErrorBox error={error} /> : <Empty>Building report…</Empty>;
  const { score, stats, meta } = report;
  const live = run && !isTerminal(run.status);
  const otherProfile = meta.merchantProfile === "hardened" ? "baseline" : "hardened";
  const simulated = meta.paypalMode === "mock" || meta.llmMode === "scripted";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Agent-readiness report</h1>
            {run && <StatusChip status={run.status} />}
            <ModeBadges modes={meta.paypalMode && meta.llmMode ? { paypal: meta.paypalMode, llm: meta.llmMode } : run?.modes} compact />
            <Chip tone="muted">{meta.merchantProfile} merchant</Chip>
            {live && <Chip tone="warn">live preview, refreshing</Chip>}
          </div>
          <div className="muted mono mt-1 text-xs">
            {meta.name} · {meta.scenario} · {id} · generated {new Date(report.generatedAt).toLocaleString()}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/runs/${id}`} className="btn">
            Arena
          </Link>
          <Link href={`/runs/${id}/studio`} className="btn">
            Studio
          </Link>
          <button className="btn" onClick={() => download("md")}>
            ↓ Markdown
          </button>
          <button className="btn" onClick={() => download("json")}>
            ↓ JSON
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => rerun(otherProfile)}>
            {busy ? "Starting…" : otherProfile === "hardened" ? "Re-run with fix (hardened)" : "Re-run as baseline"}
          </button>
        </div>
      </header>
      <ErrorBox error={error} />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Section title="Score" bodyClass="flex flex-col items-center gap-3">
          <ScoreRing score={score.overall} grade={score.grade} size={150} />
          <div className="muted text-center text-xs">
            Weighted deductions per finding, capped per rule. Rate limits are infrastructure and never score.
          </div>
        </Section>
        <Section title="Dimensions">
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(DIM_LABEL) as Dimension[]).map((d) => (
              <div key={d}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{DIM_LABEL[d]}</span>
                  <span className="mono">{score.dimensions[d]}</span>
                </div>
                <div className="mt-1">
                  <Bar value={score.dimensions[d]} max={100} tone={score.dimensions[d] >= 85 ? "ok" : score.dimensions[d] >= 65 ? "warn" : "bad"} />
                </div>
                <div className="muted mt-1 text-xs">{DIM_BLURB[d]}</div>
                {score.deductions.filter((x) => x.dimension === d).length > 0 && (
                  <div className="mono muted mt-1 text-[11px]">
                    {score.deductions
                      .filter((x) => x.dimension === d)
                      .map((x) => `${x.rule} ×${x.count} −${x.points}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Orders" value={`${stats.captured}/${stats.ordersCreated}`} sub={`captured / created · GMV ${fmtUsd(stats.gmvUsd)}`} />
        <Stat label="Shipped" value={stats.shipped} sub={`${stats.captured - stats.shipped > 0 ? `${stats.captured - stats.shipped} captured without tracking` : "every capture tracked"}`} tone={stats.captured - stats.shipped > 0 ? "warn" : "ok"} />
        <Stat label="Declined / refunded" value={`${stats.declined} / ${stats.refunded}`} />
        <Stat label="Disputes" value={`${stats.disputesResolved}/${stats.disputesOpened}`} sub="resolved / opened" tone={stats.disputesOpened > stats.disputesResolved ? "bad" : undefined} />
        <Stat label="Webhooks" value={stats.webhooks} sub={`median lag ${fmtLag(stats.webhookMedianLagMs)}`} />
        <Stat label="PayPal errors" value={stats.paypalErrors} sub={`${stats.rateLimits} rate limits · ${stats.messages} messages`} tone={stats.paypalErrors ? "warn" : undefined} />
      </div>

      <Section title={`Findings (${report.findings.length})`} right={<span className="muted text-xs">each finding links the exact events and PayPal ids that triggered it</span>}>
        {report.findings.length === 0 && <Empty>No findings. {stats.ordersCreated === 0 ? "No orders were created yet." : "This merchant handled everything the swarm threw at it."}</Empty>}
        <div className="space-y-3">
          {SEV_ORDER.flatMap((sev) => grouped.get(sev) ?? []).map((f, i) => {
            const key = i;
            const isOpen = open.has(key);
            const trail = f.eventIds.map((eid) => events.get(eid)).filter((e): e is SwarmEvent => !!e);
            return (
              <article key={key} className="panel-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SeverityChip severity={f.severity} />
                    <span className="font-medium">{f.title}</span>
                    <span className="mono muted text-[11px]">{f.rule}</span>
                    <Chip tone="muted">{DIM_LABEL[f.dimension]}</Chip>
                  </div>
                  <button className="muted text-xs hover:text-white" onClick={() => setOpen((s) => new Set(isOpen ? [...s].filter((x) => x !== key) : [...s, key]))}>
                    {isOpen ? "hide trail" : `event trail (${f.eventIds.length})`}
                  </button>
                </div>
                <p className="mt-1 text-sm">{f.detail}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--ok)" }}>
                  <span className="font-medium">Fix:</span> {f.fix}
                </p>
                {f.paypalIds.length > 0 && (
                  <div className="mono muted mt-1 text-[11px]">
                    PayPal ids: {f.paypalIds.join(", ")}
                  </div>
                )}
                {isOpen && (
                  <div className="mt-2 overflow-hidden rounded-lg" style={{ border: "1px solid var(--line)" }}>
                    {trail.length === 0 && <div className="muted px-3 py-2 text-xs">events {f.eventIds.join(", ")}</div>}
                    {trail.map((e) => (
                      <div key={e.id} className="feed-row grid grid-cols-[40px_56px_90px_1fr] gap-2 px-3 py-1 text-xs">
                        <span className="mono muted">#{e.id}</span>
                        <span className="mono muted">{fmtSim(e.simT)}</span>
                        <span className="truncate" style={{ color: ACTOR_COLORS[e.actorClass] }}>
                          {e.actor}
                        </span>
                        <span>
                          <span className="mono muted mr-1">{e.type}</span>
                          {summarize(e)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Section>

      <Section title="Cost & budget footer">
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="muted text-xs">Tokens</div>
            <div className="mono">
              {fmtTokens(stats.tokensIn + stats.tokensOut)} <span className="muted">({fmtTokens(stats.tokensIn)} in · {fmtTokens(stats.tokensOut)} out · {fmtTokens(stats.cachedTokens)} cache reads)</span>
            </div>
          </div>
          <div>
            <div className="muted text-xs">Cost</div>
            <div className="mono">
              {fmtUsd(stats.costUsd, 4)} <span className="muted">· cap {fmtTokens(meta.tokenCap)}</span>
            </div>
          </div>
          <div>
            <div className="muted text-xs">Budget events</div>
            <div className="mono">
              {stats.budgetWarnings} warnings · {stats.budgetExhausted.length} exhausted{stats.cacheHits ? ` · ${stats.cacheHits} dev-cache hits` : ""}
            </div>
          </div>
          <div>
            <div className="muted text-xs">Run</div>
            <div className="mono">
              {stats.agentTurns} agent turns · {fmtSim(stats.simMinutes)} simulated{stats.chaos.length ? ` · chaos: ${stats.chaos.map((c) => c.kind).join(", ")}` : ""}
            </div>
          </div>
        </div>
        {simulated && (
          <p className="muted mt-3 text-xs">
            What is simulated here: {meta.paypalMode === "mock" ? "PayPal calls went to Swarm's in-process mock, which mirrors the Agent Toolkit tool names, schemas and 422 issue codes but is not PayPal. " : ""}
            {meta.llmMode === "scripted" ? "Agents were scripted (deterministic, zero tokens) rather than LLM-driven. " : ""}
            Add PayPal sandbox credentials and an OpenRouter key to run the same scenario for real.
          </p>
        )}
      </Section>
    </div>
  );
}
