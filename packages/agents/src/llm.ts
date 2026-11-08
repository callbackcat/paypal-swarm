import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel, type LanguageModel, type LanguageModelUsage, type ProviderMetadata } from "ai";
import { cacheMiddleware, type CacheStore } from "./cache";

/** USD per million tokens. Checked against openrouter.ai/models on 4 Nov 2026. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
/** OpenRouter list prices, USD per million tokens, as read on 8 Nov 2026. Unknown models fall back to Sonnet so the estimate errs high. */
export const PRICES: Record<string, Price> = {
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "openai/gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "openai/gpt-5.1": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
  "google/gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
  "openai/gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
  "openai/gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  "openai/gpt-oss-120b": { input: 0.019, output: 0.071, cacheRead: 0.017, cacheWrite: 0 },
  "deepseek/deepseek-v4.1-flash": { input: 0.051, output: 0.567, cacheRead: 0.018, cacheWrite: 0 },
  "qwen/qwen3.7-flash": { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0 },
  "z-ai/glm-5.3-flash": { input: 0.034, output: 0.083, cacheRead: 0.03, cacheWrite: 0 },
  "meta-llama/llama-4-scout": { input: 0.1, output: 0.3, cacheRead: 0.1, cacheWrite: 0 },
};
/** Unknown models are priced like Sonnet so estimates err on the expensive side. */
export const FALLBACK_PRICE: Price = PRICES["anthropic/claude-sonnet-5.5"]!;
export const priceFor = (model: string): Price => PRICES[model] ?? FALLBACK_PRICE;

export const DEFAULT_MODELS = {
  shopper: process.env.SWARM_MODEL_SHOPPER || "anthropic/claude-haiku-5.5",
  merchant: process.env.SWARM_MODEL_MERCHANT || "anthropic/claude-sonnet-5.5",
  analyst: process.env.SWARM_MODEL_ANALYST || "anthropic/claude-sonnet-5.5",
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Our price-table estimate. */
  costUsd: number;
  /** Exact cost reported by OpenRouter when `usage.include` is on. */
  reportedCostUsd?: number;
}

export function costFor(model: string, u: { inputTokens: number; outputTokens: number; cachedTokens?: number; cacheWriteTokens?: number }): number {
  const p = priceFor(model);
  const cached = u.cachedTokens ?? 0;
  const written = u.cacheWriteTokens ?? 0;
  const fresh = Math.max(0, u.inputTokens - cached - written);
  return (fresh * p.input + cached * p.cacheRead + written * p.cacheWrite + u.outputTokens * p.output) / 1e6;
}

export function normaliseUsage(model: string, u: LanguageModelUsage | undefined, meta?: ProviderMetadata): Usage {
  const inputTokens = u?.inputTokens ?? 0;
  const outputTokens = u?.outputTokens ?? 0;
  const orUsage = (meta?.openrouter as { usage?: { cost?: number; promptTokensDetails?: { cachedTokens?: number } } } | undefined)?.usage;
  const cachedTokens = u?.inputTokenDetails?.cacheReadTokens ?? orUsage?.promptTokensDetails?.cachedTokens ?? 0;
  const cacheWriteTokens = u?.inputTokenDetails?.cacheWriteTokens ?? 0;
  const estimate = costFor(model, { inputTokens, outputTokens, cachedTokens, cacheWriteTokens });
  const reported = typeof orUsage?.cost === "number" ? orUsage.cost : undefined;
  return { inputTokens, outputTokens, cachedTokens, cacheWriteTokens, totalTokens: inputTokens + outputTokens, costUsd: reported ?? estimate, reportedCostUsd: reported };
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0 };

export interface LlmFactory {
  readonly mode: "live";
  model(id: string): LanguageModel;
}

/**
 * OpenRouter is the only provider seam. Any OpenRouter model id works; Anthropic models get automatic
 * prompt caching through the top-level cache_control, and `usage.include` returns the exact USD cost.
 */
export function makeLlm(opts: { apiKey: string; cache?: CacheStore; appName?: string }): LlmFactory {
  const provider = createOpenRouter({
    apiKey: opts.apiKey,
    headers: { "HTTP-Referer": "https://github.com/paypal-swarm", "X-Title": opts.appName ?? "Swarm" },
  });
  const models = new Map<string, LanguageModel>();
  return {
    mode: "live",
    model(id: string) {
      let m = models.get(id);
      if (!m) {
        const base = provider.chat(id, { usage: { include: true }, cache_control: { type: "ephemeral" } } as Parameters<typeof provider.chat>[1]);
        m = opts.cache ? wrapLanguageModel({ model: base, middleware: cacheMiddleware(opts.cache, id) }) : base;
        models.set(id, m);
      }
      return m;
    },
  };
}
