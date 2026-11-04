import { DEFAULT_MODELS, makeLlm, normaliseUsage } from "@swarm/agents";
import { jsonSchema, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import type { Env } from "./env";
import type { RunManager } from "./runs";

/** What the browser adapter sends. Mirrors AG Studio's conversation items closely enough to translate 1:1. */
export const StudioTurnSchema = z.object({
  runId: z.string().optional(),
  model: z.string().optional(),
  system: z.string().optional(),
  maxOutputTokens: z.number().int().positive().max(4000).optional(),
  items: z.array(
    z.union([
      z.object({ type: z.literal("message"), role: z.enum(["user", "assistant", "system"]), content: z.string() }),
      z.object({ type: z.literal("tool_call"), id: z.string(), name: z.string(), arguments: z.unknown() }),
      z.object({ type: z.literal("tool_result"), id: z.string(), name: z.string().optional(), output: z.unknown() }),
    ]),
  ),
  tools: z.array(z.object({ name: z.string(), description: z.string().optional(), parameters: z.record(z.unknown()).optional() })).default([]),
  /** AG Studio may ask for a JSON reply; folded into the instructions so any OpenRouter model honours it. */
  responseFormat: z.object({ type: z.literal("json"), name: z.string(), description: z.string().optional(), schema: z.record(z.unknown()) }).optional(),
});
export type StudioTurn = z.infer<typeof StudioTurnSchema>;

/** NDJSON frames, AG-UI flavoured: TEXT_MESSAGE_CHUNK, TOOL_CALL_START/ARGS/END, RUN_FINISHED, RUN_ERROR. */
export type StudioFrame =
  | { type: "RUN_STARTED"; model: string; mode: "live" | "scripted" }
  | { type: "TEXT_MESSAGE_CHUNK"; delta: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolName: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "RUN_FINISHED"; output: Array<{ type: "message"; role: "assistant"; content: string } | { type: "tool_call"; id: string; name: string; arguments: unknown }>; usage: { inputTokens: number; outputTokens: number; costUsd: number }; status: "completed" | "requires_action" }
  | { type: "RUN_ERROR"; message: string };

function toMessages(items: StudioTurn["items"]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const it of items) {
    if (it.type === "message") {
      if (it.role === "system") continue;
      out.push({ role: it.role, content: it.content });
    } else if (it.type === "tool_call") {
      out.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: it.id, toolName: it.name, input: it.arguments ?? {} }] });
    } else {
      out.push({ role: "tool", content: [{ type: "tool-result", toolCallId: it.id, toolName: it.name ?? "tool", output: { type: "json", value: (it.output ?? null) as never } }] });
    }
  }
  return out;
}

export async function* studioTurn(input: StudioTurn, deps: { env: Env; manager: RunManager; apiKey?: string }): AsyncGenerator<StudioFrame> {
  const model = input.model ?? deps.env.models.analyst ?? DEFAULT_MODELS.analyst;
  const apiKey = deps.apiKey ?? deps.env.openrouterKey;
  const systemItems = input.items.filter((i) => i.type === "message" && i.role === "system").map((i) => (i as { content: string }).content);
  const system = [input.system, ...systemItems].filter(Boolean).join("\n\n") || undefined;

  if (!apiKey) {
    yield { type: "RUN_STARTED", model: "scripted", mode: "scripted" };
    const text = "The Swarm analyst needs an OpenRouter key (OPENROUTER_API_KEY) to think. In scripted mode I can only point you at the prompt starters: they reproduce the report's findings as widgets without a model.";
    yield { type: "TEXT_MESSAGE_CHUNK", delta: text };
    yield { type: "RUN_FINISHED", output: [{ type: "message", role: "assistant", content: text }], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, status: "completed" };
    return;
  }

  const llm = makeLlm({ apiKey });
  const tools: ToolSet = Object.fromEntries(
    input.tools.map((t) => [t.name, tool({ description: t.description ?? t.name, inputSchema: jsonSchema((t.parameters ?? { type: "object", properties: {} }) as never) })]),
  );
  const world = input.runId ? await deps.manager.active.get(input.runId)?.handle.world : undefined;
  if (world) {
    const check = world.o.budget.check("studio", "analyst");
    if (!check.ok) {
      yield { type: "RUN_ERROR", message: `Run token budget exhausted (${check.reason}); the Studio analyst is paused for this run.` };
      return;
    }
  }
  yield { type: "RUN_STARTED", model, mode: "live" };
  const maxOutputTokens = Math.min(input.maxOutputTokens ?? 1500, world?.o.budget.maxOutputFor("analyst") ?? 1500);
  const result = streamText({ model: llm.model(model), system, messages: toMessages(input.items), tools, maxOutputTokens, experimental_telemetry: { isEnabled: true, functionId: "studio-analyst", metadata: { runId: input.runId ?? "none" } } });
  let text = "";
  const calls: Array<{ id: string; name: string; arguments: unknown }> = [];
  try {
    for await (const part of result.fullStream) {
      const p = part as { type: string; text?: string; delta?: string; toolCallId?: string; toolName?: string; input?: unknown; error?: unknown };
      if (p.type === "text-delta") {
        const delta = p.text ?? p.delta ?? "";
        text += delta;
        yield { type: "TEXT_MESSAGE_CHUNK", delta };
      } else if (p.type === "tool-call" && p.toolCallId && p.toolName) {
        yield { type: "TOOL_CALL_START", toolCallId: p.toolCallId, toolName: p.toolName };
        yield { type: "TOOL_CALL_ARGS", toolCallId: p.toolCallId, delta: JSON.stringify(p.input ?? {}) };
        yield { type: "TOOL_CALL_END", toolCallId: p.toolCallId };
        calls.push({ id: p.toolCallId, name: p.toolName, arguments: p.input ?? {} });
      } else if (p.type === "error") {
        yield { type: "RUN_ERROR", message: String((p.error as Error)?.message ?? p.error) };
        return;
      }
    }
  } catch (e) {
    yield { type: "RUN_ERROR", message: String((e as Error).message ?? e) };
    return;
  }
  const usage = normaliseUsage(model, await result.totalUsage, await result.providerMetadata);
  if (world) {
    world.o.budget.record("studio", usage);
    await world.emit("agent.turn", "analyst", "analyst", { actor: "studio", model, usage, costUsd: usage.costUsd, text: text.slice(0, 300), toolCalls: calls.map((c) => c.name), source: "ag-studio" });
  }
  yield {
    type: "RUN_FINISHED",
    output: [...(text ? [{ type: "message" as const, role: "assistant" as const, content: text }] : []), ...calls.map((c) => ({ type: "tool_call" as const, ...c }))],
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd },
    status: calls.length ? "requires_action" : "completed",
  };
}
