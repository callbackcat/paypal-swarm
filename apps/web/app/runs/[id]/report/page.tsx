"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, fmtLag, fmtSim, fmtTokens, fmtUsd, isTerminal, type Dimension, type Finding, type Report, type RunStatus as RunStatusView, type SwarmEvent } from "@/lib/api";
import { summarize } from "@/lib/arena";
import { ErrorAlert, LinkButton, ModeTags, RunStatus, SeverityTag } from "@/components/ui";
import { ReportCharts } from "@/components/ReportCharts";
import { BarBlocks, type BarBlock } from "@/components/sodium/ui/bar-blocks";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleGroup, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
import { DataList, DataListItem, DataListLabel, DataListValue } from "@/components/sodium/ui/data-list";
import { Empty, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle } from "@/components/sodium/ui/empty-state";
import { Frame, FrameBody, FrameDescription, FrameHeader, FrameStatus, FrameTitle, FrameValue } from "@/components/sodium/ui/frame";
import { Meter, MeterLabel, MeterValue } from "@/components/sodium/ui/meter";
import { Skeleton, SkeletonText } from "@/components/sodium/ui/skeleton";
import { Status, StatusMark, type StatusValue } from "@/components/sodium/ui/status";
import { StatusStrip, StatusStripCell, StatusStripLabel, StatusStripUnit, StatusStripValue } from "@/components/sodium/ui/status-strip";
import { Tag } from "@/components/sodium/ui/tag";

const DIM_LABEL: Record<Dimension, string> = { discoverability: "Discoverability", transactability: "Transactability", fulfilment: "Fulfilment", resilience: "Resilience" };
// The share of the overall score each dimension carries; the same numbers as DIMENSION_WEIGHTS in packages/core/src/score.ts.
const DIM_WEIGHT: Record<Dimension, number> = { discoverability: 0.2, transactability: 0.35, fulfilment: 0.25, resilience: 0.2 };
const DIM_BLURB: Record<Dimension, string> = {
  discoverability: "Can agents find the right product? Position bias, prompt-injection susceptibility.",
  transactability: "Do payments complete correctly? Duplicate captures, unhandled declines, refund errors.",
  fulfilment: "Does the merchant ship and answer? Capture without tracking, buyers left waiting.",
  resilience: "Does it survive trouble? Disputes answered in time, webhooks matched.",
};
const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;

const scoreStatus = (n: number): StatusValue => (n >= 85 ? "ok" : n >= 65 ? "warn" : "fail");

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [run, setRun] = useState<RunStatusView | null>(null);
  const [events, setEvents] = useState<Map<number, SwarmEvent>>(new Map());
  const [allEvents, setAllEvents] = useState<SwarmEvent[]>([]);
  const [error, setError] = useState<unknown>(null);
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
        const ev = await api.events(id, 0);
        if (!alive) return;
        setAllEvents(ev.events);
        setEvents(new Map(ev.events.filter((e) => e.id !== undefined && ids.has(e.id)).map((e) => [e.id as number, e])));
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

  const ordered = useMemo(() => {
    const g = new Map<string, Finding[]>();
    for (const f of report?.findings ?? []) g.set(f.severity, [...(g.get(f.severity) ?? []), f]);
    return SEV_ORDER.flatMap((sev) => g.get(sev) ?? []);
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

  if (!report) {
    return error ? (
      <>
        <h1 className="type-title">Report</h1>
        <p className="type-code-sm text-text-2">{id}</p>
        <ErrorAlert error={error} />
      </>
    ) : (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-(--control-lg) w-full max-w-md" />
        <SkeletonText lines={3} />
      </div>
    );
  }
  const { score, stats, meta } = report;
  const live = run && !isTerminal(run.status);
  const otherProfile = meta.merchantProfile === "hardened" ? "baseline" : "hardened";
  const simulated = meta.paypalMode === "mock" || meta.llmMode === "scripted";
  const untracked = stats.captured - stats.shipped;
  // The hundred points as blocks: what the store kept, then what each dimension cost it, weighted as the score weighs them.
  const pointBlocks: BarBlock[] = [
    { label: "Kept", value: score.overall },
    ...(Object.keys(DIM_LABEL) as Dimension[])
      .map((d) => ({ label: DIM_LABEL[d], value: (100 - score.dimensions[d]) * DIM_WEIGHT[d], tone: "fail" as const }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value),
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="type-title">{meta.name}</h1>
          <p className="type-code-sm text-text-2">
            agent-readiness report, {meta.scenario}, {id}, generated {new Date(report.generatedAt).toLocaleString()}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {run && <RunStatus status={run.status} />}
            <ModeTags modes={meta.paypalMode && meta.llmMode ? { paypal: meta.paypalMode, llm: meta.llmMode } : run?.modes} />
            <Tag size="sm">{meta.merchantProfile} merchant</Tag>
            {live && (
              <Tag size="sm" variant="outline">
                Live preview
              </Tag>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={`/runs/${id}`}>Arena</LinkButton>
          <LinkButton href={`/runs/${id}/studio`}>Studio</LinkButton>
          <Button variant="secondary" onClick={() => download("md")}>
            Download markdown
          </Button>
          <Button variant="secondary" onClick={() => download("json")}>
            Download JSON
          </Button>
          <Button pending={busy} pendingLabel="Starting" onClick={() => rerun(otherProfile)}>
            {otherProfile === "hardened" ? "Re-run with fix" : "Re-run as baseline"}
          </Button>
        </div>
      </div>
      <ErrorAlert error={error} />

      {/* One row: the score, the order timeline and the spend. The dimensions and the run's numbers follow under it. */}
      <ReportCharts
        runId={id}
        report={report}
        events={allEvents}
        lead={
        <Frame variant="panel" aria-label="Readiness score">
          <FrameHeader>
            <FrameTitle>Readiness</FrameTitle>
            <FrameStatus>
              <Status status={scoreStatus(score.overall)} size="sm">
                Grade {score.grade}
              </Status>
            </FrameStatus>
            <FrameValue meta>of 100</FrameValue>
          </FrameHeader>
          <FrameBody>
            <p className="type-figure text-text-1" aria-label={`Readiness score ${score.overall} of 100, grade ${score.grade}`}>
              {score.overall}
            </p>
          </FrameBody>
          <FrameBody className="flex flex-1 flex-col justify-end gap-2">
            <p className="type-micro text-text-3">Where the 100 points went</p>
            <BarBlocks
              label={`Where the 100 points went: ${pointBlocks.map((b) => `${b.label} ${Math.round(b.value * 10) / 10}`).join(", ")}`}
              data={pointBlocks}
              valueFormat={(v) => (v < 10 && v % 1 !== 0 ? v.toFixed(1) : String(Math.round(v)))}
            />
          </FrameBody>
          <FrameBody>
            <FrameDescription>Weighted deductions per finding, capped per rule. Rate limits are infrastructure and never score.</FrameDescription>
          </FrameBody>
        </Frame>
        }
      >
        <Frame aria-label="Dimensions">
          <FrameHeader>
            <FrameTitle>Dimensions</FrameTitle>
            <FrameValue meta>{score.deductions.length} deductions</FrameValue>
          </FrameHeader>
          <FrameBody padding="none">
            <ul>
              {(Object.keys(DIM_LABEL) as Dimension[]).map((d) => {
                const v = score.dimensions[d];
                const ded = score.deductions.filter((x) => x.dimension === d);
                return (
                  <li key={d} className="flex flex-col gap-2 rule-row p-inset">
                    <Meter value={v} max={100} warnAt={null} failAt={null}>
                      <MeterLabel>{DIM_LABEL[d]}</MeterLabel>
                      <MeterValue>
                        {() => (
                          <span className="inline-flex items-center gap-1.5">
                            <StatusMark status={scoreStatus(v)} label={scoreStatus(v) === "ok" ? "Good" : scoreStatus(v) === "warn" ? "Weak" : "Failing"} />
                            {v} / 100
                          </span>
                        )}
                      </MeterValue>
                    </Meter>
                    <p className="type-caption text-text-2">{DIM_BLURB[d]}</p>
                    {ded.length > 0 && <p className="type-code-sm text-text-2">{ded.map((x) => `${x.rule} x${x.count} -${x.points}`).join(", ")}</p>}
                  </li>
                );
              })}
            </ul>
          </FrameBody>
        </Frame>

      <StatusStrip label="Run statistics">
        <StatusStripCell>
          <StatusStripLabel>Captured</StatusStripLabel>
          <StatusStripValue>
            {stats.captured}
            <StatusStripUnit>of {stats.ordersCreated} orders</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Shipped</StatusStripLabel>
          <StatusStripValue>
            {untracked > 0 && <StatusMark status="warn" />}
            {stats.shipped}
            <StatusStripUnit>{untracked > 0 ? `${untracked} untracked` : "all tracked"}</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Declined</StatusStripLabel>
          <StatusStripValue>
            {stats.declined}
            <StatusStripUnit>{stats.refunded} refunded</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Disputes</StatusStripLabel>
          <StatusStripValue>
            {stats.disputesOpened > stats.disputesResolved && <StatusMark status="fail" />}
            {stats.disputesResolved}
            <StatusStripUnit>of {stats.disputesOpened} resolved</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Webhooks</StatusStripLabel>
          <StatusStripValue>
            {stats.webhooks}
            <StatusStripUnit>median {fmtLag(stats.webhookMedianLagMs)}</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>PayPal errors</StatusStripLabel>
          <StatusStripValue>
            {stats.paypalErrors > 0 && <StatusMark status="warn" />}
            {stats.paypalErrors}
            <StatusStripUnit>{stats.rateLimits} rate limited</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
      </StatusStrip>
      </ReportCharts>

      <Frame aria-label="Findings">
        <FrameHeader>
          <FrameTitle>Findings</FrameTitle>
          <FrameValue meta>{report.findings.length} rules fired</FrameValue>
        </FrameHeader>
        <FrameBody padding="none">
          {ordered.length === 0 ? (
            <Empty variant="plain">
              <EmptyIcon />
              <EmptyHeader>
                <EmptyTitle>No findings</EmptyTitle>
                <EmptyDescription>{stats.ordersCreated === 0 ? "No orders were created yet." : "This merchant handled everything the swarm threw at it."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <CollapsibleGroup variant="plain" multiple>
              {ordered.map((f, i) => {
                const trail = f.eventIds.map((eid) => events.get(eid)).filter((e): e is SwarmEvent => !!e);
                return (
                  <Collapsible key={`${f.rule}-${i}`} value={`${f.rule}-${i}`}>
                    <CollapsibleTrigger summary={`${f.eventIds.length} ${f.eventIds.length === 1 ? "event" : "events"}`} summaryStatus={f.severity === "critical" || f.severity === "high" ? "fail" : f.severity === "medium" ? "warn" : undefined}>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <SeverityTag severity={f.severity} />
                        <span className="min-w-0 type-body-sm normal-case text-text-1">{f.title}</span>
                        <span className="type-code-sm normal-case text-text-3">{f.rule}</span>
                        <Tag size="sm" variant="outline">
                          {DIM_LABEL[f.dimension]}
                        </Tag>
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-3 p-inset">
                        <p className="type-body-sm text-text-1">{f.detail}</p>
                        <p className="type-body-sm text-text-1">
                          <Status status="ok" size="sm">
                            Fix
                          </Status>{" "}
                          {f.fix}
                        </p>
                        {f.paypalIds.length > 0 && <p className="type-code-sm text-text-2">PayPal ids {f.paypalIds.join(", ")}</p>}
                        {trail.length > 0 ? (
                          <ol className="flex flex-col border-t border-line-faint">
                            {trail.map((e) => (
                              <li key={e.id} className="grid grid-cols-[auto_auto_1fr] gap-x-3 border-b border-line-faint py-1 type-code-sm last:border-b-0">
                                <span className="text-text-3">#{e.id}</span>
                                <span className="text-text-3">{fmtSim(e.simT)}</span>
                                <span className="min-w-0 break-words text-text-1">
                                  <span className="text-text-2">{e.actor}</span> {e.type} {summarize(e)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="type-code-sm text-text-3">events {f.eventIds.join(", ")}</p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </CollapsibleGroup>
          )}
        </FrameBody>
      </Frame>

      <Frame aria-label="Cost and budget">
        <FrameHeader>
          <FrameTitle>Cost and budget</FrameTitle>
          <FrameValue meta>cap {fmtTokens(meta.tokenCap)}</FrameValue>
        </FrameHeader>
        <FrameBody padding="none">
          <DataList className="px-inset">
            <DataListItem>
              <DataListLabel>Tokens</DataListLabel>
              <DataListValue>{`${fmtTokens(stats.tokensIn + stats.tokensOut)} (${fmtTokens(stats.tokensIn)} in, ${fmtTokens(stats.tokensOut)} out, ${fmtTokens(stats.cachedTokens)} cache reads)`}</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Cost</DataListLabel>
              <DataListValue>{fmtUsd(stats.costUsd, 4)}</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>GMV</DataListLabel>
              <DataListValue>{`${fmtUsd(stats.gmvUsd)} captured, ${stats.messages} buyer messages`}</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Budget events</DataListLabel>
              <DataListValue>{`${stats.budgetWarnings} warnings, ${stats.budgetExhausted.length} exhausted${stats.cacheHits ? `, ${stats.cacheHits} dev-cache hits` : ""}`}</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Run</DataListLabel>
              <DataListValue>{`${stats.agentTurns} agent turns, ${fmtSim(stats.simMinutes)} simulated${stats.chaos.length ? `, chaos ${stats.chaos.map((c) => c.kind).join(" ")}` : ""}`}</DataListValue>
            </DataListItem>
          </DataList>
        </FrameBody>
        {simulated && (
          <FrameBody>
            <FrameDescription>
              {meta.paypalMode === "mock" ? "PayPal calls went to the in-process mock, which mirrors the Agent Toolkit tool names, schemas and 422 issue codes but is not PayPal. " : ""}
              {meta.llmMode === "scripted" ? "Agents were scripted, deterministic and token-free, rather than LLM-driven. " : ""}
              Add PayPal sandbox credentials and an OpenRouter key to run the same scenario for real.
            </FrameDescription>
          </FrameBody>
        )}
      </Frame>
    </>
  );
}
