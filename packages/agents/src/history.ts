import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";

/**
 * Keeps a multi-turn tool history valid for the next model call.
 *
 * Two things break it in practice. A reply cut off by `maxOutputTokens` keeps its parsed tool calls but the
 * SDK never executes them (finishReason "length"), so the assistant message carries tool-call parts with no
 * results and every later call throws AI_MissingToolResultsError. And a window taken by message count can
 * start at a tool message whose assistant message was dropped, leaving orphan results.
 *
 * `repairToolHistory` fills in an error result for every unanswered tool call, telling the model to call it
 * again, and drops orphan tool results. `windowHistory` takes the last `n` messages without splitting an
 * assistant message from its tool results.
 */
const NOT_RUN = "not executed: the reply was cut off by the output limit before this tool could run; call it again, with less prose";

type ToolCallPart = Extract<AssistantModelMessage["content"], unknown[]>[number] & { type: "tool-call" };
type ToolResultPart = Extract<ToolModelMessage["content"][number], { type: "tool-result" }>;
const resultIds = (m: ToolModelMessage) => m.content.filter((p): p is ToolResultPart => p.type === "tool-result").map((p) => p.toolCallId);

export function unansweredToolCalls(messages: ModelMessage[]): ToolCallPart[] {
  const out: ToolCallPart[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const calls = m.content.filter((p): p is ToolCallPart => p.type === "tool-call");
    if (calls.length === 0) continue;
    const next = messages[i + 1];
    const answered = new Set(next?.role === "tool" ? resultIds(next) : []);
    for (const c of calls) if (!answered.has(c.toolCallId)) out.push(c);
  }
  return out;
}

export function repairToolHistory(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "tool") {
      const prev = out[out.length - 1];
      const known = new Set(prev?.role === "assistant" && typeof prev.content !== "string" ? prev.content.filter((p) => p.type === "tool-call").map((p) => (p as ToolCallPart).toolCallId) : []);
      const kept = m.content.filter((p) => p.type !== "tool-result" || known.has(p.toolCallId));
      if (kept.length > 0) out.push(kept.length === m.content.length ? m : { ...m, content: kept });
      continue;
    }
    out.push(m);
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const calls = m.content.filter((p): p is ToolCallPart => p.type === "tool-call");
    if (calls.length === 0) continue;
    const next = messages[i + 1];
    const answered = new Set(next?.role === "tool" ? resultIds(next) : []);
    const missing = calls.filter((c) => !answered.has(c.toolCallId));
    if (missing.length === 0) continue;
    const fill: ToolResultPart[] = missing.map((c) => ({ type: "tool-result", toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "error-text", value: NOT_RUN } }));
    if (next?.role === "tool") {
      out.push({ role: "tool", content: [...next.content, ...fill] });
      i++;
    } else {
      out.push({ role: "tool", content: fill });
    }
  }
  return out;
}

/** The last `n` messages, extended backwards so the window never opens on a tool message. */
export function windowHistory(messages: ModelMessage[], n: number): ModelMessage[] {
  let start = Math.max(0, messages.length - n);
  while (start > 0 && messages[start]!.role === "tool") start--;
  return repairToolHistory(messages.slice(start));
}
