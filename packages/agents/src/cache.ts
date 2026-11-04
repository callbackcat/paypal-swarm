import { createHash } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";

/**
 * Dev-run call cache (idea from TinyTroupe). Identical model + prompt + tools + sampling params return
 * the stored response and cost nothing. Off in production and in the smoke test; the report footer
 * shows hit counts so a cached run is never mistaken for a live one.
 */
export interface CacheStore {
  get(hash: string): Promise<unknown | undefined>;
  set(hash: string, model: string, value: unknown): Promise<void>;
  readonly stats: { hits: number; misses: number };
}

export class MemoryCacheStore implements CacheStore {
  private map = new Map<string, unknown>();
  readonly stats = { hits: 0, misses: 0 };
  async get(hash: string) {
    const v = this.map.get(hash);
    if (v === undefined) this.stats.misses++;
    else this.stats.hits++;
    return v;
  }
  async set(hash: string, _model: string, value: unknown) {
    this.map.set(hash, value);
  }
  get size() {
    return this.map.size;
  }
}

export function cacheKey(modelId: string, params: unknown): string {
  const p = params as Record<string, unknown>;
  const material = { modelId, prompt: p.prompt, tools: p.tools, toolChoice: p.toolChoice, maxOutputTokens: p.maxOutputTokens, temperature: p.temperature, responseFormat: p.responseFormat };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export function cacheMiddleware(store: CacheStore, modelId: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate, params }) => {
      const key = cacheKey(modelId, params);
      const hit = (await store.get(key)) as Awaited<ReturnType<typeof doGenerate>> | undefined;
      if (hit) {
        const resp = (hit as { response?: Record<string, unknown> }).response;
        return { ...hit, response: { ...(resp ?? {}), timestamp: new Date() } } as Awaited<ReturnType<typeof doGenerate>>;
      }
      const result = await doGenerate();
      await store.set(key, modelId, JSON.parse(JSON.stringify(result)));
      return result;
    },
  };
}
