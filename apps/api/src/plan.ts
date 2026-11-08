import { DEFAULT_MODELS, makeLlm, normaliseUsage, PRICES, type Usage, ZERO_USAGE } from "@swarm/agents";
import { SCENARIOS, type RunConfig } from "@swarm/core";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Env } from "./env";

/**
 * The launcher on the Setup page: one sentence in, one run config out.
 *
 * "Try breaking checkout with impatient bargain hunters on Black Friday, hardened merchant" becomes
 * { scenario: "black-friday", merchantProfile: "hardened", brief: "impatient bargain hunters ..." } plus a one-line
 * reading of what was understood, which the person confirms before anything is spent. The model only fills a
 * strict schema; it never launches anything itself. Without an OpenRouter key a keyword parser does the same job.
 */
export const PlanRequestSchema = z.object({
  text: z.string().trim().min(3).max(600),
  /** OpenRouter model id for the planner itself; defaults to the analyst model. */
  model: z.string().optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

const READY = SCENARIOS.filter((s) => s.status === "ready");
const SCENARIO_IDS = READY.map((s) => s.id) as [string, ...string[]];
const MODEL_IDS = Object.keys(PRICES) as [string, ...string[]];

export const PlanSchema = z.object({
  scenario: z.enum(SCENARIO_IDS).describe("The scenario preset that fits best."),
  merchantProfile: z.enum(["baseline", "hardened"]).describe("hardened only when the text asks for the fixed, hardened or improved merchant; otherwise baseline."),
  bothProfiles: z.boolean().describe("true when the text asks to compare, run both, or baseline versus hardened."),
  shoppers: z.number().int().min(1).max(60).nullable().describe("Only when the text states a number of shoppers, buyers or agents; otherwise null."),
  model: z.enum(MODEL_IDS).nullable().describe("Only when the text names a model or vendor; otherwise null."),
  brief: z.string().max(400).nullable().describe("What the shoppers should be like and what to try to break, in the person's own words, or null when the text adds nothing beyond the scenario."),
  name: z.string().max(60).describe("A short run name, five words or fewer."),
  reading: z.string().max(200).describe("One sentence, plain words: what will run and why that scenario."),
});
export type Plan = z.infer<typeof PlanSchema>;

export interface PlanResult {
  plan: Plan;
  /** Ready to POST to /runs (credentials and keys are added by the client). */
  config: Pick<RunConfig, "scenario" | "merchantProfile" | "name"> & { shoppers?: number; brief?: string; models?: RunConfig["models"] };
  source: "llm" | "heuristic";
  usage: Usage;
  model?: string;
}

const scenarioLine = (s: (typeof READY)[number]) => `- ${s.id}: ${s.name}. ${s.tagline} ${s.shoppers} shoppers; chaos: ${s.chaos.length ? s.chaos.map((c) => c.kind).join(", ") : "none"}.`;

const SYSTEM = `You turn one sentence from a person into a Swarm run plan. Swarm releases LLM shopper agents, a merchant agent and a chaos agent at a PayPal sandbox store and scores how ready the store is for agentic commerce.

Scenarios:
${READY.map(scenarioLine).join("\n")}

Models the person may name (OpenRouter ids): ${MODEL_IDS.join(", ")}. Map vendor words loosely: "gpt" or "openai" means openai/gpt-5.5 unless a cheaper tier is asked for, "claude" means anthropic/claude-sonnet-5.5, "haiku" means anthropic/claude-haiku-5.5, "gemini" means google/gemini-2.5-flash-lite, "deepseek" means deepseek/deepseek-v4.1-flash, "cheap" or "cheapest" means openai/gpt-oss-120b.

Rules: pick the one scenario that fits best (happy path or no chaos means quiet-tuesday; declines, crowds or a sale mean black-friday; chargebacks or disputes mean dispute-storm; shipping, tracking or parcels mean lost-parcels). Keep the person's words about who the shoppers are and what to attack in the brief. Never invent numbers or models that were not asked for.`;

/** Keyword parser used without a key, in tests, and as the fallback when the model call fails. */
export function heuristicPlan(text: string): Plan {
  const t = text.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  const scenario = has("dispute", "chargeback", "claim") ? "dispute-storm" : has("parcel", "tracking", "shipping", "lost", "where is") ? "lost-parcels" : has("black friday", "black-friday", "sale", "crowd", "decline", "rush", "peak", "storm", "load") ? "black-friday" : "quiet-tuesday";
  const merchantProfile = has("hardened", "fixed", "with fix", "improved", "after the fix") ? "hardened" : "baseline";
  const bothProfiles = has("compare", "both", " vs ", "versus", "before and after");
  const n = /(\d{1,2})\s+(?:[a-z-]+\s+){0,3}(shoppers?|buyers?|agents?|customers?|personas?|hunters?|users?|people|bots?)\b/.exec(t);
  const shoppers = n ? Math.min(60, Math.max(1, Number(n[1]))) : null;
  const model = has("opus") ? "anthropic/claude-opus-5.5" : has("sonnet", "claude") ? "anthropic/claude-sonnet-5.5" : has("haiku") ? "anthropic/claude-haiku-5.5" : has("gpt-5.5", "gpt 5.5") || (has("gpt", "openai") && !has("cheap", "oss", "luna")) ? "openai/gpt-5.5" : has("luna") ? "openai/gpt-6-luna" : has("gemini") ? "google/gemini-2.5-flash-lite" : has("deepseek") ? "deepseek/deepseek-v4.1-flash" : has("qwen") ? "qwen/qwen3.7-flash" : has("cheap", "oss") ? "openai/gpt-oss-120b" : null;
  const scen = READY.find((s) => s.id === scenario)!;
  const brief = text.trim().length > 12 ? text.trim().slice(0, 400) : null;
  return {
    scenario,
    merchantProfile,
    bothProfiles,
    shoppers,
    model: (model as Plan["model"]) ?? null,
    brief,
    name: `${scen.name}${shoppers ? ` ×${shoppers}` : ""}${merchantProfile === "hardened" ? " hardened" : ""}`.slice(0, 60),
    reading: `Runs ${scen.name} with the ${merchantProfile} merchant${shoppers ? ` and ${shoppers} shoppers` : ""}${model ? ` on ${model}` : ""}${bothProfiles ? ", then the other profile for comparison" : ""}.`,
  };
}

export function toConfig(plan: Plan): PlanResult["config"] {
  return {
    scenario: plan.scenario,
    merchantProfile: plan.merchantProfile,
    name: plan.name,
    ...(plan.shoppers ? { shoppers: plan.shoppers } : {}),
    ...(plan.brief ? { brief: plan.brief } : {}),
    ...(plan.model ? { models: { shopper: plan.model, merchant: plan.model, analyst: plan.model } } : {}),
  };
}

export async function planRun(input: PlanRequest, deps: { env: Env; apiKey?: string }): Promise<PlanResult> {
  const apiKey = deps.apiKey ?? deps.env.openrouterKey;
  if (!apiKey) {
    const plan = heuristicPlan(input.text);
    return { plan, config: toConfig(plan), source: "heuristic", usage: ZERO_USAGE };
  }
  const model = input.model ?? deps.env.models.analyst ?? DEFAULT_MODELS.analyst;
  try {
    const llm = makeLlm({ apiKey });
    const result = await generateText({
      model: llm.model(model),
      system: SYSTEM,
      prompt: input.text,
      output: Output.object({ schema: PlanSchema }),
      maxOutputTokens: 400,
      experimental_telemetry: { isEnabled: true, functionId: "plan-run" },
    });
    const plan = PlanSchema.parse(result.output);
    return { plan, config: toConfig(plan), source: "llm", usage: normaliseUsage(model, result.totalUsage, result.providerMetadata), model };
  } catch (e) {
    console.warn("[swarm-api] plan-run fell back to keywords:", (e as Error).message);
    const plan = heuristicPlan(input.text);
    return { plan, config: toConfig(plan), source: "heuristic", usage: ZERO_USAGE, model };
  }
}
