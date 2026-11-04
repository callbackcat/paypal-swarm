"use client";
import type { ReactNode } from "react";
import type { Modes, Severity } from "@/lib/api";

export function Chip({ children, tone = "", title }: { children: ReactNode; tone?: "" | "ok" | "warn" | "bad" | "info" | "muted" | "accent"; title?: string }) {
  return (
    <span className={`chip ${tone ? `chip-${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const tone = severity === "critical" || severity === "high" ? "bad" : severity === "medium" ? "warn" : severity === "low" ? "info" : "muted";
  return <Chip tone={tone}>{severity}</Chip>;
}

export function StatusChip({ status }: { status: string }) {
  const tone = status === "running" ? "ok" : status === "paused" ? "warn" : status === "finished" ? "info" : status === "failed" ? "bad" : status.startsWith("finished") ? "warn" : "muted";
  return (
    <Chip tone={tone}>
      {status === "running" && <span className="live-dot mr-1.5" />}
      {status.replace("_", " ")}
    </Chip>
  );
}

export function ModeBadges({ modes, compact = false }: { modes: Pick<Modes, "paypal" | "llm"> | null | undefined; compact?: boolean }) {
  if (!modes) return null;
  return (
    <span className="inline-flex gap-1.5">
      <Chip tone={modes.paypal === "sandbox" ? "accent" : "muted"} title={modes.paypal === "sandbox" ? "Real PayPal sandbox calls via Agent Toolkit + Server SDK" : "In-process PayPal mock with identical tool names and schemas"}>
        {compact ? "" : "PayPal "}
        {modes.paypal}
      </Chip>
      <Chip tone={modes.llm === "live" ? "accent" : "muted"} title={modes.llm === "live" ? "Claude via OpenRouter (API key)" : "Scripted zero-token agents; add OPENROUTER_API_KEY for live LLM shoppers"}>
        {compact ? "" : "LLM "}
        {modes.llm}
      </Chip>
    </span>
  );
}

export function Section({ title, right, children, className = "", bodyClass = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </header>
      <div className={`p-4 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "info" }) {
  const color = tone ? `var(--${tone})` : undefined;
  return (
    <div className="panel-2 px-3 py-2">
      <div className="muted text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mono text-lg font-semibold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="muted text-xs">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, tone = "ok" }: { value: number; max: number; tone?: "ok" | "warn" | "bad" | "info" | "accent" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar">
      <div style={{ width: `${pct}%`, background: `var(--${tone})` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted py-6 text-center text-sm">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid var(--bad)", color: "var(--bad)", background: "color-mix(in srgb, var(--bad) 10%, transparent)" }}>
      {String((error as Error).message ?? error)}
    </div>
  );
}

export function ScoreRing({ score, grade, size = 120 }: { score: number; grade: string; size?: number }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? "var(--ok)" : score >= 65 ? "var(--warn)" : "var(--bad)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Readiness score ${score} of 100, grade ${grade}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="10" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" fontSize={size / 4} fontWeight="700" fill="var(--text)" className="mono">
        {score}
      </text>
      <text x="50%" y="68%" textAnchor="middle" fontSize={size / 8} fill={tone} fontWeight="600">
        grade {grade}
      </text>
    </svg>
  );
}
