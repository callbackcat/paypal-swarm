"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtLag, fmtSim, fmtTokens, fmtUsd, isTerminal, subscribe, type RunStatus, type SwarmEvent } from "@/lib/api";
import { ACTOR_COLORS, ORDER_STATUS_CLASS, applyEvent, emptyArena, summarize, type ArenaState } from "@/lib/arena";
import { Bar, Chip, Empty, ErrorBox, ModeBadges, Section, Stat, StatusChip } from "@/components/ui";

const CLASSES = ["shopper", "merchant", "chaos", "paypal", "analyst", "platform", "human"] as const;
const NOISY = new Set(["tool.call", "tool.result", "agent.turn"]);

export default function ArenaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunStatus | null>(null);
  const [state, setState] = useState<ArenaState>(emptyArena);
  const stateRef = useRef(state);
  const [error, setError] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState<Set<string>>(new Set(CLASSES));
  const [showNoisy, setShowNoisy] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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

  useEffect(() => {
    if (autoScroll && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [state.total, autoScroll]);

  const feed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.feed.filter((e) => filter.has(e.actorClass) && (showNoisy || !NOISY.has(e.type)) && (!q || summarize(e).toLowerCase().includes(q) || e.actor.toLowerCase().includes(q) || e.type.includes(q) || e.paypalIds.some((p) => p.toLowerCase().includes(q))));
  }, [state.feed, filter, showNoisy, query]);

  const orders = useMemo(() => [...state.orders.values()].sort((a, b) => b.lastEventId - a.lastEventId), [state.orders]);
  const pending = useMemo(() => [...state.approvals.values()].filter((a) => a.status === "pending"), [state.approvals]);
  const finished = done || (run ? isTerminal(run.status) : false);
  const cap = run?.tokenCap ?? Number(state.started?.tokenCap ?? 0);
  const tokens = run?.budget?.total ?? state.budget.tokensIn + state.budget.tokensOut;
  const cost = run?.budget?.costUsd ?? state.budget.costUsd;

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
    setBusy(approvalId);
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
      const r = await api.rerun(id, { merchantProfile: run?.merchantProfile === "hardened" ? "baseline" : "hardened" });
      router.push(`/runs/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{run?.name ?? "Run"}</h1>
            {run && <StatusChip status={run.paused ? "paused" : run.status} />}
            <ModeBadges modes={run?.modes ?? (state.started ? { paypal: String(state.started.paypalMode) as "mock", llm: String(state.started.llmMode) as "scripted" } : null)} compact />
            <Chip tone="muted">{run?.merchantProfile ?? "…"} merchant</Chip>
            {connected && !finished && (
              <Chip tone="ok">
                <span className="live-dot mr-1.5" />
                live
              </Chip>
            )}
          </div>
          <div className="muted mono mt-1 text-xs">
            {id} · sim clock {fmtSim(state.simT)} · {state.total} events{state.started ? ` · ${String(state.started.shoppers)} shoppers · catalog ${String(state.started.catalogSize)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!finished && (
            <>
              {run?.paused ? (
                <button className="btn" disabled={busy !== null} onClick={() => act("resume")}>
                  ▶ Resume
                </button>
              ) : (
                <button className="btn" disabled={busy !== null || !run?.active} onClick={() => act("pause")}>
                  ❚❚ Pause
                </button>
              )}
              <button className="btn btn-danger" disabled={busy !== null || !run?.active} onClick={() => act("stop")}>
                ■ Stop
              </button>
            </>
          )}
          <Link href={`/runs/${id}/studio`} className="btn">
            Studio
          </Link>
          <Link href={`/runs/${id}/report`} className={`btn ${finished ? "btn-primary" : ""}`}>
            Report {finished ? "→" : "(live)"}
          </Link>
        </div>
      </header>
      <ErrorBox error={error} />

      {finished && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: "var(--accent)" }}>
          <div className="text-sm">
            <span className="font-medium">Run finished</span>
            {state.finished && <span className="muted"> · reason {String(state.finished.reason)} · {String(state.finished.orders)} orders · {fmtTokens(Number(state.finished.tokens))} tokens · {fmtUsd(Number(state.finished.costUsd), 3)}</span>}
            {run?.score?.score && (
              <span className="ml-2">
                score <span className="mono font-semibold">{run.score.score.overall}</span> ({run.score.score.grade})
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn" disabled={busy !== null} onClick={rerun}>
              Re-run with {run?.merchantProfile === "hardened" ? "baseline" : "hardened fix"}
            </button>
            <Link href={`/runs/${id}/report`} className="btn btn-primary">
              Open report
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Orders" value={orders.length} sub={`${orders.filter((o) => o.status === "captured" || o.status === "shipped").length} captured · ${orders.filter((o) => o.status === "shipped").length} shipped`} />
        <Stat label="Declined / refunds / disputes" value={`${orders.filter((o) => o.status === "declined").length} / ${state.counts.refunds} / ${state.counts.disputes}`} tone={state.counts.disputes ? "bad" : undefined} />
        <Stat label="PayPal errors" value={state.counts.errors} sub={state.counts.rateLimits ? `${state.counts.rateLimits} rate limits (not scored)` : "429s excluded from score"} tone={state.counts.errors ? "warn" : undefined} />
        <Stat label="Webhooks" value={state.webhooks.length} sub={state.webhooks.length ? `median lag ${fmtLag(median(state.webhooks.map((w) => w.lagMs).filter((x): x is number => x !== null)))}` : "none yet"} />
        <Stat label="Agent turns" value={state.counts.turns} sub={`${state.counts.toolCalls} tool calls · ${state.counts.messages} messages`} />
        <Stat label="Pending approvals" value={pending.length} tone={pending.length ? "warn" : undefined} sub={pending.length ? "merchant is waiting on you" : "none"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_320px]">
        <Section title={`Order board (${orders.length})`} bodyClass="p-0 max-h-[640px] overflow-auto scroll-thin">
          {orders.length === 0 ? (
            <Empty>Shoppers are browsing…</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Shopper</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Timeline (sim)</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.orderId}>
                    <td>
                      <div className="truncate" style={{ maxWidth: 140 }}>
                        {o.personaName}
                      </div>
                      <div className="mono muted text-[11px]">{o.personaId}</div>
                    </td>
                    <td className="mono text-xs" title={o.orderId}>
                      {o.orderId.slice(0, 8)}…{o.captureId && <div className="muted">cap {o.captureId.slice(0, 6)}…</div>}
                      {o.trackingNumber && <div className="muted">trk {o.trackingNumber.slice(0, 10)}</div>}
                    </td>
                    <td className="mono">
                      ${o.amount.toFixed(2)}
                      {o.refunded > 0 && <div style={{ color: "var(--warn)" }}>−${o.refunded.toFixed(2)}</div>}
                    </td>
                    <td>
                      <span className={`chip ${ORDER_STATUS_CLASS[o.status]}`}>{o.status}</span>
                      {o.declineReason && <div className="mono text-[11px]" style={{ color: "var(--bad)" }}>{o.declineReason}</div>}
                      {o.disputeIds.length > 0 && <div className="mono text-[11px]" style={{ color: "var(--bad)" }}>{o.disputeIds.length} dispute</div>}
                      {o.errors > 0 && <div className="text-[11px]" style={{ color: "var(--warn)" }}>{o.errors} PayPal errors</div>}
                    </td>
                    <td className="mono muted text-[11px]">
                      <div>created {fmtSim(o.createdSimT)}</div>
                      {o.capturedSimT !== undefined && <div>captured {fmtSim(o.capturedSimT)}</div>}
                      {o.shippedSimT !== undefined && <div style={{ color: "var(--ok)" }}>shipped {fmtSim(o.shippedSimT)}</div>}
                      {o.capturedSimT !== undefined && o.shippedSimT === undefined && state.simT - o.capturedSimT > 240 && <div style={{ color: "var(--warn)" }}>no tracking for {fmtSim(state.simT - o.capturedSimT)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section
          title={`Live feed (${feed.length}${feed.length !== state.feed.length ? ` of ${state.feed.length}` : ""})`}
          right={
            <div className="flex items-center gap-1">
              <input className="input py-1 text-xs" style={{ width: 150 }} placeholder="search ids, text…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className={`chip ${showNoisy ? "chip-accent" : "chip-muted"}`} onClick={() => setShowNoisy((v) => !v)} title="Show tool calls and agent turns">
                tools
              </button>
              <button className={`chip ${autoScroll ? "chip-accent" : "chip-muted"}`} onClick={() => setAutoScroll((v) => !v)}>
                follow
              </button>
            </div>
          }
          bodyClass="p-0"
        >
          <div className="flex flex-wrap gap-1 px-3 py-2" style={{ borderBottom: "1px solid var(--line)" }}>
            {CLASSES.map((c) => (
              <button
                key={c}
                className="chip"
                style={{ color: filter.has(c) ? ACTOR_COLORS[c] : "var(--muted)", borderColor: filter.has(c) ? ACTOR_COLORS[c] : undefined, opacity: filter.has(c) ? 1 : 0.5 }}
                onClick={() =>
                  setFilter((f) => {
                    const n = new Set(f);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
              >
                {c}
              </button>
            ))}
          </div>
          <div ref={feedRef} className="max-h-[600px] overflow-auto scroll-thin" onScroll={(e) => setAutoScroll(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
            {feed.length === 0 && <Empty>Waiting for events…</Empty>}
            {feed.map((e) => (
              <FeedRow key={e.id ?? `${e.t}-${e.type}`} e={e} />
            ))}
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="Token budget">
            <div className="flex items-end justify-between text-sm">
              <span className="mono text-lg font-semibold">{fmtTokens(tokens)}</span>
              <span className="muted text-xs">cap {fmtTokens(cap)}</span>
            </div>
            <div className="mt-2">
              <Bar value={tokens} max={cap || 1} tone={cap && tokens / cap > 0.8 ? "warn" : "ok"} />
            </div>
            <div className="muted mt-2 flex justify-between text-xs">
              <span>in {fmtTokens(run?.budget?.tokensIn ?? state.budget.tokensIn)} · out {fmtTokens(run?.budget?.tokensOut ?? state.budget.tokensOut)}</span>
              <span className="mono">{fmtUsd(cost, 3)}</span>
            </div>
            {state.budget.cached > 0 && <div className="muted text-xs">cache reads {fmtTokens(state.budget.cached)}</div>}
            {state.budget.warnings > 0 && <div className="mt-1 text-xs" style={{ color: "var(--warn)" }}>80 % reached: no new shoppers admitted</div>}
            {state.budget.exhausted.length > 0 && <div className="mt-1 text-xs" style={{ color: "var(--bad)" }}>exhausted: {state.budget.exhausted.join(", ")}</div>}
            {tokens === 0 && <div className="muted mt-1 text-xs">Scripted agents: zero tokens spent.</div>}
          </Section>

          <Section title={`Approvals${pending.length ? ` (${pending.length} pending)` : ""}`}>
            {pending.length === 0 && <div className="muted text-xs">Refunds above the threshold and dispute concessions pause here until you decide. Timeouts count as denied.</div>}
            <ul className="space-y-2">
              {pending.map((a) => (
                <li key={a.id} className="panel-2 p-2 text-xs">
                  <div className="font-medium">{a.kind.replace(/_/g, " ")}</div>
                  <div className="muted mono mt-0.5 break-all">
                    {Object.entries(a.payload)
                      .filter(([k]) => !["approvalId", "kind"].includes(k))
                      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                      .join(" · ")
                      .slice(0, 220)}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="btn btn-primary py-1 text-xs" disabled={busy !== null} onClick={() => decide(a.id, "granted")}>
                      Approve
                    </button>
                    <button className="btn btn-danger py-1 text-xs" disabled={busy !== null} onClick={() => decide(a.id, "denied")}>
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {[...state.approvals.values()].filter((a) => a.status !== "pending").length > 0 && (
              <div className="muted mt-2 text-[11px]">
                decided: {[...state.approvals.values()].filter((a) => a.status !== "pending").map((a) => `${a.kind} ${a.status}`).join(" · ")}
              </div>
            )}
          </Section>

          <Section title="Webhook ticker" bodyClass="p-0 max-h-56 overflow-auto scroll-thin">
            {state.webhooks.length === 0 ? (
              <Empty>No webhooks yet{run?.modes?.paypal === "sandbox" ? " (register the api URL in the PayPal dashboard)" : ""}</Empty>
            ) : (
              <ul className="text-xs">
                {[...state.webhooks].reverse().slice(0, 40).map((w) => (
                  <li key={w.id} className="feed-row flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="mono truncate">{w.eventType}</span>
                    <span className="muted mono whitespace-nowrap">
                      {fmtLag(w.lagMs)}
                      {w.verified ? " ✓" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(state.chaos.length > 0 || state.insights.length > 0) && (
            <Section title="Chaos & insights">
              <div className="flex flex-wrap gap-1">
                {state.chaos.map((c) => (
                  <Chip key={c.id} tone="bad" title={JSON.stringify(c.payload).slice(0, 200)}>
                    ⚡ {c.kind} @ {fmtSim(c.simT)}
                  </Chip>
                ))}
              </div>
              {state.insights.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {state.insights.map((i) => (
                    <li key={i.key}>
                      <Link href={`/runs/${id}/studio?prompt=${encodeURIComponent(i.prompt)}`} className="chip chip-info hover:opacity-80" title={i.prompt}>
                        ✦ {i.title} → Studio
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedRow({ e }: { e: SwarmEvent }) {
  const color = ACTOR_COLORS[e.actorClass] ?? "var(--muted)";
  const bad = e.type === "paypal.error" || e.type === "order.capture_declined" || e.type === "dispute.opened" || e.type === "budget.exhausted";
  const warn = e.type === "approval.requested" || e.type === "budget.warning" || e.type === "infra.rate_limit" || e.type === "chaos.injected";
  return (
    <div className="feed-row grid grid-cols-[52px_96px_1fr] gap-2 px-3 py-1.5 text-xs" style={{ background: bad ? "color-mix(in srgb, var(--bad) 7%, transparent)" : warn ? "color-mix(in srgb, var(--warn) 6%, transparent)" : undefined }}>
      <span className="mono muted">{fmtSim(e.simT)}</span>
      <span className="truncate font-medium" style={{ color }} title={e.actor}>
        {e.actor}
      </span>
      <span>
        <span className="mono muted mr-1.5">{e.type}</span>
        <span className="break-words">{summarize(e)}</span>
        {e.paypalIds.length > 0 && <span className="mono muted ml-1.5 text-[10px]">[{e.paypalIds.slice(0, 2).join(", ")}]</span>}
      </span>
    </div>
  );
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}
