"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Modes, Severity } from "@/lib/api";
import { API } from "@/lib/api";
import type { OrderRow } from "@/lib/arena";
import { Alert, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
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
