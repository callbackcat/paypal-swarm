"use client";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { AgStudioAiModule, createAiHarness, directLlmRunner, type AgAiHarness, type AgAiHarnessSetupParams, type AgAiPromptStarter, type AgDataSourcesDefinition, type AgDataTransaction, type AgStudioApi, type AgStudioReadyEvent } from "ag-studio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtSim, subscribe, type Finding, type Report, type RunStatus, type SwarmEvent } from "@/lib/api";
import { applyEvent, emptyArena, reduceAll, summarize, type ArenaState, type OrderRow } from "@/lib/arena";
import { swarmAdapter } from "@/lib/studioAdapter";
import { quietLicenceBanner } from "@/lib/quietLicenceBanner";
import { ErrorAlert, StudioSkeleton } from "@/components/ui";

type Row = Record<string, string | number | boolean | null>;

const orderRow = (o: OrderRow): Row => ({
  orderId: o.orderId,
  shopper: o.personaName,
  personaId: o.personaId,
  amountUsd: o.amount,
  refundedUsd: o.refunded,
  status: o.status,
  captureId: o.captureId ?? null,
  tracking: o.trackingNumber ?? null,
  disputes: o.disputeIds.length,
  paypalErrors: o.errors,
  createdSimMin: o.createdSimT,
  capturedSimMin: o.capturedSimT ?? null,
  shippedSimMin: o.shippedSimT ?? null,
  captureLatencyMin: o.capturedSimT !== undefined && o.approvedSimT !== undefined ? o.capturedSimT - o.approvedSimT : null,
  trackingLatencyMin: o.shippedSimT !== undefined && o.capturedSimT !== undefined ? o.shippedSimT - o.capturedSimT : null,
  declineReason: o.declineReason ?? null,
});
const eventRow = (e: SwarmEvent): Row => ({
  id: e.id ?? 0,
  simMin: e.simT,
  simClock: fmtSim(e.simT),
  at: e.t,
  actor: e.actor,
  actorClass: e.actorClass,
  type: e.type,
  summary: summarize(e),
  paypalIds: e.paypalIds.join(" "),
  tool: typeof e.payload.tool === "string" ? e.payload.tool : null,
  ok: typeof e.payload.ok === "boolean" ? e.payload.ok : null,
  httpStatus: typeof e.payload.status === "number" ? e.payload.status : null,
  issue: typeof e.payload.issue === "string" ? e.payload.issue : null,
  durationMs: typeof e.payload.durationMs === "number" ? e.payload.durationMs : null,
});
const turnRow = (e: SwarmEvent): Row => {
  const u = (e.payload.usage ?? {}) as { inputTokens?: number; outputTokens?: number; cachedTokens?: number };
  return { id: e.id ?? 0, simMin: e.simT, actor: e.actor, actorClass: e.actorClass, model: String(e.payload.model ?? ""), inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cachedTokens: u.cachedTokens ?? 0, costUsd: Number(e.payload.costUsd ?? 0), toolCalls: Array.isArray(e.payload.toolCalls) ? (e.payload.toolCalls as string[]).join(",") : "", scripted: !!e.payload.scripted };
};
const findingRow = (f: Finding, i: number): Row => ({ id: i + 1, rule: f.rule, severity: f.severity, dimension: f.dimension, title: f.title, detail: f.detail, fix: f.fix, events: f.eventIds.join(" "), paypalIds: f.paypalIds.join(" ") });
// Tables that can start empty declare their fields, so the analyst sees the schema and Studio does not warn before rows arrive.
const FINDING_FIELDS = [
  { id: "id", format: "integerFormat" }, { id: "rule", format: "textFormat" }, { id: "severity", format: "textFormat" }, { id: "dimension", format: "textFormat" },
  { id: "title", format: "textFormat" }, { id: "detail", format: "textFormat" }, { id: "fix", format: "textFormat" }, { id: "events", format: "textFormat" }, { id: "paypalIds", format: "textFormat" },
] as const;
const WEBHOOK_FIELDS = [
  { id: "id", format: "integerFormat" }, { id: "simMin", format: "integerFormat" }, { id: "eventType", format: "textFormat" }, { id: "lagMs", format: "integerFormat" },
  { id: "matchedType", format: "textFormat" }, { id: "verified", format: "textFormat" }, { id: "source", format: "textFormat" },
] as const;
const webhookRow = (e: SwarmEvent): Row => ({ id: e.id ?? 0, simMin: e.simT, eventType: String(e.payload.eventType ?? ""), lagMs: typeof e.payload.lagMs === "number" ? e.payload.lagMs : null, matchedType: String(e.payload.matchedType ?? ""), verified: e.payload.verified ? "yes" : "no", source: String(e.payload.source ?? "") });

function describe(run: RunStatus | null, report: Report | null, state: ArenaState) {
  const lines = [
    `Swarm run ${run?.id ?? ""}: scenario "${run?.scenario}", ${run?.merchantProfile} merchant profile, status ${run?.status}.`,
    `PayPal mode ${run?.modes?.paypal ?? "?"}, LLM mode ${run?.modes?.llm ?? "?"}. Sim time runs ${String(state.started?.simFactor ?? 60)}x real time; *SimMin columns are simulated minutes since the run started.`,
    report ? `Readiness score ${report.score.overall} (${report.score.grade}); dimensions: ${Object.entries(report.score.dimensions).map(([k, v]) => `${k} ${v}`).join(", ")}. ${report.findings.length} findings.` : "",
    `Tables: orders (one row per PayPal order, with capture/tracking latency), events (full event log, one row per event), turns (one row per LLM/scripted agent turn with tokens and cost), findings (readiness rules that fired), webhooks (PayPal webhooks matched to the run with lag).`,
    `Unhappy paths worth exposing: captures without tracking, declines that were shipped anyway, refunds exceeding capture, duplicate capture attempts, unanswered disputes, slow webhooks, position bias among shoppers, prompt-injection purchases.`,
  ];
  return lines.filter(Boolean).join("\n");
}

export default function SwarmStudio({ runId, autoPrompt }: { runId: string; autoPrompt?: string }) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [initial, setInitial] = useState<{ state: ArenaState; events: SwarmEvent[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [usage, setUsage] = useState({ turns: 0, tokens: 0, costUsd: 0 });
  const apiRef = useRef<AgStudioApi | null>(null);
  const harnessRef = useRef<AgAiHarness | null>(null);
  const stateRef = useRef<ArenaState>(emptyArena());
  const promptSent = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getRun(runId), api.events(runId, 0), api.report(runId).catch(() => null)])
      .then(([r, ev, rep]) => {
        if (!alive) return;
        const state = reduceAll(ev.events);
        stateRef.current = state;
        setRun(r);
        setReport(rep);
        setInitial({ state, events: ev.events });
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [runId]);

  // Live updates: push rows into the data engine as transactions once Studio is ready.
  useEffect(() => {
    if (!initial) return;
    const unsub = subscribe(runId, initial.state.lastId, {
      onEvent: (e) => {
        const before = stateRef.current;
        const after = applyEvent(before, e);
        stateRef.current = after;
        const engine = apiRef.current?.getDataEngine();
        if (!engine?.applyTransaction) return;
        const tx: AgDataTransaction[] = [{ tableId: "events", add: [eventRow(e)] }];
        if (e.type === "agent.turn") tx.push({ tableId: "turns", add: [turnRow(e)] });
        if (e.type === "webhook.received") tx.push({ tableId: "webhooks", add: [webhookRow(e)] });
        const oid = typeof e.payload.orderId === "string" ? e.payload.orderId : undefined;
        if (oid && after.orders.has(oid)) {
          const row = orderRow(after.orders.get(oid)!);
          tx.push(before.orders.has(oid) ? { tableId: "orders", update: [row] } : { tableId: "orders", add: [row] });
        }
        (engine.applyTransaction as (t: readonly AgDataTransaction[]) => Promise<unknown>)(tx).catch(() => {});
      },
      onDone: () => {
        api.report(runId).then(setReport).catch(() => {});
        api.getRun(runId).then(setRun).catch(() => {});
      },
    });
    return unsub;
  }, [initial, runId]);

  const data = useMemo<AgDataSourcesDefinition | null>(() => {
    if (!initial) return null;
    return {
      description: describe(run, report, initial.state),
      sources: [
        { id: "orders", name: "Orders", description: "One row per PayPal order created by a shopper, with capture and tracking latency in simulated minutes.", primaryKeyField: "orderId", transactions: "all", data: [...initial.state.orders.values()].map(orderRow) },
        { id: "events", name: "Events", description: "The run's full event log: agent turns, tool calls, PayPal results and errors, webhooks, chaos injections.", primaryKeyField: "id", transactions: "all", data: initial.events.map(eventRow) },
        { id: "turns", name: "Agent turns", description: "One row per agent turn with model, tokens and USD cost.", primaryKeyField: "id", transactions: "all", data: initial.events.filter((e) => e.type === "agent.turn").map(turnRow) },
        { id: "findings", name: "Findings", description: "Readiness rules that fired, with severity, dimension, fix and the event ids behind each.", primaryKeyField: "id", transactions: "all", fields: [...FINDING_FIELDS], data: (report?.findings ?? []).map(findingRow) },
        { id: "webhooks", name: "Webhooks", description: "PayPal webhooks matched to this run, with delivery lag in milliseconds.", primaryKeyField: "id", transactions: "all", fields: [...WEBHOOK_FIELDS], data: initial.events.filter((e) => e.type === "webhook.received").map(webhookRow) },
      ],
    };
    // Initial snapshot only; later rows arrive as transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const promptStarters = useMemo<AgAiPromptStarter[]>(() => {
    const base: AgAiPromptStarter[] = [
      { label: "Capture latency by shopper", prompt: "Add a bar chart of captureLatencyMin by shopper from the orders table, sorted descending, and a number tile with the median." },
      { label: "Findings by severity", prompt: "Add a table widget of the findings table grouped by severity, showing rule, title and fix. Then add a pie chart of findings count by dimension." },
      { label: "PayPal errors", prompt: "From the events table, show a table of rows where type is paypal.error with actor, tool, httpStatus, issue and summary. Add a bar chart of error count by issue." },
      { label: "Token spend per agent", prompt: "Using the turns table, add a bar chart of total inputTokens plus outputTokens by actor, and a line chart of cumulative costUsd over simMin." },
      { label: "Webhook lag", prompt: "Add a histogram-style bar chart of webhook lagMs by eventType from the webhooks table and a number tile with the median lag." },
    ];
    const insights = stateRef.current.insights.map((i) => ({ label: i.title, prompt: i.prompt }));
    return [...insights, ...base];
  }, [initial]);

  const ai = useCallback(
    (params: AgAiHarnessSetupParams) => {
      const adapter = swarmAdapter({ runId, onUsage: (u) => setUsage((s) => ({ turns: s.turns + 1, tokens: s.tokens + u.inputTokens + u.outputTokens, costUsd: s.costUsd + u.costUsd })) });
      const harness = createAiHarness(params.api as AgStudioApi, ({ tools: { studio }, builtIn }) => ({
        primary: "analyst",
        promptStarters,
        agents: [
          directLlmRunner({
            id: "analyst",
            name: "Swarm analyst",
            description: "Reads the run's event log and builds widgets that expose where the merchant failed agentic shoppers.",
            adapter,
            maxTurns: 10,
            instructions: () =>
              [
                "You are the Swarm analyst inside AG Studio. The dataset is the event log of one simulated agentic-commerce run against a PayPal store.",
                describe(run, report, stateRef.current),
                "Work method: call viewSchema once, then executeQuery to check the numbers, then addWidget with a clear title. Prefer one precise widget over three vague ones. Always say in one sentence what the widget reveals about agent-readiness and which readiness rule it relates to.",
                "Keep answers short. Never invent PayPal ids; only cite ids present in the data.",
              ].join("\n\n"),
            tools: () => [studio.viewSchema(), studio.viewReport(), studio.viewPage(), studio.executeQuery(), studio.addWidget(), studio.removeWidget(), studio.positionWidget(), studio.addPageFilter(), studio.removePageFilter(), studio.addWidgetFilter(), studio.createExpression()],
          }),
          ...(["data", "widget", "page", "planning", "lead"] as const).map((k) => directLlmRunner({ ...builtIn[k], adapter })),
        ],
      }));
      harnessRef.current = harness;
      return harness;
    },
    [runId, run, report, promptStarters],
  );

  const onStudioReady = useCallback(
    (e: AgStudioReadyEvent) => {
      apiRef.current = e.api;
      if (autoPrompt && !promptSent.current && harnessRef.current) {
        promptSent.current = true;
        harnessRef.current
          .createThread({ agentId: "analyst", title: autoPrompt.slice(0, 60) })
          .then((s) => s.sendMessage(autoPrompt))
          .catch((err) => setError(err));
      }
    },
    [autoPrompt],
  );

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <StudioSkeleton />;
  const licenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY || undefined;
  // Installed during render so it is in place before AG Studio mounts and prints its banner.
  if (!licenseKey) quietLicenceBanner();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 type-code-sm text-text-2">
        <span>
          {data.sources.map((s) => `${s.name ?? s.id} ${"data" in s ? s.data.length : "?"}`).join(", ")}
          {run?.modes?.llm === "scripted" && !process.env.NEXT_PUBLIC_OPENROUTER_HINT ? "; the analyst needs OPENROUTER_API_KEY on the api to think, widgets and prompt starters still work in edit mode" : ""}
        </span>
        <span>
          studio turns {usage.turns}, {usage.tokens} tokens, ${usage.costUsd.toFixed(4)}
          {!licenseKey ? "; AG Studio runs on its trial licence (watermark) until NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY is set" : ""}
        </span>
      </div>
      <div className="ag-studio-host frame overflow-hidden">
        <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={licenseKey}>
          <AgStudio mode="edit" data={data} ai={ai} onStudioReady={onStudioReady} />
        </AgStudioProvider>
      </div>
    </div>
  );
}
