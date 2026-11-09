"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, ArrowUpRight, Branch, Code, DataBase, Document, Flow, Icon, Lightning, Locked, Meter, Play, Renew, Time } from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleGroup, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/sodium/ui/table";
import { cn } from "@/lib/sodium/utils";

/**
 * The static sections of the Setup page below the launcher, in the order of a product landing page: the stack, the
 * two ways to run, how the score is made, the measured numbers, questions, and a last call back to the launcher.
 * Every figure here is a measured one (README, 9 Nov 2026); the images are screenshots of real runs.
 */

/** Scrolls back to the launcher and puts the caret in the box. */
export function focusLauncher() {
  document.getElementById("launch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector<HTMLTextAreaElement>('[data-slot="prompt-input-text"]')?.focus({ preventScroll: true });
}

const STACK = ["PayPal Agent Toolkit", "PayPal Server SDK", "PayPal Sandbox", "OpenRouter", "Vercel AI SDK", "AG Grid Studio", "Hono", "Next.js"];

/** One wide landing section: a rule above, the same gutter and width as the rest. */
function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn("flex w-full flex-col gap-10 border-t border-line py-14 lg:py-20", className)}>
      {children}
    </section>
  );
}

/** A centred section heading: the sentence that names it and one or two lines under it. */
function Heading({ title, children, align = "center" }: { title: string; children?: ReactNode; align?: "center" | "start" }) {
  return (
    <div className={cn("flex max-w-measure flex-col gap-3", align === "center" ? "mx-auto items-center text-center" : "items-start")}>
      <h2 className="type-heading text-text-1">{title}</h2>
      {children ? <p className="type-body text-text-2">{children}</p> : null}
    </div>
  );
}

/** Three short facts under a path: a glyph, a mono name and one line. */
function Facts({ items }: { items: Array<{ icon: typeof Lightning; title: string; line: string }> }) {
  return (
    <ul className="flex flex-col divide-y divide-line-faint border-y border-line-faint">
      {items.map((f) => (
        <li key={f.title} className="flex items-start gap-3 py-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-line text-text-2" aria-hidden>
            <Icon icon={f.icon} size={14} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="type-label text-text-1">{f.title}</span>
            <span className="type-body-sm text-text-2">{f.line}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A screenshot of a real run, edged once. */
function Shot({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden border border-line bg-panel", className)}>
      <Image src={src} alt={alt} width={width} height={height} sizes="(min-width: 1024px) 560px, 100vw" className="block h-auto w-full" />
    </div>
  );
}

export function StackStrip() {
  return (
    <Section className="gap-6">
      <h2 className="text-center type-heading-sm text-text-2">The stack under every run</h2>
      <ul aria-label="Built with" className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
        {STACK.map((s) => (
          <li key={s} className="flex min-h-(--row) items-center justify-center bg-page px-3 text-center type-label text-text-1">
            {s}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Paths({ onSettings }: { onSettings: () => void }) {
  return (
    <Section>
      <Heading title="Run it on the demo store, or point it at your own sandbox.">Both paths release the same shoppers, the same chaos and the same merchant agents. Only the keys change, and every report says which store it ran against.</Heading>

      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="type-heading-sm text-text-1">Release a swarm on the demo store in one sentence</h3>
            <p className="type-body text-text-2">No keys, no setup. Describe the crowd, confirm the plan and its cost, and watch the Arena fill with orders, declines and disputes against a seeded sandbox store.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={focusLauncher}>
              Release the swarm
            </Button>
            <Button variant="secondary" size="sm" render={<Link href="/runs" />} nativeButton={false}>
              Browse finished runs
            </Button>
          </div>
          <Facts
            items={[
              { icon: Lightning, title: "Four scenarios", line: "Quiet Tuesday, Black Friday, Dispute storm and Lost parcels, each with its own chaos schedule" },
              { icon: Meter, title: "Cents per run", line: "$0.007 to $0.06 on Claude Haiku 5.5, estimated before anything is spent" },
              { icon: Locked, title: "Capped by construction", line: "Per-turn, per-actor and per-run token caps; the demo key sits behind a daily allowance" },
            ]}
          />
        </div>
        <Shot src="/landing/arena.png" alt="The Arena of a finished Black Friday run: 37 orders created, 31 captured, 4 declined, and the order board with capture times and missing tracking" width={1152} height={572} />
      </div>

      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <Shot src="/landing/settings.png" alt="The run settings dialog: scenario, merchant profile, options and bring-your-own keys" width={640} height={868} className="mx-auto w-full max-w-sm lg:order-first" />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="type-heading-sm text-text-1">Point the same swarm at your own PayPal sandbox</h3>
            <p className="type-body text-text-2">Paste a sandbox client id and secret, and an OpenRouter key if you want your own model bill. The shoppers read your catalog, the merchant captures your orders, and the webhooks you register are matched against the event log.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onSettings}>
              Open settings
            </Button>
            <Button variant="ghost" size="sm" render={<a href="https://github.com/callbackcat/paypal-swarm#readme" target="_blank" rel="noreferrer" />} nativeButton={false}>
              Read the setup
              <Icon icon={ArrowUpRight} />
            </Button>
          </div>
          <Facts
            items={[
              { icon: Locked, title: "Keys encrypted at rest", line: "AES-GCM in the run row, decrypted inside the executor, never written to an event" },
              { icon: DataBase, title: "Your catalog, paged", line: "Shoppers see your products the way an agent would, twelve at a time, shuffled per persona" },
              { icon: Activity, title: "Webhooks measured", line: "Every PayPal webhook is matched to its event and its lag shows in the ticker" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

export function Engine() {
  return (
    <Section>
      <Heading title="Ten rules behind every score.">The report is a pure function over the event log. No model grades the run: each rule reads the events, cites the PayPal ids it saw, and names the fix.</Heading>
      <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-14">
        <Shot src="/landing/report.png" alt="A readiness report: 79 of 100, grade B, with the four dimensions and the rules that deducted from each" width={1152} height={460} />
        <div className="flex flex-col divide-y divide-line-faint">
          <div className="flex gap-4 pb-6">
            <span className="mt-1 flex size-6 shrink-0 items-center justify-center border border-line text-text-2" aria-hidden>
              <Icon icon={Flow} size={14} />
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="type-heading-sm text-text-1">Findings from events, not impressions</h3>
              <p className="type-body text-text-2">Capture without tracking, duplicate capture, unhandled decline, oversized refund, unanswered dispute, webhook gap, buyer left waiting, position bias, injection susceptibility. Each finding links the event ids and the PayPal ids behind it, so you can open the sandbox and see the same order.</p>
            </div>
          </div>
          <div className="flex gap-4 pt-6">
            <span className="mt-1 flex size-6 shrink-0 items-center justify-center border border-line text-text-2" aria-hidden>
              <Icon icon={Renew} size={14} />
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="type-heading-sm text-text-1">Re-run with the fix and watch the score move</h3>
              <p className="type-body text-text-2">The hardened merchant is prompt plus code: a per-order capture lock, a read of the capture status, tracking on capture, refund clamping and a dispute SLA. Same scenario, same seed, same chaos, so the difference in the score is the fix and nothing else.</p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** Measured on 9 Nov 2026, all agents on Claude Haiku 5.5, PayPal sandbox, one run per cell (README). */
const MEASURED: Array<{ scenario: string; shoppers: string; chaos: string; cost: string; wall: string; baseline: number; hardened: number }> = [
  { scenario: "Quiet Tuesday", shoppers: "5", chaos: "none", cost: "$0.007", wall: "64 s", baseline: 90, hardened: 100 },
  { scenario: "Black Friday", shoppers: "40", chaos: "declines, duplicate approvals, injection product, 429 storm", cost: "$0.044 to 0.058", wall: "145 to 169 s", baseline: 79, hardened: 99 },
  { scenario: "Dispute storm", shoppers: "15", chaos: "5 chargebacks, oversized and double refunds", cost: "$0.022 to 0.025", wall: "92 to 96 s", baseline: 88, hardened: 99 },
  { scenario: "Lost parcels", shoppers: "10", chaos: "missing tracking, 30 percent webhook drops", cost: "$0.012 to 0.019", wall: "88 s", baseline: 90, hardened: 100 },
];

export function Measured() {
  return (
    <Section>
      <Heading title="Measured, not promised.">Every scenario was run against both merchants on 9 Nov 2026 with Claude Haiku 5.5 driving every agent. The numbers below are what those runs cost and scored.</Heading>
      <Table size="sm" title="Four scenarios, baseline against hardened" count={MEASURED.length}>
        <TableHeader>
          <TableRow>
            <TableHead>Scenario</TableHead>
            <TableHead numeric>Shoppers</TableHead>
            <TableHead>Chaos</TableHead>
            <TableHead numeric>Cost</TableHead>
            <TableHead numeric>Wall</TableHead>
            <TableHead numeric>Baseline</TableHead>
            <TableHead numeric>Hardened</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MEASURED.map((m) => (
            <TableRow key={m.scenario}>
              <TableCell>{m.scenario}</TableCell>
              <TableCell numeric>{m.shoppers}</TableCell>
              <TableCell className="whitespace-normal text-text-2">{m.chaos}</TableCell>
              <TableCell numeric>{m.cost}</TableCell>
              <TableCell numeric>{m.wall}</TableCell>
              <TableCell numeric>{String(m.baseline)}</TableCell>
              <TableCell numeric>{String(m.hardened)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mx-auto max-w-measure text-center type-caption text-text-2">Costs are the recorded tokens at OpenRouter list prices; wall time includes the settle phase that fast-forwards the simulated clock to the 24-hour SLAs. Eight other models and their prices are in the README.</p>
    </Section>
  );
}

const FAQ: Array<[string, string]> = [
  ["What does Swarm do?", "It points LLM shoppers, a merchant agent and a chaos agent at a PayPal sandbox store, records every agent turn and PayPal call as an event, and scores the run 0 to 100 across discoverability, transactability, fulfilment and resilience. Each finding names the fix."],
  ["Does any real money move?", "No. Everything runs against the PayPal sandbox with test cards, and without credentials PayPal calls go to an in-process mock with the same tool names and error codes. Every report states which mode it ran in."],
  ["How much does a run cost?", "Between $0.007 and $0.06 on Claude Haiku 5.5 for the four shipped scenarios, measured on 9 Nov 2026. The plan shows the estimate before anything is spent and the run refuses to start over its token cap."],
  ["What is simulated and what is real?", "Orders, captures, refunds, tracking and disputes are real sandbox objects created through the PayPal Agent Toolkit and Server SDK. Buyer approval is a card confirm, chargebacks come from the sandbox-only endpoint, and the clock runs one simulated hour per real minute so 24-hour SLAs fire inside a five-minute run."],
  ["Which models can drive the agents?", "Any OpenRouter model id. The default is Claude Haiku 5.5 for every agent; the README compares eight models from gpt-oss-120b at $0.002 a run to Opus 5.5 at $0.74. Scripted agents cost nothing and are used for the smoke test."],
  ["Can I run it against my own store?", "Yes. Open the settings, switch on bring your own keys, and paste a sandbox client id and secret. They are encrypted at rest and never written to an event. Register the api URL as a sandbox webhook and the ticker shows every webhook with its lag."],
  ["What stops a run from draining my key?", "Three levels of caps checked before every model call: per-turn output tokens, per-actor budgets and a per-run cap you can edit. At 80 percent no new shoppers are admitted; at 100 percent the run drains and still renders its report."],
  ["Where is the code?", "On GitHub under an MIT licence: a pnpm monorepo with the api, the web app and the core, paypal, agents and db packages, plus the benchmark results behind the numbers on this page."],
];

export function Questions() {
  return (
    <Section>
      <Heading title="Questions before you release one" />
      <CollapsibleGroup variant="framed" className="mx-auto w-full max-w-3xl">
        {FAQ.map(([q, a]) => (
          <Collapsible key={q}>
            <CollapsibleTrigger>{q}</CollapsibleTrigger>
            <CollapsibleContent>
              <p className="p-inset pt-0 type-body-sm text-text-2">{a}</p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </Section>
  );
}

export function Closing({ onSettings }: { onSettings: () => void }) {
  return (
    <Section className="items-center text-center">
      <Heading title="Release a swarm you would learn from.">Describe it in a sentence. Nothing is spent until you confirm.</Heading>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={focusLauncher}>
          <Icon icon={Play} />
          Release the swarm
        </Button>
        <Button variant="secondary" onClick={onSettings}>
          Open settings
        </Button>
      </div>
    </Section>
  );
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const FOOTER: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { label: "Setup", href: "/" },
      { label: "Runs", href: "/runs" },
      { label: "API docs", href: `${API}/docs`, external: true },
      { label: "Health", href: `${API}/healthz`, external: true },
    ],
  },
  {
    title: "Built with",
    links: [
      { label: "PayPal Agent Toolkit", href: "https://github.com/paypal/agent-toolkit", external: true },
      { label: "PayPal Server SDK", href: "https://github.com/paypal/PayPal-TypeScript-Server-SDK", external: true },
      { label: "OpenRouter", href: "https://openrouter.ai", external: true },
      { label: "AG Grid Studio", href: "https://www.ag-grid.com/ag-studio/", external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/callbackcat/paypal-swarm", external: true },
      { label: "README", href: "https://github.com/callbackcat/paypal-swarm#readme", external: true },
      { label: "Licence", href: "https://github.com/callbackcat/paypal-swarm/blob/main/LICENSE", external: true },
      { label: "PayPal AI Hackathon", href: "https://paypal-ai-hackathon.devpost.com", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-panel">
      <div className="grid w-full gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-1.5 type-code text-text-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 1 KB static SVG; next/image adds nothing here */}
            <img src="/logo.svg" alt="" width={28} height={28} className="size-7 shrink-0" />
            paypal-swarm
          </span>
          <p className="max-w-measure-hint type-body-sm text-text-2">An agentic-commerce flight simulator for PayPal merchants. Sandbox only; no real money moves.</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title} className="flex flex-col gap-3">
            <span className="type-label text-text-2">{col.title}</span>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className="type-body-sm text-text-1 hover:underline">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="type-body-sm text-text-1 hover:underline">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line-faint">
        <div className="flex w-full flex-wrap items-center justify-between gap-2 px-6 py-4">
          <span className="type-caption text-text-3">Built for the PayPal AI Hackathon, November 2026.</span>
          <span className="flex items-center gap-4 type-caption text-text-3">
            <span className="flex items-center gap-1">
              <Icon icon={Code} size={14} /> MIT
            </span>
            <span className="flex items-center gap-1">
              <Icon icon={Branch} size={14} /> main
            </span>
            <span className="flex items-center gap-1">
              <Icon icon={Time} size={14} /> 1 real minute = 1 simulated hour
            </span>
            <span className="flex items-center gap-1">
              <Icon icon={Document} size={14} /> OpenAPI at /docs
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
