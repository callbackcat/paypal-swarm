"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, fmtTokens, fmtUsd, type Estimate, type Modes, type RunConfigInput, type RunListItem, type ScenariosResponse } from "@/lib/api";
import { Chip, ErrorBox, ModeBadges, Section, StatusChip } from "@/components/ui";

const PROFILES: Array<{ id: "baseline" | "hardened"; label: string; blurb: string }> = [
  { id: "baseline", label: "Baseline merchant", blurb: "Captures on every approval, treats HTTP 200 as paid, ships only when asked, ignores disputes until prompted. The way most first agents are wired." },
  { id: "hardened", label: "Hardened merchant", blurb: "Per-order capture lock + PayPal-Request-Id, reads capture status, auto-tracking, refund clamping, dispute SLA, human approval above the threshold." },
];

export default function SetupPage() {
  const router = useRouter();
  const [data, setData] = useState<ScenariosResponse | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [scenario, setScenario] = useState("quiet-tuesday");
  const [profile, setProfile] = useState<"baseline" | "hardened">("baseline");
  const [shoppers, setShoppers] = useState<string>("");
  const [tokenCap, setTokenCap] = useState<string>("");
  const [threshold, setThreshold] = useState<string>("50");
  const [llm, setLlm] = useState<"auto" | "scripted" | "live">("auto");
  const [paypal, setPaypal] = useState<"auto" | "mock" | "sandbox">("auto");
  const [byo, setByo] = useState(false);
  const [orKey, setOrKey] = useState("");
  const [ppId, setPpId] = useState("");
  const [ppSecret, setPpSecret] = useState("");
  const [estimate, setEstimate] = useState<{ estimate: Estimate; modes: Modes; tokenCap: number; shoppers: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [guardrails, setGuardrails] = useState(false);

  useEffect(() => {
    api.scenarios().then(setData).catch(setError);
    api.listRuns().then((r) => setRuns(r.runs.slice(0, 8))).catch(() => {});
  }, []);

  const current = data?.scenarios.find((s) => s.id === scenario);
  const config = useMemo<RunConfigInput>(() => {
    const cfg: RunConfigInput = { scenario, merchantProfile: profile, llm, paypal, approvalThresholdUsd: Number(threshold) || 50 };
    if (shoppers) cfg.shoppers = Number(shoppers);
    if (tokenCap) cfg.tokenCap = Number(tokenCap);
    if (byo && orKey.trim()) cfg.openrouterApiKey = orKey.trim();
    if (byo && ppId.trim() && ppSecret.trim()) cfg.credentials = { clientId: ppId.trim(), clientSecret: ppSecret.trim() };
    return cfg;
  }, [scenario, profile, llm, paypal, threshold, shoppers, tokenCap, byo, orKey, ppId, ppSecret]);

  useEffect(() => {
    if (!current || current.status !== "ready") return;
    let alive = true;
    setEstimating(true);
    const t = setTimeout(() => {
      api
        .estimate(config)
        .then((r) => alive && setEstimate(r))
        .catch((e) => alive && setError(e))
        .finally(() => alive && setEstimating(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [config, current]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const run = await api.createRun(config);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError(e);
      setStarting(false);
    }
  }

  const est = estimate?.estimate;
  const overCap = !!est?.overCap;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pick a scenario</h1>
          <p className="muted mt-1 max-w-3xl text-sm">
            Swarm points LLM shoppers, a merchant agent and a chaos agent at a PayPal sandbox store, watches what breaks, and scores how ready the store is for agentic commerce. Nothing here touches a real PayPal account unless you give it sandbox credentials.
          </p>
        </div>
        <ErrorBox error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(data?.scenarios ?? []).map((s) => {
            const ready = s.status === "ready";
            const active = s.id === scenario;
            return (
              <button key={s.id} disabled={!ready} onClick={() => setScenario(s.id)} className="panel text-left transition disabled:opacity-50" style={{ borderColor: active ? "var(--accent)" : undefined, padding: 16 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{s.name}</div>
                  {ready ? <Chip tone={active ? "accent" : "muted"}>{s.shoppers} shoppers · {s.durationMin} min</Chip> : <Chip tone="muted">coming</Chip>}
                </div>
                <div className="muted mt-1 text-sm">{s.tagline}</div>
                {ready && s.chaosDescription.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--bad)" }}>
                    {s.chaosDescription.slice(0, 4).map((c, i) => (
                      <li key={i}>⚡ {c}</li>
                    ))}
                  </ul>
                )}
                {ready && s.liveEstimate && (
                  <div className="muted mt-2 text-xs">
                    live LLM ≈ {fmtTokens(s.liveEstimate.tokens)} tokens · {fmtUsd(s.liveEstimate.usd)} · cap {fmtTokens(s.tokenCap)}
                  </div>
                )}
              </button>
            );
          })}
          {!data && <div className="muted text-sm">Loading scenarios from the api…</div>}
        </div>

        <Section title="Merchant profile">
          <div className="grid gap-3 sm:grid-cols-2">
            {PROFILES.map((p) => (
              <button key={p.id} onClick={() => setProfile(p.id)} className="panel-2 p-3 text-left" style={{ borderColor: profile === p.id ? "var(--accent)" : undefined }}>
                <div className="font-medium">{p.label}</div>
                <div className="muted mt-1 text-xs">{p.blurb}</div>
              </button>
            ))}
          </div>
          <p className="muted mt-3 text-xs">Run baseline first, read the report, then hit “Re-run with fix” to see the same scenario against the hardened profile. Both are prompt + code, so findings reproduce.</p>
        </Section>

        <Section title="Options" right={<button className="btn" onClick={() => setGuardrails((g) => !g)}>{guardrails ? "Hide" : "Show"} allow-lists</button>}>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className="muted">Shoppers</span>
              <input className="input mt-1" placeholder={String(current?.shoppers ?? "")} value={shoppers} onChange={(e) => setShoppers(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="text-xs">
              <span className="muted">Run token cap</span>
              <input className="input mt-1" placeholder={String(current?.tokenCap ?? "")} value={tokenCap} onChange={(e) => setTokenCap(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="text-xs">
              <span className="muted">Approval above (USD)</span>
              <input className="input mt-1" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d.]/g, ""))} />
            </label>
            <label className="text-xs">
              <span className="muted">Agents</span>
              <select className="input mt-1" value={llm} onChange={(e) => setLlm(e.target.value as typeof llm)}>
                <option value="auto">auto (live if a key exists)</option>
                <option value="scripted">scripted (zero tokens)</option>
                <option value="live">live LLM</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="muted">PayPal</span>
              <select className="input mt-1" value={paypal} onChange={(e) => setPaypal(e.target.value as typeof paypal)}>
                <option value="auto">auto (sandbox if creds exist)</option>
                <option value="mock">mock</option>
                <option value="sandbox">sandbox</option>
              </select>
            </label>
            <label className="flex items-end gap-2 text-xs sm:col-span-3">
              <input type="checkbox" checked={byo} onChange={(e) => setByo(e.target.checked)} />
              <span>Bring your own keys (encrypted at rest with SWARM_KMS_KEY, never written to events)</span>
            </label>
            {byo && (
              <>
                <input className="input sm:col-span-2" placeholder="OpenRouter API key (sk-or-…)" value={orKey} onChange={(e) => setOrKey(e.target.value)} type="password" />
                <input className="input" placeholder="PayPal sandbox client id" value={ppId} onChange={(e) => setPpId(e.target.value)} />
                <input className="input" placeholder="PayPal sandbox secret" value={ppSecret} onChange={(e) => setPpSecret(e.target.value)} type="password" />
              </>
            )}
          </div>
          {guardrails && data && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(data.allowlists).map(([agent, al]) => (
                <div key={agent} className="panel-2 p-3">
                  <div className="text-sm font-medium capitalize">{agent} agent</div>
                  <div className="muted mb-1 text-[11px]">PayPal Agent Toolkit tools this agent can call. Everything else is not even in its tool list.</div>
                  <div className="flex flex-wrap gap-1">
                    {al.tools.map((t) => (
                      <Chip key={t} tone="muted">
                        <span className="mono">{t}</span>
                      </Chip>
                    ))}
                    {al.tools.length === 0 && <span className="muted text-xs">no PayPal tools</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Section title="Before you spend anything">
          {current && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="muted">Scenario</span>
                <span className="font-medium">{current.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Modes</span>
                <ModeBadges modes={estimate?.modes ?? data?.modes ?? null} compact />
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Shoppers</span>
                <span className="mono">{estimate?.shoppers ?? current.shoppers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Estimated tokens</span>
                <span className="mono" style={{ color: overCap ? "var(--bad)" : undefined }}>
                  {estimating ? "…" : fmtTokens(est?.tokens)} / {fmtTokens(estimate?.tokenCap ?? current.tokenCap)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Estimated cost</span>
                <span className="mono">{estimating ? "…" : fmtUsd(est?.usd, 3)}</span>
              </div>
              {est && est.tokens === 0 && <div className="muted text-xs">Scripted agents cost zero tokens. Add an OpenRouter key (or paste one above) for live Claude shoppers.</div>}
              {est && est.tokens > 0 && (
                <div className="muted text-xs">
                  {Object.entries(est.breakdown).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span>{k}</span>
                      <span className="mono">
                        {fmtTokens(v.tokens)} · {fmtUsd(v.usd, 3)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1">
                    models: {Object.entries(est.models).map(([k, v]) => `${k}=${v}`).join(" · ")}
                  </div>
                </div>
              )}
              {overCap && <div className="text-xs" style={{ color: "var(--bad)" }}>Estimate exceeds the run cap. Lower shoppers, pick a cheaper model, or raise the cap. Swarm refuses to start over cap.</div>}
              <button className="btn btn-primary w-full justify-center" disabled={starting || overCap || !current || current.status !== "ready"} onClick={start}>
                {starting ? "Starting…" : "Start run"}
              </button>
              <div className="muted text-[11px]">Hard caps while it runs: per-turn output tokens, per-actor caps, 80 % admission stop, graceful scripted fallback at 100 %. Pause or stop any time from the Arena.</div>
            </div>
          )}
        </Section>
        <Section title="Recent runs" right={<Link href="/runs" className="muted text-xs hover:text-white">all →</Link>}>
          {runs.length === 0 && <div className="muted text-sm">No runs yet.</div>}
          <ul className="space-y-2 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <Link href={`/runs/${r.id}`} className="truncate hover:underline">
                  {r.name}
                </Link>
                <span className="flex items-center gap-2">
                  {r.score?.score && <span className="mono text-xs">{r.score.score.overall}</span>}
                  <StatusChip status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </aside>
    </div>
  );
}
