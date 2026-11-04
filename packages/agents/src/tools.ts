import { redactDeep, type ActorClass } from "@swarm/core";
import { isRateLimit, trimForModel, type SwarmTool, type ToolOutcome } from "@swarm/paypal";
import { tool, type ToolSet } from "ai";
import type { ZodTypeAny } from "zod";
import type { World } from "./world";

/** A capability an agent can call. Same object serves scripted drivers (call) and the LLM (via toToolSet). */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  call(input: unknown): Promise<ToolOutcome>;
}

export interface LogOpts {
  actor: string;
  actorClass: ActorClass;
  /** Runs after every call with the raw outcome; emits domain events (order.captured, ...). */
  after?: (input: Record<string, unknown>, outcome: ToolOutcome) => Promise<void> | void;
  /** Lets a wrapper short-circuit the PayPal call (hardened capture lock, refund clamp). Return an outcome to skip the call. */
  before?: (input: Record<string, unknown>) => Promise<ToolOutcome | undefined | { input: Record<string, unknown> }> | ToolOutcome | undefined | { input: Record<string, unknown> };
  maxRetries?: number;
}

const BACKOFF_MS = [400, 900, 2000];

/**
 * Wraps a PayPal tool with the event log: tool.call, tool.result, paypal.error, infra.rate_limit (with
 * retry + backoff), id extraction and redaction. The model only ever sees the trimmed result.
 */
export function logged(world: World, t: SwarmTool, opts: LogOpts): AgentTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    async call(rawInput: unknown): Promise<ToolOutcome> {
      let input = ((rawInput ?? {}) as Record<string, unknown>) || {};
      const pre = await opts.before?.(input);
      if (pre && "input" in pre && !("ok" in pre)) input = pre.input;
      await world.emit("tool.call", opts.actor, opts.actorClass, { tool: t.name, input: redactDeep(input) });
      const started = Date.now();
      let outcome: ToolOutcome;
      if (pre && "ok" in pre) {
        outcome = pre;
      } else {
        outcome = await t.run(input);
        const retries = opts.maxRetries ?? BACKOFF_MS.length;
        for (let attempt = 0; attempt < retries && isRateLimit(outcome); attempt++) {
          await world.emit("infra.rate_limit", opts.actor, opts.actorClass, { tool: t.name, attempt: attempt + 1, backoffMs: BACKOFF_MS[attempt] ?? 2000 });
          await world.sleep(BACKOFF_MS[attempt] ?? 2000);
          if (world.o.control.stopped) break;
          outcome = await t.run(input);
        }
      }
      const trimmed = trimForModel(t.name, outcome);
      await world.emit("tool.result", opts.actor, opts.actorClass, { tool: t.name, ok: outcome.ok, status: outcome.status, issue: outcome.issue, durationMs: Date.now() - started, output: trimmed, raw: outcome.ok ? redactDeep(outcome.data) : undefined });
      if (!outcome.ok && !isRateLimit(outcome)) {
        await world.emit("paypal.error", opts.actor, opts.actorClass, { tool: t.name, status: outcome.status, issue: outcome.issue, message: outcome.message, input: redactDeep(input) });
      }
      try {
        await opts.after?.(input, outcome);
      } catch (e) {
        world.log(`after-hook ${t.name} failed: ${(e as Error).message}`);
      }
      return outcome;
    },
  };
}

/** Non-PayPal capabilities (approve_and_pay, message_merchant, reply_to_customer...) get the same logging. */
export function platformTool(world: World, def: { name: string; description: string; inputSchema: ZodTypeAny; run: (input: Record<string, unknown>) => Promise<ToolOutcome> }, opts: LogOpts): AgentTool {
  const st: SwarmTool = { name: def.name, description: def.description, inputSchema: def.inputSchema, run: (i) => def.run((i ?? {}) as Record<string, unknown>) };
  return logged(world, st, opts);
}

export function toToolSet(tools: AgentTool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (input: unknown) => trimForModel(t.name, await t.call(input)),
      }),
    ]),
  ) as ToolSet;
}

export const byName = (tools: AgentTool[]) => new Map(tools.map((t) => [t.name, t]));
export const ok = (data: unknown): ToolOutcome => ({ ok: true, status: 200, data });
export const fail = (issue: string, message: string, status = 400): ToolOutcome => ({ ok: false, status, issue, message, data: { issue, message } });
