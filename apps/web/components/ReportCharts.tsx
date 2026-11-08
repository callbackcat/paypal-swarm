"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, fmtSim, fmtTokens, fmtUsd, type Dimension, type Report, type SwarmEvent } from "@/lib/api";
import { BarBlocks, type BarBlock } from "@/components/sodium/ui/bar-blocks";
import { Chart } from "@/components/sodium/ui/chart";
import { Frame, FrameBody, FrameDescription, FrameHeader, FrameTitle, FrameValue } from "@/components/sodium/ui/frame";
import { Status, type StatusValue } from "@/components/sodium/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/sodium/ui/table";

/**
 * The Report's charts, all Sodium: the order funnel over simulated time as a step chart, spend by agent class as bar
 * blocks, and the before-and-after against the latest finished run of the same scenario with the other merchant
 * profile. Everything is computed from the run's own events and reports, so a replay draws the same picture.
 */
const DIMS: Array<[Dimension, string]> = [
  ["discoverability", "Discoverability"],
  ["transactability", "Transactability"],
  ["fulfilment", "Fulfilment"],
  ["resilience", "Resilience"],
];
const ORDER_CONFIG = {
  created: { label: "Created" },
  captured: { label: "Captured" },
  shipped: { label: "Shipped", status: "ok" as const },
  declined: { label: "Declined", status: "fail" as const },
};
const CLASS_LABEL: Record<string, string> = { shopper: "Shoppers", merchant: "Merchant", analyst: "Analyst", chaos: "Chaos", studio: "Studio" };

/** Cumulative order counts in about a dozen even buckets of simulated time. */
export function orderTimeline(events: SwarmEvent[], simMinutes: number) {
  // The span is the order activity, not the settle phase that fast-forwards the clock to the 24-hour SLAs.
  const orderT = events.filter((e) => e.type.startsWith("order.")).map((e) => e.simT);
  const span = Math.max(60, orderT.length ? Math.max(...orderT) * 1.05 : Math.min(simMinutes || 0, 360));
  const buckets = 12;
  const step = span / buckets;
  const rows = Array.from({ length: buckets + 1 }, (_, i) => ({ at: Math.round(i * step), created: 0, captured: 0, shipped: 0, declined: 0 }));
  const key: Partial<Record<string, keyof (typeof rows)[number]>> = { "order.created": "created", "order.captured": "captured", "order.shipped": "shipped", "order.capture_declined": "declined" };
  for (const e of events) {
    const k = key[e.type];
    if (!k || k === "at") continue;
    const i = Math.min(buckets, Math.max(0, Math.ceil(e.simT / step)));
    for (let j = i; j <= buckets; j++) rows[j]![k] += 1;
  }
  return rows;
}

/** Spend and tokens per agent class from the agent.turn events. */
export function spendByClass(events: SwarmEvent[]) {
  const by = new Map<string, { usd: number; tokens: number }>();
  for (const e of events) {
    if (e.type !== "agent.turn") continue;
    const usage = (e.payload.usage ?? {}) as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    const usd = Number(e.payload.costUsd ?? (e.payload.usage as { costUsd?: number } | undefined)?.costUsd ?? 0) || 0;
    const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const cur = by.get(e.actorClass) ?? { usd: 0, tokens: 0 };
    cur.usd += usd;
    cur.tokens += tokens;
    by.set(e.actorClass, cur);
  }
  return [...by.entries()].sort((a, b) => b[1].usd - a[1].usd || b[1].tokens - a[1].tokens);
}

const delta = (a: number, b: number): { word: string; status: StatusValue } => {
  const d = a - b;
  if (d > 0) return { word: `+${d}`, status: "ok" };
  if (d < 0) return { word: String(d), status: "fail" };
  return { word: "same", status: "idle" };
};

export function ReportCharts({ runId, report, events }: { runId: string; report: Report; events: SwarmEvent[] }) {
  const { stats, meta, score } = report;
  const timeline = useMemo(() => orderTimeline(events, stats.simMinutes), [events, stats.simMinutes]);
  const spend = useMemo(() => spendByClass(events), [events]);
  const [other, setOther] = useState<{ id: string; name: string; report: Report } | null | undefined>(undefined);

  // The latest finished run of the same scenario with the other merchant profile: the before or the after.
  useEffect(() => {
    let alive = true;
    const want = meta.merchantProfile === "hardened" ? "baseline" : "hardened";
    api
      .listRuns()
      .then(async ({ runs }) => {
        const match = runs.find((r) => r.id !== runId && r.scenario === meta.scenario && r.merchantProfile === want && r.status === "finished" && r.score);
        if (!match) return null;
        const rep = await api.report(match.id);
        return { id: match.id, name: match.name, report: rep };
      })
      .then((o) => alive && setOther(o))
      .catch(() => alive && setOther(null));
    return () => {
      alive = false;
    };
  }, [runId, meta.scenario, meta.merchantProfile]);

  const blocks: BarBlock[] = spend
    .filter(([, v]) => v.usd > 0 || v.tokens > 0)
    .map(([cls, v], i) => ({ label: CLASS_LABEL[cls] ?? cls, value: v.tokens, tone: i === 0 ? "accent" : "well" }));
  const totalTokens = spend.reduce((n, [, v]) => n + v.tokens, 0);
  const baseline = other ? (meta.merchantProfile === "hardened" ? other.report : report) : null;
  const hardened = other ? (meta.merchantProfile === "hardened" ? report : other.report) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Chart
        className="lg:col-span-2"
        type="line"
        curve="step"
        frame="frame"
        label="Orders over simulated time"
        value={`${stats.captured} captured`}
        description={`Cumulative, ${fmtSim(stats.simMinutes)} simulated. The gap between captured and shipped is the tracking debt the fulfilment rules score.`}
        data={timeline}
        xKey="at"
        config={ORDER_CONFIG}
        accent="captured"
        xFormat={(v) => fmtSim(Number(v))}
        height={220}
        empty="No orders yet."
      />

      <Frame aria-label="Spend by agent">
        <FrameHeader>
          <FrameTitle>Spend by agent</FrameTitle>
          <FrameValue meta>{fmtUsd(stats.costUsd, 4)}</FrameValue>
        </FrameHeader>
        <FrameBody>
          <BarBlocks label="Tokens by agent class for this run" data={blocks} valueFormat={(v) => fmtTokens(v)} empty="Scripted agents use no tokens." />
        </FrameBody>
        <FrameBody>
          <FrameDescription>
            {totalTokens > 0 ? `${fmtTokens(totalTokens)} tokens across ${stats.agentTurns} agent turns. ` : ""}
            {spend.map(([cls, v]) => `${CLASS_LABEL[cls] ?? cls} ${fmtUsd(v.usd, 4)}`).join(", ")}
            {spend.length ? "." : "No agent turns recorded."}
          </FrameDescription>
        </FrameBody>
      </Frame>

      <Frame aria-label="Before and after" className="lg:col-span-3">
        <FrameHeader>
          <FrameTitle>Before and after</FrameTitle>
          <FrameValue meta>{other ? `vs ${other.name}` : other === undefined ? "looking for the other profile" : "no other profile yet"}</FrameValue>
        </FrameHeader>
        {baseline && hardened && other ? (
          <>
            <FrameBody padding="none">
              <Table size="sm" aria-label="Scores by dimension, baseline against hardened">
                <TableHeader>
                  <TableRow>
                    <TableHead>Dimension</TableHead>
                    <TableHead numeric>Baseline</TableHead>
                    <TableHead numeric>Hardened</TableHead>
                    <TableHead>Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DIMS.map(([d, label]) => {
                    const b = baseline.score.dimensions[d];
                    const h = hardened.score.dimensions[d];
                    const dl = delta(h, b);
                    return (
                      <TableRow key={d}>
                        <TableCell>{label}</TableCell>
                        <TableCell numeric>{String(b)}</TableCell>
                        <TableCell numeric>{String(h)}</TableCell>
                        <TableCell>
                          <Status status={dl.status} size="sm">
                            {dl.word}
                          </Status>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(() => {
                    const dl = delta(hardened.score.overall, baseline.score.overall);
                    return (
                      <TableRow>
                        <TableCell>Overall</TableCell>
                        <TableCell numeric>{`${baseline.score.overall} (${baseline.score.grade})`}</TableCell>
                        <TableCell numeric>{`${hardened.score.overall} (${hardened.score.grade})`}</TableCell>
                        <TableCell>
                          <Status status={dl.status} size="sm">
                            {dl.word}
                          </Status>
                        </TableCell>
                      </TableRow>
                    );
                  })()}
                  <TableRow>
                    <TableCell>Findings</TableCell>
                    <TableCell numeric>{String(baseline.findings.length)}</TableCell>
                    <TableCell numeric>{String(hardened.findings.length)}</TableCell>
                    <TableCell>
                      <Status status={hardened.findings.length < baseline.findings.length ? "ok" : hardened.findings.length > baseline.findings.length ? "fail" : "idle"} size="sm">
                        {hardened.findings.length < baseline.findings.length ? `${baseline.findings.length - hardened.findings.length} fewer` : hardened.findings.length > baseline.findings.length ? `${hardened.findings.length - baseline.findings.length} more` : "same"}
                      </Status>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Cost</TableCell>
                    <TableCell numeric>{fmtUsd(baseline.stats.costUsd, 4)}</TableCell>
                    <TableCell numeric>{fmtUsd(hardened.stats.costUsd, 4)}</TableCell>
                    <TableCell>{fmtTokens(baseline.stats.tokensIn + baseline.stats.tokensOut)} vs {fmtTokens(hardened.stats.tokensIn + hardened.stats.tokensOut)} tokens</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </FrameBody>
            <FrameBody>
              <FrameDescription>
                Same scenario, same chaos schedule, the merchant profile flipped. Open the other report:{" "}
                <Link href={`/runs/${other.id}/report`} className="text-accent-text hover:underline">
                  {other.name}
                </Link>
                .
              </FrameDescription>
            </FrameBody>
          </>
        ) : (
          <FrameBody>
            <FrameDescription>
              {other === undefined
                ? "Checking recent runs for the same scenario with the other merchant profile."
                : `No finished ${meta.merchantProfile === "hardened" ? "baseline" : "hardened"} run of ${meta.scenario} yet. ${meta.merchantProfile === "hardened" ? "Re-run as baseline" : "Re-run with fix"} above and this table fills in with the before and after. This run scored ${score.overall}.`}
            </FrameDescription>
          </FrameBody>
        )}
      </Frame>
    </div>
  );
}
