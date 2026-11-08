"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, fmtTokens, fmtUsd, type Estimate, type Modes, type RunConfigInput, type RunListItem, type ScenariosResponse } from "@/lib/api";
import { ErrorAlert, ModeTags, RunStatus, ScenarioListSkeleton, ValueSkeleton } from "@/components/ui";
import { ArrowUpRight, Icon } from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
import { DataList, DataListItem, DataListLabel, DataListValue } from "@/components/sodium/ui/data-list";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/sodium/ui/field";
import { Frame, FrameBody, FrameDescription, FrameFooter, FrameHeader, FrameMeta, FrameTitle, FrameValue } from "@/components/sodium/ui/frame";
import { Input } from "@/components/sodium/ui/input";
import { RadioGroup, RadioGroupOption } from "@/components/sodium/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/sodium/ui/select";
import { Status } from "@/components/sodium/ui/status";
import { Switch } from "@/components/sodium/ui/switch";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableLoading, TableRow } from "@/components/sodium/ui/table";

const PROFILES: Array<{ id: "baseline" | "hardened"; label: string; blurb: string }> = [
  { id: "baseline", label: "Baseline merchant", blurb: "Captures on every approval, treats HTTP 200 as paid, ships only when asked and ignores disputes until prompted. The way most first agents are wired." },
  { id: "hardened", label: "Hardened merchant", blurb: "Per-order capture lock with PayPal-Request-Id, reads the capture status, auto-tracking, refund clamping, dispute SLA and human approval above the threshold." },
];
/** OpenRouter ids with USD per million input/output tokens, as listed on 8 Nov 2026. "" keeps the server's SWARM_MODEL_* defaults. */
const MODEL_ITEMS = [
  { value: "default", label: "Server default" },
  { value: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5 · $0.10 / $0.50" },
  { value: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5 · $2 / $10" },
  { value: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5 · $4 / $20" },
  { value: "openai/gpt-5.5", label: "GPT-5.5 · $5 / $30" },
  { value: "openai/gpt-5.1", label: "GPT-5.1 · $1.25 / $10" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite · $0.10 / $0.40" },
  { value: "openai/gpt-6-luna", label: "GPT-6 Luna · $0.10 / $0.50" },
  { value: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash · $0.05 / $0.57" },
  { value: "openai/gpt-oss-120b", label: "gpt-oss-120b · $0.02 / $0.07" },
  { value: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash · $0.03 / $0.13" },
];
const LLM_ITEMS = [
  { value: "auto", label: "Auto: live if a key exists" },
  { value: "scripted", label: "Scripted: zero tokens" },
  { value: "live", label: "Live LLM" },
];
const PAYPAL_ITEMS = [
  { value: "auto", label: "Auto: sandbox if credentials exist" },
  { value: "mock", label: "Mock" },
  { value: "sandbox", label: "Sandbox" },
];
const DEFAULT_SCENARIO = "black-friday";

export default function SetupPage() {
  const router = useRouter();
  const [data, setData] = useState<ScenariosResponse | null>(null);
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [runsFailed, setRunsFailed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO);
  const [profile, setProfile] = useState<"baseline" | "hardened">("baseline");
  const [shoppers, setShoppers] = useState<string>("");
  const [tokenCap, setTokenCap] = useState<string>("");
  const [threshold, setThreshold] = useState<string>("50");
  const [llm, setLlm] = useState<"auto" | "scripted" | "live">("auto");
  const [model, setModel] = useState("default");
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
    api
      .scenarios()
      .then((d) => {
        setData(d);
        if (!d.scenarios.some((s) => s.id === DEFAULT_SCENARIO && s.status === "ready")) {
          const first = d.scenarios.find((s) => s.status === "ready");
          if (first) setScenario(first.id);
        }
      })
      .catch(setError);
    api
      .listRuns()
      .then((r) => setRuns(r.runs.slice(0, 6)))
      .catch(() => {
        setRunsFailed(true);
        setRuns([]);
      });
  }, []);

  const current = data?.scenarios.find((s) => s.id === scenario);
  const config = useMemo<RunConfigInput>(() => {
    const cfg: RunConfigInput = { scenario, merchantProfile: profile, llm, paypal, approvalThresholdUsd: Number(threshold) || 50 };
    if (model !== "default") cfg.models = { shopper: model, merchant: model, analyst: model };
    if (shoppers) cfg.shoppers = Number(shoppers);
    if (tokenCap) cfg.tokenCap = Number(tokenCap);
    if (byo && orKey.trim()) cfg.openrouterApiKey = orKey.trim();
    if (byo && ppId.trim() && ppSecret.trim()) cfg.credentials = { clientId: ppId.trim(), clientSecret: ppSecret.trim() };
    return cfg;
  }, [scenario, profile, llm, paypal, model, threshold, shoppers, tokenCap, byo, orKey, ppId, ppSecret]);

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
  const ready = (data?.scenarios ?? []).filter((s) => s.status === "ready");
  const canStart = !starting && !overCap && !!current && current.status === "ready";

  return (
    <>
      <section className="flex max-w-measure flex-col gap-3">
        <h1 className="type-title">Release a swarm at your checkout</h1>
        <p className="type-body text-text-2">
          Swarm points LLM shoppers, a merchant agent and a chaos agent at a PayPal sandbox store, watches what breaks and scores how ready the store is for agentic commerce. Pick a scenario, check the estimate, release the swarm. Nothing touches a real PayPal account unless you give it sandbox credentials.
        </p>
      </section>
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Frame aria-label="Scenario">
            <FrameHeader>
              <FrameTitle>Scenario</FrameTitle>
              {data ? <FrameValue meta>{`${ready.length} ready`}</FrameValue> : error ? <FrameValue meta>unavailable</FrameValue> : <ValueSkeleton type="code-sm" width="w-16" />}
            </FrameHeader>
            <FrameBody>
              {data ? (
                <RadioGroup value={scenario} onValueChange={(v) => setScenario(String(v))} aria-label="Scenario">
                  {data.scenarios.map((s) => (
                    <RadioGroupOption
                      key={s.id}
                      value={s.id}
                      disabled={s.status !== "ready"}
                      label={s.name}
                      description={s.status === "ready" ? `${s.tagline} ${s.shoppers} shoppers over ${s.durationMin} simulated minutes.` : `${s.tagline} Coming later; not runnable yet.`}
                    />
                  ))}
                </RadioGroup>
              ) : (
                error ? <FrameDescription>Scenarios could not be loaded. Fix the api connection described above and reload.</FrameDescription> : <ScenarioListSkeleton />
              )}
            </FrameBody>
            {current && current.status === "ready" && (
              <FrameBody>
                {current.chaosDescription.length > 0 ? (
                  <>
                    <FrameDescription>What the chaos agent injects into {current.name}:</FrameDescription>
                    <ul className="mt-2 flex flex-col gap-1 type-body-sm text-text-1">
                      {current.chaosDescription.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <FrameDescription>No chaos in this scenario: a clean baseline to compare against.</FrameDescription>
                )}
                {current.liveEstimate && (
                  <p className="mt-3 type-caption text-text-2">
                    With live LLM shoppers this scenario costs about <span className="mono">{fmtTokens(current.liveEstimate.tokens)}</span> tokens, <span className="mono">{fmtUsd(current.liveEstimate.usd)}</span>, under a cap of <span className="mono">{fmtTokens(current.tokenCap)}</span>.
                  </p>
                )}
              </FrameBody>
            )}
          </Frame>

          <Frame aria-label="Merchant profile">
            <FrameHeader>
              <FrameTitle>Merchant profile</FrameTitle>
            </FrameHeader>
            <FrameBody>
              <RadioGroup value={profile} onValueChange={(v) => setProfile(v as "baseline" | "hardened")} aria-label="Merchant profile">
                {PROFILES.map((p) => (
                  <RadioGroupOption key={p.id} value={p.id} label={p.label} description={p.blurb} />
                ))}
              </RadioGroup>
            </FrameBody>
            <FrameBody>
              <FrameDescription>Run baseline first, read the report, then re-run the same scenario against the hardened profile. Both are prompt plus code, so findings reproduce.</FrameDescription>
            </FrameBody>
          </Frame>

          <Frame aria-label="Options">
            <FrameHeader>
              <FrameTitle>Options</FrameTitle>
            </FrameHeader>
            <FrameBody>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel>Shoppers</FieldLabel>
                  <Input mono inputMode="numeric" placeholder={String(current?.shoppers ?? "")} value={shoppers} onChange={(e) => setShoppers(e.target.value.replace(/\D/g, ""))} />
                  <FieldDescription>Blank keeps the scenario default.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Run token cap</FieldLabel>
                  <Input mono inputMode="numeric" placeholder={String(current?.tokenCap ?? "")} value={tokenCap} onChange={(e) => setTokenCap(e.target.value.replace(/\D/g, ""))} />
                  <FieldDescription>Swarm refuses to start over the cap.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Approval above</FieldLabel>
                  <Input mono inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d.]/g, ""))} trailing={<span className="type-code-sm text-text-2">USD</span>} />
                  <FieldDescription>Refunds above it pause for a human.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Agents</FieldLabel>
                  <Select items={LLM_ITEMS} value={llm} onValueChange={(v) => v && setLlm(v as typeof llm)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick who drives the agents" />
                    </SelectTrigger>
                    <SelectContent>
                      {LLM_ITEMS.map((i) => (
                        <SelectItem key={i.value} value={i.value}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {llm !== "scripted" && (
                  <Field>
                    <FieldLabel>Model</FieldLabel>
                    <Select items={MODEL_ITEMS} value={model} onValueChange={(v) => v && setModel(v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick the model for every agent" />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_ITEMS.map((i) => (
                          <SelectItem key={i.value} value={i.value}>
                            {i.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>One OpenRouter model for shoppers, merchant and analyst. Prices are USD per million tokens in and out.</FieldDescription>
                  </Field>
                )}
                <Field>
                  <FieldLabel>PayPal</FieldLabel>
                  <Select items={PAYPAL_ITEMS} value={paypal} onValueChange={(v) => v && setPaypal(v as typeof paypal)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick where PayPal calls go" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYPAL_ITEMS.map((i) => (
                        <SelectItem key={i.value} value={i.value}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel>Bring your own keys</FieldLabel>
                    <FieldDescription>Encrypted at rest, never written to events.</FieldDescription>
                  </FieldContent>
                  <Switch checked={byo} onCheckedChange={(c) => setByo(!!c)} />
                </Field>
              </div>
            </FrameBody>
            {byo && (
              <FrameBody>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel>OpenRouter API key</FieldLabel>
                    <Input mode="password" mono autoComplete="off" placeholder="sk-or-" value={orKey} onChange={(e) => setOrKey(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>PayPal sandbox client id</FieldLabel>
                    <Input mono autoComplete="off" value={ppId} onChange={(e) => setPpId(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>PayPal sandbox secret</FieldLabel>
                    <Input mode="password" mono autoComplete="off" value={ppSecret} onChange={(e) => setPpSecret(e.target.value)} />
                  </Field>
                </div>
              </FrameBody>
            )}
            <FrameBody padding="none">
              <Collapsible open={guardrails} onOpenChange={setGuardrails}>
                <CollapsibleTrigger size="sm" summary={data ? `${Object.keys(data.allowlists).length} agents` : undefined}>
                  Allow-lists
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {data && (
                    <div className="grid gap-4 p-inset sm:grid-cols-2">
                      {Object.entries(data.allowlists).map(([agent, al]) => (
                        <div key={agent} className="flex flex-col gap-2">
                          <span className="type-label-sm text-text-2">{agent} agent</span>
                          <p className="type-caption text-text-2">PayPal Agent Toolkit tools this agent can call. Everything else is not in its tool list.</p>
                          {al.tools.length > 0 ? (
                            <ul className="flex flex-wrap gap-x-3 gap-y-1">
                              {al.tools.map((t) => (
                                <li key={t} className="type-code-sm text-text-1">
                                  {t}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="type-code-sm text-text-3">no PayPal tools</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </FrameBody>
          </Frame>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <Frame variant="panel" aria-label="Estimate">
            <FrameHeader>
              <FrameTitle>Estimate</FrameTitle>
              {current ? <FrameValue meta>{current.name}</FrameValue> : !error && <ValueSkeleton type="code-sm" width="w-28" />}
            </FrameHeader>
            <FrameBody padding="none">
              <DataList className="px-inset">
                <DataListItem>
                  <DataListLabel>Modes</DataListLabel>
                  <DataListValue>
                    {(estimate?.modes ?? data?.modes) ? <ModeTags modes={estimate?.modes ?? data?.modes ?? null} /> : error ? null : <ValueSkeleton width="w-44" />}
                  </DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Shoppers</DataListLabel>
                  <DataListValue>{current ? String(estimate?.shoppers ?? current.shoppers) : error ? null : <ValueSkeleton width="w-8" />}</DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Tokens</DataListLabel>
                  <DataListValue>{current ? estimating ? <ValueSkeleton width="w-32" /> : `${fmtTokens(est?.tokens)} / ${fmtTokens(estimate?.tokenCap ?? current.tokenCap)}` : error ? null : <ValueSkeleton width="w-32" />}</DataListValue>
                </DataListItem>
                <DataListItem>
                  <DataListLabel>Cost</DataListLabel>
                  <DataListValue>{current ? estimating ? <ValueSkeleton width="w-16" /> : fmtUsd(est?.usd, 3) : error ? null : <ValueSkeleton width="w-16" />}</DataListValue>
                </DataListItem>
                {est &&
                  est.tokens > 0 &&
                  Object.entries(est.breakdown).map(([k, v]) => (
                    <DataListItem key={k}>
                      <DataListLabel>{k}</DataListLabel>
                      <DataListValue>{`${fmtTokens(v.tokens)}, ${fmtUsd(v.usd, 3)}`}</DataListValue>
                    </DataListItem>
                  ))}
                {est && est.tokens > 0 && (
                  <DataListItem>
                    <DataListLabel>Models</DataListLabel>
                    <DataListValue>{Object.entries(est.models).map(([k, v]) => `${k}=${v}`).join(" ")}</DataListValue>
                  </DataListItem>
                )}
              </DataList>
            </FrameBody>
            <FrameBody>
              {overCap ? (
                <p className="type-body-sm text-text-2">
                  <Status status="fail" size="sm">
                    Over cap
                  </Status>{" "}
                  The estimate exceeds the run cap. Lower the shoppers, pick a cheaper model or raise the cap.
                </p>
              ) : est && est.tokens === 0 ? (
                <FrameDescription>Scripted agents cost zero tokens. Add an OpenRouter key for live Claude shoppers.</FrameDescription>
              ) : (
                <FrameDescription>Hard caps while it runs: per-turn output tokens, per-actor caps, an admission stop at 80 percent and a scripted fallback at 100 percent. Pause or stop any time from the Arena.</FrameDescription>
              )}
            </FrameBody>
            <FrameFooter>
              <FrameMeta>{profile} merchant</FrameMeta>
              <Button size="sm" pending={starting} pendingLabel="Starting" disabled={!canStart} onClick={start}>
                Release the swarm
              </Button>
            </FrameFooter>
          </Frame>

          <Table
            size="sm"
            title="Recent runs"
            count={runs?.length}
            aria-busy={runs === null}
            actions={
              <Button variant="ghost" size="icon-sm" aria-label="All runs" render={<Link href="/runs" />} nativeButton={false}>
                <Icon icon={ArrowUpRight} />
              </Button>
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs === null ? (
                <TableLoading rows={4} columns={3} />
              ) : runs.length ? (
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal wrap-anywhere">
                      <Link href={`/runs/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStatus status={r.status} />
                    </TableCell>
                    <TableCell numeric>{r.score?.score ? String(r.score.score.overall) : "None"}</TableCell>
                  </TableRow>
                ))
              ) : (
                runsFailed ? (
                <TableEmpty colSpan={3} reason="error" title="Runs could not be loaded" description="The api did not answer." />
              ) : (
                <TableEmpty colSpan={3} title="No runs yet" description="The first run you release shows up here." />
              )
              )}
            </TableBody>
          </Table>
        </aside>
      </div>
    </>
  );
}
