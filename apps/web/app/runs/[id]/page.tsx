"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtLag, fmtSim, fmtTokens, fmtUsd, isTerminal, subscribe, type RunStatus as RunStatusView, type SwarmEvent } from "@/lib/api";
import { applyEvent, emptyArena, summarize, type ArenaState } from "@/lib/arena";
import { ErrorAlert, LinkButton, ModeTags, OrderStatusTag, RunStatus, ValueSkeleton } from "@/components/ui";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { DataList, DataListItem, DataListLabel, DataListValue } from "@/components/sodium/ui/data-list";
import { Frame, FrameBody, FrameDescription, FrameHeader, FrameStatus, FrameTitle, FrameValue } from "@/components/sodium/ui/frame";
import { LogViewer, type LogLevel, type LogLine } from "@/components/sodium/ui/log-viewer";
import { Meter, MeterLabel, MeterValue } from "@/components/sodium/ui/meter";
import { FilterBar, FilterBarClear, FilterBarCount, FilterToggle } from "@/components/sodium/ui/filter-bar";
import { Status, StatusMark } from "@/components/sodium/ui/status";
import { StatusStrip, StatusStripCell, StatusStripLabel, StatusStripUnit, StatusStripValue } from "@/components/sodium/ui/status-strip";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/sodium/ui/table";
import { Tag } from "@/components/sodium/ui/tag";

const CLASSES = ["shopper", "merchant", "chaos", "paypal", "analyst", "platform", "human"] as const;
const NOISY = new Set(["tool.call", "tool.result", "agent.turn"]);
const FAIL = new Set(["paypal.error", "order.capture_declined", "dispute.opened", "budget.exhausted", "run.failed"]);
const WARN = new Set(["approval.requested", "budget.warning", "infra.rate_limit", "chaos.injected", "approval.denied"]);

function levelOf(e: SwarmEvent): LogLevel {
  if (FAIL.has(e.type)) return "fail";
  if (WARN.has(e.type)) return "warn";
  if (NOISY.has(e.type)) return "debug";
  return "info";
}

const toLine = (e: SwarmEvent, i: number): LogLine => ({
  id: e.id ?? `t${e.t}-${i}`,
  time: fmtSim(e.simT),
  level: levelOf(e),
  source: e.actor,
  message: `${e.type} ${summarize(e)}${e.paypalIds.length ? ` [${e.paypalIds.slice(0, 2).join(", ")}]` : ""}`,
});

export default function ArenaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunStatusView | null>(null);
  const [state, setState] = useState<ArenaState>(emptyArena);
  const stateRef = useRef(state);
  const [error, setError] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState<string[]>([...CLASSES]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => api.getRun(id).then(setRun).catch(setError), [id]);

  useEffect(() => {
    refresh();
    const pending: SwarmEvent[] = [];
    let flush: number | undefined;
    const unsub = subscribe(id, 0, {
      onOpen: () => setConnected(true),
      onEvent: (e) => {
        pending.push(e);
        if (flush === undefined)
          flush = window.setTimeout(() => {
            flush = undefined;
            const batch = pending.splice(0);
            let next = stateRef.current;
            for (const ev of batch) next = applyEvent(next, ev);
            stateRef.current = next;
            setState(next);
            if (batch.some((ev) => ev.type.startsWith("run.") || ev.type.startsWith("approval.") || ev.type.startsWith("budget."))) refresh();
          }, 120);
      },
      onDone: () => {
        setDone(true);
        setConnected(false);
        refresh();
      },
      onError: () => setConnected(false),
    });
    const poll = setInterval(refresh, 4000);
    return () => {
      unsub();
      clearInterval(poll);
      if (flush !== undefined) clearTimeout(flush);
    };
  }, [id, refresh]);

  const filterSet = useMemo(() => new Set(filter), [filter]);
  const lines = useMemo(() => state.feed.filter((e) => filterSet.has(e.actorClass)).map(toLine), [state.feed, filterSet]);
  const classCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of state.feed) c[e.actorClass] = (c[e.actorClass] ?? 0) + 1;
    return c;
  }, [state.feed]);

  // The maps are mutated in place by applyEvent, so the event count, not the map, is what changes between renders.
  const orders = useMemo(() => [...state.orders.values()].sort((a, b) => b.lastEventId - a.lastEventId), [state.orders, state.total]);
  const pending = useMemo(() => [...state.approvals.values()].filter((a) => a.status === "pending"), [state.approvals, state.total]);
  const decided = useMemo(() => [...state.approvals.values()].filter((a) => a.status !== "pending"), [state.approvals, state.total]);
  const finished = done || (run ? isTerminal(run.status) : false);
  const cap = run?.tokenCap ?? Number(state.started?.tokenCap ?? 0);
  const tokens = run?.budget?.total ?? state.budget.tokensIn + state.budget.tokensOut;
  const cost = run?.budget?.costUsd ?? state.budget.costUsd;
  const captured = orders.filter((o) => o.status === "captured" || o.status === "shipped").length;
  const shipped = orders.filter((o) => o.status === "shipped").length;
  const declined = orders.filter((o) => o.status === "declined").length;
  const lagMedian = median(state.webhooks.map((w) => w.lagMs).filter((x): x is number => x !== null));
  const otherProfile = run?.merchantProfile === "hardened" ? "baseline" : "hardened";
  const finishReason = String(state.finished?.reason ?? run?.score?.reason ?? "");

  async function act(name: "pause" | "resume" | "stop") {
    setBusy(name);
    try {
      await api[name](id);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  async function decide(approvalId: string, decision: "granted" | "denied") {
    setBusy(approvalId + decision);
    try {
      await api.decide(id, approvalId, decision);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  async function rerun() {
    setBusy("rerun");
    try {
      const r = await api.rerun(id, { merchantProfile: otherProfile });
      router.push(`/runs/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  if (!run && error && state.total === 0) {
    return (
      <>
        <h1 className="type-title">Run</h1>
        <p className="type-code-sm text-text-2">{id}</p>
        <ErrorAlert error={error} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          {run ? (
            <h1 className="type-title">{run.name}</h1>
          ) : (
            <>
              <h1 className="sr-only">Run</h1>
              <ValueSkeleton type="heading" width="w-72" />
            </>
          )}
          <p className="type-code-sm text-text-2">
            {id}, sim clock {fmtSim(state.simT)}, {state.total} events
            {state.started ? `, ${String(state.started.shoppers)} shoppers, catalog ${String(state.started.catalogSize)}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {run && <RunStatus status={run.status} paused={run.paused} live />}
            <ModeTags modes={run?.modes ?? (state.started ? { paypal: String(state.started.paypalMode) as "mock", llm: String(state.started.llmMode) as "scripted" } : null)} />
            {run && <Tag size="sm">{run.merchantProfile} merchant</Tag>}
            {connected && !finished && (
              <Tag size="sm" variant="outline">
                Live feed
              </Tag>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!finished &&
            (run?.paused ? (
              <Button variant="secondary" pending={busy === "resume"} pendingLabel="Resuming" disabled={busy !== null} onClick={() => act("resume")}>
                Resume run
              </Button>
            ) : (
              <Button variant="secondary" pending={busy === "pause"} pendingLabel="Pausing" disabled={busy !== null || !run?.active} onClick={() => act("pause")}>
                Pause run
              </Button>
            ))}
          <LinkButton href={`/runs/${id}/studio`}>Studio</LinkButton>
          <LinkButton href={`/runs/${id}/report`}>{finished ? "Report" : "Live report"}</LinkButton>
          {!finished && (
            <Button variant="destructive" pending={busy === "stop"} pendingLabel="Stopping" disabled={busy !== null || !run?.active} onClick={() => act("stop")}>
              Stop run
            </Button>
          )}
        </div>
      </div>
      <ErrorAlert error={error} />

      {finished && (
        <Alert status={finishReason === "budget" ? "warn" : run?.status === "failed" ? "fail" : "ok"}>
          <AlertTitle>{finishReason === "budget" ? "Run stopped at the token cap" : run?.status === "failed" ? "Run failed" : run?.status === "stopped" ? "Run stopped" : "Run finished"}</AlertTitle>
          <AlertDescription>
            {state.finished
              ? `Finished (${finishReason}) with ${String(state.finished.orders)} orders, ${fmtTokens(Number(state.finished.tokens))} tokens and ${fmtUsd(Number(state.finished.costUsd), 3)}${run?.score?.score ? `; readiness score ${run.score.score.overall}, grade ${run.score.score.grade}` : ""}.`
              : run?.score?.error
                ? `The run failed: ${run.score.error}`
                : "The run has finished."}
          </AlertDescription>
          <AlertAction>
            <Button variant="secondary" size="sm" pending={busy === "rerun"} pendingLabel="Starting" disabled={busy !== null} onClick={rerun}>
              Re-run {otherProfile}
            </Button>
            <LinkButton href={`/runs/${id}/report`} variant="primary" size="sm">
              Open report
            </LinkButton>
          </AlertAction>
        </Alert>
      )}

      <StatusStrip label="Run status">
        <StatusStripCell>
          <StatusStripLabel>Orders</StatusStripLabel>
          <StatusStripValue>
            {orders.length}
            <StatusStripUnit>created</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Captured</StatusStripLabel>
          <StatusStripValue>
            {captured}
            <StatusStripUnit>{shipped} shipped</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Declined</StatusStripLabel>
          <StatusStripValue>
            {declined > 0 && <StatusMark status="fail" />}
            {declined}
            <StatusStripUnit>{state.counts.refunds} refunded</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Disputes</StatusStripLabel>
          <StatusStripValue>
            {state.counts.disputes > 0 && <StatusMark status="fail" />}
            {state.counts.disputes}
            <StatusStripUnit>open</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>PayPal errors</StatusStripLabel>
          <StatusStripValue>
            {state.counts.errors > 0 && <StatusMark status="warn" />}
            {state.counts.errors}
            <StatusStripUnit>{state.counts.rateLimits} rate limited</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Webhooks</StatusStripLabel>
          <StatusStripValue>
            {state.webhooks.length}
            <StatusStripUnit>{state.webhooks.length ? `median ${fmtLag(lagMedian)}` : "none yet"}</StatusStripUnit>
          </StatusStripValue>
        </StatusStripCell>
      </StatusStrip>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Table size="sm" title="Orders" count={orders.length} stickyHeader maxHeight={640}>
          <TableHeader>
            <TableRow>
              <TableHead>Shopper</TableHead>
              <TableHead>Order</TableHead>
              <TableHead numeric>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Timeline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableEmpty colSpan={5} title={finished ? "No orders in this run" : "Shoppers are browsing"} description={finished ? "Nothing reached checkout." : "The first order lands here as soon as a shopper checks out."} />
            ) : (
              orders.map((o) => (
                <TableRow key={o.orderId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{o.personaName}</span>
                      <span className="type-code-sm text-text-3">{o.personaId}</span>
                    </div>
                  </TableCell>
                  <TableCell mono title={o.orderId}>
                    <div className="flex flex-col">
                      <span>{o.orderId.slice(0, 8)}</span>
                      {o.captureId && <span className="text-text-3">cap {o.captureId.slice(0, 6)}</span>}
                      {o.trackingNumber && <span className="text-text-3">trk {o.trackingNumber.slice(0, 10)}</span>}
                    </div>
                  </TableCell>
                  <TableCell numeric>
                    <div className="flex flex-col items-end">
                      <span>${o.amount.toFixed(2)}</span>
                      {o.refunded > 0 && <span className="text-text-3">refunded ${o.refunded.toFixed(2)}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <OrderStatusTag status={o.status} />
                      {o.declineReason && (
                        <Tag size="sm" variant="fail">
                          {o.declineReason}
                        </Tag>
                      )}
                      {o.disputeIds.length > 0 && <Tag size="sm" variant="fail" count={o.disputeIds.length} title={`${o.disputeIds.length} disputes`} />}
                      {o.errors > 0 && (
                        <Tag size="sm" variant="warn">
                          {o.errors} errors
                        </Tag>
                      )}
                    </div>
                  </TableCell>
                  <TableCell mono>
                    <div className="flex flex-col text-text-2">
                      <span>created {fmtSim(o.createdSimT)}</span>
                      {o.capturedSimT !== undefined && <span>captured {fmtSim(o.capturedSimT)}</span>}
                      {o.shippedSimT !== undefined && <span>shipped {fmtSim(o.shippedSimT)}</span>}
                      {o.capturedSimT !== undefined && o.shippedSimT === undefined && state.simT - o.capturedSimT > 240 && <span className="text-warn-text">no tracking for {fmtSim(state.simT - o.capturedSimT)}</span>}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3">
          <FilterBar aria-label="Actors in the feed">
            {CLASSES.map((c) => (
              <FilterToggle key={c} pressed={filterSet.has(c)} onPressedChange={(on) => setFilter((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)))}>
                {c} {classCounts[c] ?? 0}
              </FilterToggle>
            ))}
            <FilterBarCount shown={lines.length} total={state.feed.length} noun="events" />
            {filter.length < CLASSES.length && <FilterBarClear onClick={() => setFilter([...CLASSES])} />}
          </FilterBar>
          <LogViewer label="Event feed" name={run?.name ?? id} lines={lines} streaming={!finished} toolbar height={560} />
        </div>

        <div className="flex flex-col gap-6">
          <Frame aria-label="Token budget">
            <FrameHeader>
              <FrameTitle>Token budget</FrameTitle>
              <FrameValue meta>{fmtUsd(cost, 3)}</FrameValue>
            </FrameHeader>
            <FrameBody>
              <Meter value={tokens} max={cap || 1} warnAt={0.8} failAt={1} statusLabel={tokens / (cap || 1) >= 1 ? "Exhausted" : "Admission stopped"}>
                <MeterLabel>Tokens</MeterLabel>
                <MeterValue>{() => `${fmtTokens(tokens)} / ${fmtTokens(cap)}`}</MeterValue>
              </Meter>
            </FrameBody>
            <FrameBody padding="none">
              <DataList className="px-inset">
                <DataListItem>
                  <DataListLabel>Input</DataListLabel>
                  <DataListValue>{fmtTokens(run?.budget?.tokensIn ?? state.budget.tokensIn)}</DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Output</DataListLabel>
                  <DataListValue>{fmtTokens(run?.budget?.tokensOut ?? state.budget.tokensOut)}</DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Cache reads</DataListLabel>
                  <DataListValue>{state.budget.cached > 0 ? fmtTokens(state.budget.cached) : null}</DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Exhausted</DataListLabel>
                  <DataListValue>{state.budget.exhausted.length ? state.budget.exhausted.join(", ") : null}</DataListValue>
                </DataListItem>
              </DataList>
            </FrameBody>
            {tokens === 0 && (
              <FrameBody>
                <FrameDescription>Scripted agents: zero tokens spent.</FrameDescription>
              </FrameBody>
            )}
          </Frame>

          <Frame aria-label="Approvals">
            <FrameHeader>
              <FrameTitle>Approvals</FrameTitle>
              {pending.length > 0 && (
                <FrameStatus>
                  <Status status="warn" size="sm">
                    {pending.length} pending
                  </Status>
                </FrameStatus>
              )}
              <FrameValue meta>{decided.length} decided</FrameValue>
            </FrameHeader>
            {pending.length === 0 ? (
              <FrameBody>
                <FrameDescription>Refunds above the threshold and dispute concessions pause here until you decide. Timeouts count as denied.</FrameDescription>
              </FrameBody>
            ) : (
              <FrameBody padding="none">
                <ul>
                  {pending.map((a, i) => (
                    <li key={a.id} className="flex flex-col gap-2 rule-row p-inset">
                      <span className="type-label-sm text-text-1">{a.kind.replace(/_/g, " ")}</span>
                      <span className="break-all type-code-sm text-text-2">
                        {Object.entries(a.payload)
                          .filter(([k]) => !["approvalId", "kind"].includes(k))
                          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                          .join(" ")
                          .slice(0, 220)}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" pending={busy === a.id + "denied"} pendingLabel="Denying" disabled={busy !== null} onClick={() => decide(a.id, "denied")}>
                          Deny
                        </Button>
                        <Button variant={i === 0 ? "primary" : "secondary"} size="sm" pending={busy === a.id + "granted"} pendingLabel="Approving" disabled={busy !== null} onClick={() => decide(a.id, "granted")}>
                          Approve
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </FrameBody>
            )}
            {decided.length > 0 && (
              <FrameBody>
                <p className="type-code-sm text-text-2">{decided.map((a) => `${a.kind} ${a.status}`).join(", ")}</p>
              </FrameBody>
            )}
          </Frame>

          <Table size="sm" title="Webhooks" count={state.webhooks.length} stickyHeader maxHeight={224}>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead numeric>Lag</TableHead>
                <TableHead>Verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.webhooks.length === 0 ? (
                <TableEmpty colSpan={3} title="No webhooks yet" description={run?.modes?.paypal === "sandbox" ? "Register the api URL in the PayPal dashboard to receive them." : "The mock does not send webhooks; sandbox runs do."} />
              ) : (
                [...state.webhooks]
                  .reverse()
                  .slice(0, 40)
                  .map((w) => (
                    <TableRow key={w.id}>
                      <TableCell mono className="whitespace-normal wrap-anywhere">
                        {w.eventType}
                      </TableCell>
                      <TableCell numeric>{fmtLag(w.lagMs)}</TableCell>
                      <TableCell>
                        {w.verified ? (
                          <Tag size="sm" variant="ok">
                            Verified
                          </Tag>
                        ) : (
                          <Tag size="sm" variant="outline">
                            Unverified
                          </Tag>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>

          {(state.chaos.length > 0 || state.insights.length > 0) && (
            <Frame aria-label="Chaos and insights">
              <FrameHeader>
                <FrameTitle>Chaos and insights</FrameTitle>
                <FrameValue meta>
                  {state.chaos.length} injected, {state.insights.length} insights
                </FrameValue>
              </FrameHeader>
              {state.chaos.length > 0 && (
                <FrameBody>
                  <ul className="flex flex-wrap gap-1">
                    {state.chaos.map((c) => (
                      <li key={c.id}>
                        <Tag size="sm" variant="fail" title={JSON.stringify(c.payload).slice(0, 200)}>
                          {c.kind.replace(/_/g, " ")} {fmtSim(c.simT)}
                        </Tag>
                      </li>
                    ))}
                  </ul>
                </FrameBody>
              )}
              {state.insights.length > 0 && (
                <FrameBody padding="none">
                  <ul>
                    {state.insights.map((i) => (
                      <li key={i.key} className="flex min-h-(--row) flex-wrap items-center justify-between gap-x-3 gap-y-1 rule-row px-inset py-1.5">
                        <span className="min-w-0 flex-1 type-body-sm text-text-1" title={i.prompt}>
                          {i.title}
                        </span>
                        <Button variant="ghost" size="sm" render={<Link href={`/runs/${id}/studio?prompt=${encodeURIComponent(i.prompt)}`} />} nativeButton={false}>
                          Open in Studio
                        </Button>
                      </li>
                    ))}
                  </ul>
                </FrameBody>
              )}
            </Frame>
          )}
        </div>
      </div>
    </>
  );
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}
