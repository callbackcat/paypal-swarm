"use client";
import { useState, type KeyboardEvent } from "react";
import { api, type PlanResult, type ScenarioView } from "@/lib/api";
import { describeError } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { DataList, DataListItem, DataListLabel, DataListValue } from "@/components/sodium/ui/data-list";
import { Field, FieldDescription, FieldLabel } from "@/components/sodium/ui/field";
import { Frame, FrameBody, FrameDescription, FrameFooter, FrameHeader, FrameMeta, FrameTitle, FrameValue } from "@/components/sodium/ui/frame";
import { Input } from "@/components/sodium/ui/input";
import { Kbd } from "@/components/sodium/ui/kbd";
import { Tag } from "@/components/sodium/ui/tag";

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

export interface LauncherProps {
  scenarios: ScenarioView[] | null;
  /** The plan was read: put it into the form so the estimate and every field follow. */
  onPlan: (result: PlanResult) => void;
  /** Release what the form now holds; `both` also releases the other merchant profile for a side-by-side. */
  onRelease: (both: boolean) => void;
  /** The estimate for what the form now holds, as a short line, or null while it is on its way. */
  estimateLine: string | null;
  starting: boolean;
  /** Why the swarm cannot be released right now, or null when it can. */
  blocker: string | null;
  /** Where "Edit details" scrolls to. */
  formId: string;
}

export function SwarmLauncher({ scenarios, onPlan, onRelease, estimateLine, starting, blocker, formId }: LauncherProps) {
  const [text, setText] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function plant(sentence: string) {
    const t = sentence.trim();
    if (t.length < 3) return;
    setPlanning(true);
    setError(null);
    try {
      const r = await api.planRun(t);
      setPlan(r);
      onPlan(r);
    } catch (e) {
      setError(e);
    } finally {
      setPlanning(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !planning) {
      e.preventDefault();
      void plant(text);
    }
  };

  const scenarioName = (id: string) => scenarios?.find((s) => s.id === id)?.name ?? id;
  const p = plan?.plan;

  return (
    <Frame variant="panel" aria-label="Describe the run">
      <FrameHeader>
        <FrameTitle>Describe the run</FrameTitle>
        <FrameValue meta>{plan ? (plan.source === "llm" ? `read by ${plan.model?.split("/").pop() ?? "the planner"}` : "read by keywords") : "one sentence"}</FrameValue>
      </FrameHeader>
      <FrameBody>
        <Field>
          <FieldLabel htmlFor="launcher-text">What should the swarm try?</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Input
              id="launcher-text"
              size="lg"
              className="min-w-0 flex-1"
              placeholder="Try breaking checkout with impatient bargain hunters on Black Friday"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              maxLength={600}
              autoComplete="off"
              trailing={<Kbd>Enter</Kbd>}
            />
            <Button size="lg" pending={planning} pendingLabel="Reading" disabled={text.trim().length < 3} onClick={() => void plant(text)}>
              Plan the run
            </Button>
          </div>
          <FieldDescription>Name who the shoppers are, what to break and which merchant to test. A model turns it into a plan you confirm before anything is spent.</FieldDescription>
        </Field>
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
      {error ? (
        <FrameBody>
          <Alert status="fail">
            <AlertTitle>The plan could not be read</AlertTitle>
            <AlertDescription>{describeError(error)}</AlertDescription>
          </Alert>
        </FrameBody>
      ) : null}
      {p && plan ? (
        <>
          <FrameBody>
            <p className="type-body text-text-1">{p.reading}</p>
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
            <FrameMeta>{blocker ?? `run name: ${p.name}`}</FrameMeta>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" render={<a href={`#${formId}`} />} nativeButton={false}>
                Edit details
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
      ) : (
        <FrameBody>
          <FrameDescription>The plan appears here with the scenario, the merchant profile, the shoppers and the estimated cost. Release it, or edit any detail in the form below first.</FrameDescription>
        </FrameBody>
      )}
    </Frame>
  );
}
