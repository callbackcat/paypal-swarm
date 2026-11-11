"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  fmtTokens,
  fmtUsd,
  type Estimate,
  type Modes,
  type PlanResult,
  type RunConfigInput,
  type RunListItem,
  type ScenariosResponse,
} from "@/lib/api";
import {
  ErrorAlert,
  ModeTags,
  RunStatus,
  ScenarioListSkeleton,
  ValueSkeleton,
} from "@/components/ui";
import { SwarmLauncher } from "@/components/SwarmLauncher";
import { HowItWorksSteps } from "@/components/HowItWorks";
import {
  Engine,
  Measured,
  Paths,
  Questions,
  StackStrip,
} from "@/components/Landing";
import { ArrowUpRight, Icon, Information } from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/sodium/ui/collapsible";
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from "@/components/sodium/ui/data-list";
import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";
import {
  RadioGroup,
  RadioGroupOption,
} from "@/components/sodium/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/sodium/ui/select";
import { Status } from "@/components/sodium/ui/status";
import { Switch } from "@/components/sodium/ui/switch";
import { Tag } from "@/components/sodium/ui/tag";

const PROFILES: Array<{
  id: "baseline" | "hardened";
  label: string;
  blurb: string;
}> = [
  {
    id: "baseline",
    label: "Baseline merchant",
    blurb:
      "Captures on every approval, treats HTTP 200 as paid, ships only when asked and ignores disputes until prompted. The way most first agents are wired.",
  },
  {
    id: "hardened",
    label: "Hardened merchant",
    blurb:
      "Per-order capture lock with PayPal-Request-Id, reads the capture status, auto-tracking, refund clamping, dispute SLA and human approval above the threshold.",
  },
];
/** OpenRouter ids with USD per million input/output tokens, as listed on 8 Nov 2026. "" keeps the server's SWARM_MODEL_* defaults. */
const MODEL_ITEMS = [
  { value: "default", label: "Server default" },
  {
    value: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5 · $0.10 / $0.50",
  },
  {
    value: "anthropic/claude-sonnet-5.5",
    label: "Claude Sonnet 5.5 · $2 / $10",
  },
  { value: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5 · $4 / $20" },
  { value: "openai/gpt-5.5", label: "GPT-5.5 · $5 / $30" },
  { value: "openai/gpt-5.1", label: "GPT-5.1 · $1.25 / $10" },
  {
    value: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite · $0.10 / $0.40",
  },
  { value: "openai/gpt-6-luna", label: "GPT-6 Luna · $0.10 / $0.50" },
  {
    value: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash · $0.05 / $0.57",
  },
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
  const [estimate, setEstimate] = useState<{
    estimate: Estimate;
    modes: Modes;
    tokenCap: number;
    shoppers: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [guardrails, setGuardrails] = useState(false);
  const [brief, setBrief] = useState("");
  const [runName, setRunName] = useState("");
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .scenarios()
      .then((d) => {
        setData(d);
        if (
          !d.scenarios.some(
            (s) => s.id === DEFAULT_SCENARIO && s.status === "ready",
          )
        ) {
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
    const cfg: RunConfigInput = {
      scenario,
      merchantProfile: profile,
      llm,
      paypal,
      approvalThresholdUsd: Number(threshold) || 50,
    };
    if (model !== "default")
      cfg.models = { shopper: model, merchant: model, analyst: model };
    if (shoppers) cfg.shoppers = Number(shoppers);
    if (tokenCap) cfg.tokenCap = Number(tokenCap);
    if (brief.trim()) cfg.brief = brief.trim();
    if (runName.trim()) cfg.name = runName.trim();
    if (byo && orKey.trim()) cfg.openrouterApiKey = orKey.trim();
    if (byo && ppId.trim() && ppSecret.trim())
      cfg.credentials = {
        clientId: ppId.trim(),
        clientSecret: ppSecret.trim(),
      };
    return cfg;
  }, [
    scenario,
    profile,
    llm,
    paypal,
    model,
    threshold,
    shoppers,
    tokenCap,
    byo,
    orKey,
    ppId,
    ppSecret,
    brief,
    runName,
  ]);

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

  /** Release what the form holds. With `both`, the other merchant profile follows as a second run for a side-by-side. */
  async function start(both = false) {
    setStarting(true);
    setError(null);
    try {
      const run = await api.createRun(config);
      if (both) {
        const other =
          config.merchantProfile === "hardened" ? "baseline" : "hardened";
        await api.createRun({
          ...config,
          merchantProfile: other,
          name: `${config.name ?? current?.name ?? scenario} ${other}`,
        });
      }
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError(e);
      setStarting(false);
    }
  }

  /** The launcher read a plan: put it into the form so the estimate and every field follow it. */
  function applyPlan(r: PlanResult) {
    const { plan } = r;
    if (
      data?.scenarios.some(
        (s) => s.id === plan.scenario && s.status === "ready",
      )
    )
      setScenario(plan.scenario);
    setProfile(plan.merchantProfile);
    setShoppers(plan.shoppers ? String(plan.shoppers) : "");
    setModel(
      plan.model && MODEL_ITEMS.some((m) => m.value === plan.model)
        ? plan.model
        : "default",
    );
    setBrief(plan.brief ?? "");
    setRunName(plan.name);
  }

  const est = estimate?.estimate;
  const overCap = !!est?.overCap;
  const ready = (data?.scenarios ?? []).filter((s) => s.status === "ready");
  const canStart =
    !starting && !overCap && !!current && current.status === "ready";
  const blocker = starting
    ? null
    : overCap
      ? "over the token cap: lower the shoppers or pick a cheaper model"
      : !current
        ? error
          ? "the api is not reachable"
          : "loading scenarios"
        : current.status !== "ready"
          ? "this scenario is not runnable yet"
          : null;
  const estimateLine = !current
    ? null
    : estimating || !est
      ? null
      : est.tokens === 0
        ? "scripted agents, zero tokens"
        : `${fmtTokens(est.tokens)} tokens, about ${fmtUsd(est.usd, 3)}`;

  return (
    <div className="flex w-full flex-col">
      <section
        id="launch"
        className="mx-auto flex w-full max-w-3xl scroll-mt-6 flex-col gap-8 py-12 lg:py-16"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="type-display text-text-1">
            Stress-test your checkout with a swarm of AI shoppers
          </h1>
          <p className="max-w-measure type-body text-text-2">
            One sentence releases LLM shoppers and a chaos agent on your PayPal
            sandbox. You get a score and the fix behind every finding.
          </p>
          <Button variant="secondary" onClick={() => setAbout(true)}>
            <Icon icon={Information} />
            How it works
          </Button>
        </div>
        <ErrorAlert error={error} />
        <SwarmLauncher
          scenarios={data?.scenarios ?? null}
          onPlan={applyPlan}
          onRelease={(both) => void start(both)}
          onSettings={() => setSettings(true)}
          estimateLine={estimateLine}
          starting={starting}
          blocker={blocker}
        />
      </section>

      <StackStrip />
      <Paths onSettings={() => setSettings(true)} />
      <Engine />
      <Measured />

      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>how a run works</DialogTitle>
          </DialogHeader>
          <DialogBody className="gap-4 p-5">
            <DialogDescription className="mx-auto text-center">
              Swarm sends AI shoppers at your PayPal sandbox store and scores
              how it copes. No real money moves.
            </DialogDescription>
            <HowItWorksSteps />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={settings} onOpenChange={setSettings}>
        {/* Focus lands on the dialog itself, not the first field, so it opens at the Scenario and nothing scrolls away. */}
        <DialogContent size="lg" ref={settingsRef} initialFocus={settingsRef}>
          <DialogHeader meta={current ? current.name : undefined}>
            <DialogTitle>run settings</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              Everything the plan set, open to change. The estimate in the
              footer follows every change.
            </DialogDescription>
            <div className="mt-2 flex flex-col divide-y divide-line">
              <section
                className="flex flex-col gap-3 py-4"
                aria-label="Scenario"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="type-label text-text-2">Scenario</h3>
                  {data ? (
                    <span className="type-code-sm text-text-3">{`${ready.length} ready`}</span>
                  ) : error ? (
                    <span className="type-code-sm text-text-3">
                      unavailable
                    </span>
                  ) : (
                    <ValueSkeleton type="code-sm" width="w-16" />
                  )}
                </div>
                {data ? (
                  <RadioGroup
                    value={scenario}
                    onValueChange={(v) => setScenario(String(v))}
                    aria-label="Scenario"
                  >
                    {data.scenarios.map((sc) => (
                      <RadioGroupOption
                        key={sc.id}
                        value={sc.id}
                        disabled={sc.status !== "ready"}
                        label={sc.name}
                        description={
                          sc.status === "ready"
                            ? `${sc.tagline} ${sc.shoppers} shoppers over ${sc.durationMin} simulated minutes.`
                            : `${sc.tagline} Coming later; not runnable yet.`
                        }
                      />
                    ))}
                  </RadioGroup>
                ) : error ? (
                  <p className="type-body-sm text-text-2">
                    Scenarios could not be loaded. Fix the api connection and
                    reload.
                  </p>
                ) : (
                  <ScenarioListSkeleton />
                )}
                {current && current.status === "ready" && (
                  <div className="flex flex-col gap-1">
                    {current.chaosDescription.length > 0 ? (
                      <>
                        <p className="type-caption text-text-2">
                          What the chaos agent injects into {current.name}:
                        </p>
                        <ul className="flex flex-col gap-1 type-body-sm text-text-1">
                          {current.chaosDescription.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="type-caption text-text-2">
                        No chaos in this scenario: a clean baseline to compare
                        against.
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section
                className="flex flex-col gap-3 py-4"
                aria-label="Merchant profile"
              >
                <h3 className="type-label text-text-2">Merchant profile</h3>
                <RadioGroup
                  value={profile}
                  onValueChange={(v) =>
                    setProfile(v as "baseline" | "hardened")
                  }
                  aria-label="Merchant profile"
                >
                  {PROFILES.map((pr) => (
                    <RadioGroupOption
                      key={pr.id}
                      value={pr.id}
                      label={pr.label}
                      description={pr.blurb}
                    />
                  ))}
                </RadioGroup>
                <p className="type-caption text-text-2">
                  Run baseline first, read the report, then re-run the same
                  scenario against the hardened profile. Both are prompt plus
                  code, so findings reproduce.
                </p>
              </section>

              <section
                className="flex flex-col gap-4 py-4"
                aria-label="Options"
              >
                <h3 className="type-label text-text-2">Options</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Shoppers</FieldLabel>
                    <Input
                      mono
                      inputMode="numeric"
                      placeholder={String(current?.shoppers ?? "")}
                      value={shoppers}
                      onChange={(e) =>
                        setShoppers(e.target.value.replace(/D/g, ""))
                      }
                    />
                    <FieldDescription>
                      Blank keeps the scenario default.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Run token cap</FieldLabel>
                    <Input
                      mono
                      inputMode="numeric"
                      placeholder={String(current?.tokenCap ?? "")}
                      value={tokenCap}
                      onChange={(e) =>
                        setTokenCap(e.target.value.replace(/D/g, ""))
                      }
                    />
                    <FieldDescription>
                      Swarm refuses to start over the cap.
                    </FieldDescription>
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel>Shopper brief</FieldLabel>
                    <Input
                      placeholder="Who the shoppers are this run and what to try to break"
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      maxLength={600}
                    />
                    <FieldDescription>
                      Handed to every shopper in character. The launcher fills
                      it from your sentence.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Run name</FieldLabel>
                    <Input
                      placeholder={current?.name ?? ""}
                      value={runName}
                      onChange={(e) => setRunName(e.target.value)}
                      maxLength={60}
                    />
                    <FieldDescription>
                      Blank names it after the scenario.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Approval above</FieldLabel>
                    <Input
                      mono
                      inputMode="decimal"
                      value={threshold}
                      onChange={(e) =>
                        setThreshold(e.target.value.replace(/[^d.]/g, ""))
                      }
                      trailing={
                        <span className="type-code-sm text-text-2">USD</span>
                      }
                    />
                    <FieldDescription>
                      Refunds above it pause for a human.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Agents</FieldLabel>
                    <Select
                      items={LLM_ITEMS}
                      value={llm}
                      onValueChange={(v) => v && setLlm(v as typeof llm)}
                    >
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
                      <Select
                        items={MODEL_ITEMS}
                        value={model}
                        onValueChange={(v) => v && setModel(v)}
                      >
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
                      <FieldDescription>
                        One OpenRouter model for shoppers, merchant and analyst.
                        Prices are USD per million tokens in and out.
                      </FieldDescription>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel>PayPal</FieldLabel>
                    <Select
                      items={PAYPAL_ITEMS}
                      value={paypal}
                      onValueChange={(v) => v && setPaypal(v as typeof paypal)}
                    >
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
                      <FieldDescription>
                        Encrypted at rest, never written to events.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      checked={byo}
                      onCheckedChange={(c) => setByo(!!c)}
                    />
                  </Field>
                </div>
                {byo && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel>OpenRouter API key</FieldLabel>
                      <Input
                        mode="password"
                        mono
                        autoComplete="off"
                        placeholder="sk-or-"
                        value={orKey}
                        onChange={(e) => setOrKey(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>PayPal sandbox client id</FieldLabel>
                      <Input
                        mono
                        autoComplete="off"
                        value={ppId}
                        onChange={(e) => setPpId(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>PayPal sandbox secret</FieldLabel>
                      <Input
                        mode="password"
                        mono
                        autoComplete="off"
                        value={ppSecret}
                        onChange={(e) => setPpSecret(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </section>

              <section className="flex flex-col py-2" aria-label="Allow-lists">
                <Collapsible open={guardrails} onOpenChange={setGuardrails}>
                  <CollapsibleTrigger
                    size="sm"
                    summary={
                      data
                        ? `${Object.keys(data.allowlists).length} agents`
                        : undefined
                    }
                  >
                    Allow-lists
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {data && (
                      <div className="grid gap-4 py-3 sm:grid-cols-2">
                        {Object.entries(data.allowlists).map(([agent, al]) => (
                          <div key={agent} className="flex flex-col gap-2">
                            <span className="type-label-sm text-text-2">
                              {agent} agent
                            </span>
                            <p className="type-caption text-text-2">
                              PayPal Agent Toolkit tools this agent can call.
                              Everything else is not in its tool list.
                            </p>
                            {al.tools.length > 0 ? (
                              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                                {al.tools.map((t) => (
                                  <li
                                    key={t}
                                    className="type-code-sm text-text-1"
                                  >
                                    {t}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="type-code-sm text-text-3">
                                no PayPal tools
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </section>

              <section
                className="flex flex-col gap-2 py-4"
                aria-label="Estimate"
              >
                <h3 className="type-label text-text-2">Estimate</h3>
                <DataList>
                  <DataListItem>
                    <DataListLabel>Modes</DataListLabel>
                    <DataListValue>
                      {(estimate?.modes ?? data?.modes) ? (
                        <ModeTags
                          modes={estimate?.modes ?? data?.modes ?? null}
                        />
                      ) : error ? null : (
                        <ValueSkeleton width="w-44" />
                      )}
                    </DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Shoppers</DataListLabel>
                    <DataListValue>
                      {current ? (
                        String(estimate?.shoppers ?? current.shoppers)
                      ) : error ? null : (
                        <ValueSkeleton width="w-8" />
                      )}
                    </DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Tokens</DataListLabel>
                    <DataListValue>
                      {current ? (
                        estimating ? (
                          <ValueSkeleton width="w-32" />
                        ) : (
                          `${fmtTokens(est?.tokens)} / ${fmtTokens(estimate?.tokenCap ?? current.tokenCap)}`
                        )
                      ) : error ? null : (
                        <ValueSkeleton width="w-32" />
                      )}
                    </DataListValue>
                  </DataListItem>
                  <DataListItem>
                    <DataListLabel>Cost</DataListLabel>
                    <DataListValue>
                      {current ? (
                        estimating ? (
                          <ValueSkeleton width="w-16" />
                        ) : (
                          fmtUsd(est?.usd, 3)
                        )
                      ) : error ? null : (
                        <ValueSkeleton width="w-16" />
                      )}
                    </DataListValue>
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
                      <DataListValue>
                        {Object.entries(est.models)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" ")}
                      </DataListValue>
                    </DataListItem>
                  )}
                </DataList>
                {overCap ? (
                  <p className="type-body-sm text-text-2">
                    <Status status="fail" size="sm">
                      Over cap
                    </Status>{" "}
                    The estimate exceeds the run cap. Lower the shoppers, pick a
                    cheaper model or raise the cap.
                  </p>
                ) : est && est.tokens === 0 ? (
                  <p className="type-caption text-text-2">
                    Scripted agents cost zero tokens. Add an OpenRouter key for
                    live shoppers.
                  </p>
                ) : (
                  <p className="type-caption text-text-2">
                    Hard caps while it runs: per-turn output tokens, per-actor
                    caps, an admission stop at 80 percent and a scripted
                    fallback at 100 percent. Pause or stop any time from the
                    Arena.
                  </p>
                )}
              </section>
            </div>
          </DialogBody>
          <DialogFooter meta={blocker ?? estimateLine ?? undefined}>
            <DialogClose>Close</DialogClose>
            <DialogAction
              pendingLabel="Starting"
              disabled={!canStart}
              onAction={() => start()}
            >
              Release the swarm
            </DialogAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section
        className="flex w-full flex-col gap-10 border-t border-line py-12 lg:gap-12 lg:py-16"
        aria-labelledby="recent-runs"
      >
        <div className="mx-auto flex max-w-measure flex-col items-center gap-3 text-center">
          <h2 id="recent-runs" className="type-heading text-text-1">
            Or open a finished run.
          </h2>
        </div>
        <div className="flex flex-col gap-4">
          {runs === null ? (
            <ul
              className="grid gap-px border border-line bg-line sm:grid-cols-3"
              aria-busy
            >
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex flex-col gap-3 bg-page p-inset">
                  <ValueSkeleton width="w-40" />
                  <ValueSkeleton type="code-sm" width="w-24" />
                  <ValueSkeleton width="w-12" />
                </li>
              ))}
            </ul>
          ) : runs.length ? (
            <ul className="grid gap-px border border-line bg-line sm:grid-cols-3">
              {runs.slice(0, 3).map((r) => (
                <li key={r.id} className="flex flex-col gap-4 bg-page p-inset">
                  <div className="flex flex-col gap-2">
                    <Link
                      href={`/runs/${r.id}`}
                      className="type-body text-text-1 wrap-anywhere hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-2">
                      <RunStatus status={r.status} />
                      <Tag size="sm" variant="outline">
                        {r.merchantProfile} merchant
                      </Tag>
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <span className="flex flex-col">
                      <span className="type-label-sm text-text-2">
                        Readiness
                      </span>
                      <span className="type-figure text-text-1">
                        {r.score?.score ? String(r.score.score.overall) : "–"}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        render={<Link href={`/runs/${r.id}/report`} />}
                        nativeButton={false}
                      >
                        Report
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open the Arena"
                        render={<Link href={`/runs/${r.id}`} />}
                        nativeButton={false}
                      >
                        <Icon icon={ArrowUpRight} />
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center type-body-sm text-text-2">
              {runsFailed
                ? "Runs could not be loaded: the api did not answer."
                : "No runs yet. The first run you release shows up here."}
            </p>
          )}
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/runs" />}
              nativeButton={false}
            >
              All runs
              <Icon icon={ArrowUpRight} />
            </Button>
          </div>
        </div>
      </section>

      <Questions />
    </div>
  );
}
