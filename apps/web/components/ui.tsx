"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Modes, Severity } from "@/lib/api";
import { API } from "@/lib/api";
import type { OrderRow } from "@/lib/arena";
import { Alert, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { Skeleton, SkeletonRows, SkeletonText } from "@/components/sodium/ui/skeleton";
import { Status, type StatusValue } from "@/components/sodium/ui/status";
import { Tag } from "@/components/sodium/ui/tag";

/** A run's status word and mark from the api's status string. */
export function runStatus(status: string, paused = false): { value: StatusValue; word: string } {
  if (paused) return { value: "paused", word: "Paused" };
  switch (status) {
    case "created":
      return { value: "queued", word: "Queued" };
    case "running":
      return { value: "running", word: "Running" };
    case "paused":
      return { value: "paused", word: "Paused" };
    case "finished":
      return { value: "ok", word: "Finished" };
    case "finished_budget":
      return { value: "warn", word: "Budget hit" };
    case "stopped":
      return { value: "idle", word: "Stopped" };
    case "failed":
      return { value: "fail", word: "Failed" };
    default:
      return { value: "idle", word: status.replace(/_/g, " ") };
  }
}

export function RunStatus({ status, paused, live, size = "sm" }: { status: string; paused?: boolean; live?: boolean; size?: "sm" | "default" }) {
  const s = runStatus(status, paused);
  return (
    <Status status={s.value} size={size} live={live}>
      {s.word}
    </Status>
  );
}

const SEVERITY: Record<Severity, ComponentProps<typeof Tag>["variant"]> = { critical: "fail", high: "fail", medium: "warn", low: "neutral", info: "outline" };

export function SeverityTag({ severity, size = "sm" }: { severity: Severity; size?: "sm" | "default" }) {
  return (
    <Tag variant={SEVERITY[severity]} size={size}>
      {severity}
    </Tag>
  );
}

const ORDER_TAG: Record<OrderRow["status"], ComponentProps<typeof Tag>["variant"]> = { created: "neutral", approved: "outline", captured: "ok", shipped: "ok", declined: "fail", refunded: "warn", disputed: "fail" };

export function OrderStatusTag({ status }: { status: OrderRow["status"] }) {
  return (
    <Tag variant={ORDER_TAG[status]} size="sm">
      {status}
    </Tag>
  );
}

/** The two modes a run ran in: where PayPal calls went and who drove the agents. Kinds of thing, so neutral tags. */
export function ModeTags({ modes, size = "sm" }: { modes: Pick<Modes, "paypal" | "llm"> | null | undefined; size?: "sm" | "default" }) {
  if (!modes) return null;
  return (
    <span className="inline-flex gap-1.5">
      <Tag size={size} variant={modes.paypal === "sandbox" ? "neutral" : "outline"} title={modes.paypal === "sandbox" ? "Real PayPal sandbox calls through the Agent Toolkit and Server SDK" : "In-process PayPal mock with the same tool names and schemas"}>
        PayPal {modes.paypal}
      </Tag>
      <Tag size={size} variant={modes.llm === "live" ? "neutral" : "outline"} title={modes.llm === "live" ? "Claude through OpenRouter" : "Scripted agents that spend zero tokens"}>
        LLM {modes.llm}
      </Tag>
    </span>
  );
}

/** Turns a thrown error into a sentence that says what to do. A failed fetch is almost always the api not running. */
/** A value's skeleton inside a DataList, status strip or meta line: one line of the given type role at a fixed width. */
export function ValueSkeleton({ type = "code", width = "w-24" }: { type?: ComponentProps<typeof SkeletonText>["type"]; width?: string }) {
  return <SkeletonText type={type} className={width} />;
}

/** The Scenario radio list while the scenarios load: four options, each a mark, a name and a two-line description. */
export function ScenarioListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="mt-1 size-4" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SkeletonText type="body" className="w-40" />
            <SkeletonText type="body-sm" lines={2} last={0.55} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The Studio while its bundle or the run data loads: the meta line and the host frame at their final heights. */
export function StudioSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <SkeletonText type="code-sm" lines={2} last={0.7} className="max-w-xl" />
      <div className="ag-studio-host frame overflow-hidden">
        <SkeletonRows rows={8} />
      </div>
    </div>
  );
}

export function describeError(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) return `The api at ${API} did not answer. Start it (pnpm dev in apps/api) or point NEXT_PUBLIC_API_URL at a running one, then reload.`;
  return message;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert status="fail">
      <AlertTitle>Request to the api</AlertTitle>
      <AlertDescription>{describeError(error)}</AlertDescription>
    </Alert>
  );
}

/** A Button that moves to another page: rendered as the link itself, one tab stop. */
export function LinkButton({ href, children, variant = "secondary", size, className, target }: { href: string; children: ReactNode; variant?: ComponentProps<typeof Button>["variant"]; size?: ComponentProps<typeof Button>["size"]; className?: string; target?: string }) {
  return (
    <Button render={<Link href={href} target={target} />} nativeButton={false} variant={variant} size={size} className={className}>
      {children}
    </Button>
  );
}
