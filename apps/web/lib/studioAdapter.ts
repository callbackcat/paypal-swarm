import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse } from "ag-studio";
import { API } from "./api";

/** Frames the api streams back from POST /ai/studio-turn (application/x-ndjson). */
type Frame =
  | { type: "RUN_STARTED"; model: string; mode: "live" | "scripted" }
  | { type: "TEXT_MESSAGE_CHUNK"; delta: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolName: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "RUN_FINISHED"; output: Array<{ type: "message"; role: "assistant"; content: string } | { type: "tool_call"; id: string; name: string; arguments: unknown }>; usage: { inputTokens: number; outputTokens: number; costUsd: number }; status: "completed" | "requires_action" }
  | { type: "RUN_ERROR"; message: string };

type WireItem = { type: "message"; role: "user" | "assistant" | "system"; content: string } | { type: "tool_call"; id: string; name: string; arguments: unknown } | { type: "tool_result"; id: string; name?: string; output: unknown };

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const tryJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function toWire(item: AgAiConversationItem): WireItem | undefined {
  switch (item.type) {
    case "message": {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.type === "refusal" ? c.refusal : "")).join("");
      if (item.kind === "input") return { type: "message", role: item.role, content: text };
      return { type: "message", role: "assistant", content: text };
    }
    case "function_call":
      return { type: "tool_call", id: item.callId, name: item.name, arguments: tryJson(item.arguments || "{}") };
    case "function_call_output":
      return { type: "tool_result", id: item.callId, output: tryJson(item.output) };
    default:
      return undefined;
  }
}

/** A small async queue so the fetch pumps eagerly and `complete` resolves even if nobody iterates the stream. */
class Queue<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  push(v: T) {
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.items.push(v);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((r) => this.waiters.push(r));
  }
}

export interface SwarmAdapterOptions {
  runId?: string;
  /** Bring-your-own OpenRouter key for the Studio only (sent as a header, never stored). */
  apiKey?: string;
  onUsage?: (u: { inputTokens: number; outputTokens: number; costUsd: number; model: string }) => void;
}

/**
 * AG Studio `AgLlmAdapter` backed by Swarm's api, which runs the turn through the AI SDK + OpenRouter
 * and charges the tokens to the run's budget. Streams AG-UI events; `complete` carries the output items.
 */
export function swarmAdapter(opts: SwarmAdapterOptions = {}): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions) {
      const q = new Queue<AgAiEvent>();
      let resolveDone!: (r: AgLlmResponse) => void;
      const complete = new Promise<AgLlmResponse>((r) => (resolveDone = r));
      const id = uid("resp");
      const createdAt = Date.now();
      let model = request.model?.id ?? "";
      const finish = (output: AgAiOutputItem[], status: AgLlmResponse["status"], extra: Partial<AgLlmResponse> = {}) => {
        resolveDone({ id, createdAt, output, status, model, ...extra });
        q.close();
      };

      void (async () => {
        const output: AgAiOutputItem[] = [];
        let text = "";
        let messageId: string | undefined;
        const calls = new Map<string, { name: string; args: string }>();
        try {
          const res = await fetch(`${API}/ai/studio-turn`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(opts.apiKey ? { "x-openrouter-key": opts.apiKey } : {}) },
            signal: options?.signal,
            body: JSON.stringify({
              runId: opts.runId,
              model: request.model?.id,
              system: request.instructions,
              items: request.input.map(toWire).filter((x): x is WireItem => !!x),
              tools: (request.tools ?? []).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
              responseFormat: request.responseFormat.type === "json" ? { type: "json", name: request.responseFormat.name, description: request.responseFormat.description, schema: request.responseFormat.schema } : undefined,
            }),
          });
          if (!res.ok || !res.body) {
            const message = `Swarm api ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
            q.push({ type: "RUN_ERROR", message });
            finish([], "failed", { error: { code: String(res.status), message } });
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          const handle = (f: Frame) => {
            switch (f.type) {
              case "RUN_STARTED":
                model = f.model;
                break;
              case "TEXT_MESSAGE_CHUNK":
                if (!messageId) {
                  messageId = uid("msg");
                  q.push({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
                }
                text += f.delta;
                q.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: f.delta });
                break;
              case "TOOL_CALL_START":
                calls.set(f.toolCallId, { name: f.toolName, args: "" });
                q.push({ type: "TOOL_CALL_START", toolCallId: f.toolCallId, toolCallName: f.toolName, parentMessageId: messageId });
                break;
              case "TOOL_CALL_ARGS": {
                const c = calls.get(f.toolCallId);
                if (c) c.args += f.delta;
                q.push({ type: "TOOL_CALL_ARGS", toolCallId: f.toolCallId, delta: f.delta });
                break;
              }
              case "TOOL_CALL_END":
                q.push({ type: "TOOL_CALL_END", toolCallId: f.toolCallId });
                break;
              case "RUN_ERROR":
                q.push({ type: "RUN_ERROR", message: f.message });
                break;
              case "RUN_FINISHED": {
                if (messageId) q.push({ type: "TEXT_MESSAGE_END", messageId });
                if (text) output.push({ id: messageId ?? uid("msg"), kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
                for (const item of f.output) {
                  if (item.type === "tool_call") output.push({ id: uid("fc"), kind: "output", type: "function_call", callId: item.id, name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}), status: "completed" });
                }
                opts.onUsage?.({ ...f.usage, model });
                finish(output, "completed", { usage: { inputTokens: f.usage.inputTokens, outputTokens: f.usage.outputTokens, totalTokens: f.usage.inputTokens + f.usage.outputTokens } });
                break;
              }
            }
          };
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (line) handle(JSON.parse(line) as Frame);
            }
          }
          if (buf.trim()) handle(JSON.parse(buf.trim()) as Frame);
          // Stream ended without RUN_FINISHED (error path or cancel): settle with what we have.
          if (messageId) q.push({ type: "TEXT_MESSAGE_END", messageId });
          if (text && !output.length) output.push({ id: messageId ?? uid("msg"), kind: "output", type: "message", role: "assistant", status: "incomplete", content: [{ type: "text", text, annotations: [] }] });
          finish(output, options?.signal?.aborted ? "cancelled" : "incomplete");
        } catch (e) {
          const message = options?.signal?.aborted ? "cancelled" : String((e as Error).message ?? e);
          if (!options?.signal?.aborted) q.push({ type: "RUN_ERROR", message });
          finish(output, options?.signal?.aborted ? "cancelled" : "failed", { error: { code: "adapter", message } });
        }
      })();

      return { stream: { [Symbol.asyncIterator]: () => ({ next: () => q.next() }) }, complete };
    },
  };
}
