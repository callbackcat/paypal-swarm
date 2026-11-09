"use client";
import { useEffect, useRef, useState } from "react";
import { api, type PlanResult, type ScenarioView } from "@/lib/api";
import { describeError } from "@/components/ui";
import { PromptInput } from "@/components/sodium/ai/prompt-input";
import { Checkmark, Edit, Icon, Settings, View } from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import { DataList, DataListItem, DataListLabel, DataListValue } from "@/components/sodium/ui/data-list";
import { Frame, FrameBody, FrameFooter, FrameMeta } from "@/components/sodium/ui/frame";
import { Tag } from "@/components/sodium/ui/tag";
import { useTyping } from "@/hooks/sodium/use-typing";
import { cn } from "@/lib/sodium/utils";

/**
 * The launcher: one sentence in, a run plan to confirm, then the swarm goes. The sentence goes to POST /ai/plan-run,
 * which fills a strict schema (scenario, merchant profile, shoppers, model, a brief for the shoppers) and reads it
 * back in one line. Nothing is spent until the person presses Release. Applying the plan also fills the form below,
 * so every detail stays editable.
 */
export const PRESETS: Array<{ label: string; text: string }> = [
  { label: "Happy path", text: "Happy path: 5 ordinary shoppers on a quiet Tuesday against the baseline merchant" },
  { label: "Black Friday", text: "Try breaking checkout with impatient bargain hunters on Black Friday, then compare the baseline and the hardened merchant" },
  { label: "Dispute storm", text: "Refund-happy buyers who open chargebacks on half their orders; see how the hardened merchant handles the dispute storm" },
  { label: "Lost parcels", text: "Anxious buyers asking where their parcel is after a day with no tracking, baseline merchant" },
  { label: "Cheap smoke test", text: "Cheapest possible smoke test: 3 shoppers on gpt-oss-120b, quiet Tuesday" },
];

/** Example sentences the empty box types through, one after another, until the person writes their own. */
export const EXAMPLES = [
  "Try breaking checkout with impatient bargain hunters on Black Friday",
  "Try spamming the merchant with refund requests and chargebacks on half the orders",
  "Send anxious buyers asking where their parcel is after a day with no tracking",
  "Run 5 ordinary shoppers on a quiet Tuesday against the hardened merchant",
];

/** Types each example in turn, holds it a moment, then moves to the next; pauses while `play` is false. */
function useCyclingExample(play: boolean, holdMs = 2400): string {
  const [index, setIndex] = useState(0);
  const text = EXAMPLES[index % EXAMPLES.length] ?? "";
  const { shown, done } = useTyping(text, { play, perChar: 28 });
  useEffect(() => {
    if (!play || !done) return;
    const t = setTimeout(() => setIndex((i) => i + 1), holdMs);
    return () => clearTimeout(t);
  }, [play, done, holdMs, index]);
  return shown;
}

/** The three moments of a run, in order. The strip marks the one the person is at. */
export type Step = "describe" | "confirm" | "watch";
export const STEPS: Array<{ id: Step; title: string; line: string; icon: typeof Edit }> = [
  { id: "describe", title: "Describe", line: "One sentence, or a preset", icon: Edit },
  { id: "confirm", title: "Confirm", line: "The plan and its cost", icon: Checkmark },
  { id: "watch", title: "Watch", line: "The Arena, then the Report", icon: View },
];

export interface LauncherProps {
  scenarios: ScenarioView[] | null;
  /** The plan was read: put it into the form so the estimate and every field follow. */
  onPlan: (result: PlanResult) => void;
  /** Release what the form now holds; `both` also releases the other merchant profile for a side-by-side. */
  onRelease: (both: boolean) => void;
  /** Open the run settings (every setting the plan filled). */
  onSettings: () => void;
  /** The estimate for what the form now holds, as a short line, or null while it is on its way. */
  estimateLine: string | null;
  starting: boolean;
  /** Why the swarm cannot be released right now, or null when it can. */
  blocker: string | null;
}

/** One ruled row of the three steps; the current one takes the selection wash. */
export function StepStrip({ current }: { current: Step }) {
  return (
    <ol aria-label="Steps" className="grid grid-cols-3">
      {STEPS.map((s, i) => {
        const active = s.id === current;
        return (
          <li key={s.id} aria-current={active ? "step" : undefined} className={cn("flex min-w-0 items-start gap-3 border-line px-inset py-3 not-first:border-s", active ? "bg-selected text-text-1" : "text-text-2")}>
            <span className={cn("mt-0.5 hidden size-6 shrink-0 items-center justify-center border sm:flex", active ? "border-mark text-text-1" : "border-line text-text-3")} aria-hidden>
              <Icon icon={s.icon} size={14} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="type-label">
                {String(i + 1).padStart(2, "0")} {s.title}
              </span>
              <span className="hidden truncate type-caption sm:block">{s.line}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function SwarmLauncher({ scenarios, onPlan, onRelease, onSettings, estimateLine, starting, blocker }: LauncherProps) {
  const [text, setText] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Stop drops the answer of the request in flight; the sentence stays in the box.
  const attempt = useRef(0);
  // The examples type only while the box is empty; a word of the person's own stops them.
  const example = useCyclingExample(text.length === 0 && !planning);

  async function plant(sentence: string) {
    const t = sentence.trim();
    if (t.length < 3) return;
    const mine = ++attempt.current;
    setPlanning(true);
    setError(null);
    try {
      const r = await api.planRun(t);
      if (mine !== attempt.current) return;
      setPlan(r);
      onPlan(r);
    } catch (e) {
      if (mine === attempt.current) setError(e);
    } finally {
      if (mine === attempt.current) setPlanning(false);
    }
  }

  function stop() {
    attempt.current++;
    setPlanning(false);
  }

  const scenarioName = (id: string) => scenarios?.find((s) => s.id === id)?.name ?? id;
  const p = plan?.plan;
  const step: Step = starting ? "watch" : p ? "confirm" : "describe";

  return (
    <Frame variant="panel" aria-label="Describe the run">
      <FrameBody padding="none">
        <StepStrip current={step} />
      </FrameBody>
      <FrameBody>
        <PromptInput
          className="w-full"
          value={text}
          onValueChange={setText}
          onSubmit={(t) => void plant(t)}
          status={planning ? "submitted" : error ? "error" : "ready"}
          onStop={stop}
          error={error ? `The plan could not be read. ${describeError(error)}` : undefined}
          placeholder={example}
          minRows={3}
          maxRows={8}
          tools={
            <Button variant="ghost" size="sm" onClick={onSettings}>
              <Icon icon={Settings} />
              Settings
            </Button>
          }
          labels={{ send: "Plan the run", stop: "Stop", hint: "Enter to plan, Shift+Enter for a new line", label: "What should the swarm try" }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="type-label-sm text-text-3">Presets</span>
          {PRESETS.map((pr) => (
            <Button
              key={pr.label}
              variant="secondary"
              size="sm"
              disabled={planning}
              onClick={() => {
                setText(pr.text);
                void plant(pr.text);
              }}
            >
              {pr.label}
            </Button>
          ))}
        </div>
      </FrameBody>
      {p && plan ? (
        <>
          <FrameBody>
            <p className="type-heading-sm text-text-1">{p.reading}</p>
            <DataList className="mt-3">
              <DataListItem>
                <DataListLabel>Scenario</DataListLabel>
                <DataListValue>{scenarioName(p.scenario)}</DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Merchant</DataListLabel>
                <DataListValue>
                  <span className="flex flex-wrap items-center gap-2">
                    {p.merchantProfile}
                    {p.bothProfiles ? <Tag size="sm">then the other profile</Tag> : null}
                  </span>
                </DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Shoppers</DataListLabel>
                <DataListValue>{p.shoppers ? String(p.shoppers) : "scenario default"}</DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Model</DataListLabel>
                <DataListValue>{p.model ?? "server default"}</DataListValue>
              </DataListItem>
              {p.brief ? (
                <DataListItem>
                  <DataListLabel>Shopper brief</DataListLabel>
                  <DataListValue className="whitespace-normal">{p.brief}</DataListValue>
                </DataListItem>
              ) : null}
              <DataListItem>
                <DataListLabel>Estimate</DataListLabel>
                <DataListValue>{estimateLine ?? "working it out"}</DataListValue>
              </DataListItem>
            </DataList>
          </FrameBody>
          <FrameFooter>
            <FrameMeta>{blocker ?? (plan.source === "llm" ? `read by ${plan.model?.split("/").pop() ?? "the planner"}` : "read by keywords")}</FrameMeta>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={onSettings}>
                Edit settings
              </Button>
              {p.bothProfiles ? (
                <Button variant="secondary" size="sm" pending={starting} pendingLabel="Starting" disabled={!!blocker} onClick={() => onRelease(true)}>
                  Release both profiles
                </Button>
              ) : null}
              <Button size="sm" pending={starting} pendingLabel="Starting" disabled={!!blocker} onClick={() => onRelease(false)}>
                Release the swarm
              </Button>
            </div>
          </FrameFooter>
        </>
      ) : null}
    </Frame>
  );
}
