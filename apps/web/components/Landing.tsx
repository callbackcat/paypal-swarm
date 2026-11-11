"use client";
import Link from "next/link";
import type { ReactNode, Ref } from "react";
import {
  Activity,
  ArrowUpRight,
  Branch,
  Code,
  DataBase,
  Document,
  Flow,
  Icon,
  Lightning,
  Locked,
  Meter as MeterIcon,
  Renew,
  Time,
} from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleGroup,
  CollapsibleTrigger,
} from "@/components/sodium/ui/collapsible";
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from "@/components/sodium/ui/data-list";
import {
  Frame,
  FrameBody,
  FrameFooter,
  FrameHeader,
  FrameMeta,
  FrameTitle,
  FrameValue,
} from "@/components/sodium/ui/frame";
import { Meter, MeterLabel, MeterValue } from "@/components/sodium/ui/meter";
import {
  StatusStrip,
  StatusStripCell,
  StatusStripLabel,
  StatusStripUnit,
  StatusStripValue,
} from "@/components/sodium/ui/status-strip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/sodium/ui/table";
import { Tag } from "@/components/sodium/ui/tag";
import { cn } from "@/lib/sodium/utils";
import { StackLogo, type StackLogoName } from "@/components/StackLogos";
import { useRevealProgress, useTicker } from "@/components/LandingMotion";
import {
  PathsRailLine,
  usePathsRail,
  WayNumber,
} from "@/components/PathsRail";

/**
 * The Setup page below the launcher, in the order of a product page: the stack, two ways to run, how the score is
 * made, the measured numbers, questions, and a last call back to the launcher. The pictures are small coded replicas
 * of the Arena, the settings and the Report, drawn with the same components and the numbers of one real run
 * (haiku-9nov-b black-friday baseline, 9 Nov 2026). Every figure on the page is a measured one.
 */

/** Scrolls back to the launcher and puts the caret in the box. */
export function focusLauncher() {
  document
    .getElementById("launch")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  document
    .querySelector<HTMLTextAreaElement>('[data-slot="prompt-input-text"]')
    ?.focus({ preventScroll: true });
}

// PayPal is one wide cell naming its three parts, so the mark shows once; the cell takes the width of the three it replaces.
const STACK: { name: string; logo: StackLogoName; wide?: boolean }[] = [
  {
    name: "PayPal Agent Toolkit · Server SDK · Sandbox",
    logo: "paypal",
    wide: true,
  },
  { name: "OpenRouter", logo: "openrouter" },
  { name: "Vercel AI SDK", logo: "vercel" },
  { name: "AG Grid Studio", logo: "ag" },
  { name: "Hono", logo: "hono" },
  { name: "Next.js", logo: "next" },
];

/** One wide landing section: a rule above, the page gutter, generous air. */
function Section({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex w-full flex-col gap-10 border-t border-line py-12 lg:gap-12 lg:py-16",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A centred section heading: the sentence that names it, at most one line under it. */
function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-measure flex-col items-center gap-3 text-center">
      <h2 className="type-heading text-text-1">{title}</h2>
      {children ? <p className="type-body text-text-2">{children}</p> : null}
    </div>
  );
}

/** Three short facts: a glyph, a mono name, one line. */
function Facts({
  items,
  className,
}: {
  items: Array<{ icon: typeof Lightning; title: string; line: string }>;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-col divide-y divide-line-faint border-y border-line-faint",
        className,
      )}
    >
      {items.map((f) => (
        <li
          key={f.title}
          className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3"
        >
          <span className="flex items-center gap-3">
            <span
              className="flex size-6 shrink-0 items-center justify-center border border-line text-text-2"
              aria-hidden
            >
              <Icon icon={f.icon} size={14} />
            </span>
            <span className="type-label text-text-1">{f.title}</span>
          </span>
          <span className="ps-9 type-body-sm text-text-2 sm:ms-auto sm:ps-0 sm:text-end">
            {f.line}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A still of a screen, drawn with the real components: nothing in it takes focus or a click. */
function Still({
  label,
  className,
  children,
  ref,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      inert
      className={cn("pointer-events-none select-none", className)}
    >
      {children}
    </div>
  );
}

type ArenaRow = {
  who: string;
  amount: string;
  status: "captured" | "declined";
  line: string;
};

// The order feed, oldest first. The last four are the orders of the measured Black Friday baseline run and are what
// the still shows at rest; the six before them are stand-ins in the same shape, so the board has something to cycle.
const ARENA_FEED: ArenaRow[] = [
  { who: "Mateo Ruiz", amount: "$34.00", status: "captured", line: "no tracking for 21:02" },
  { who: "Priya Patel", amount: "$29.00", status: "captured", line: "no tracking for 21:15" },
  { who: "Omar Haddad", amount: "$18.50", status: "captured", line: "no tracking for 21:31" },
  { who: "Freya Novak", amount: "$50.50", status: "declined", line: "0500 at capture" },
  { who: "Leo Marsh", amount: "$34.00", status: "captured", line: "no tracking for 21:58" },
  { who: "Elena Rossi", amount: "$29.00", status: "captured", line: "no tracking for 22:10" },
  { who: "Yuki Lindqvist", amount: "$50.50", status: "captured", line: "no tracking for 23:47" },
  { who: "Sofia Costa", amount: "$29.00", status: "captured", line: "no tracking for 22:44" },
  { who: "Noah Byrne", amount: "$18.50", status: "declined", line: "0500 at capture" },
  { who: "Hana Tanaka", amount: "$50.50", status: "captured", line: "no tracking for 22:36" },
];
const ARENA_SHOWN = 4;
const ARENA_TOTALS = { created: 37, captured: 31, declined: 4 };

/**
 * The Arena, reduced: the strip and the order board of the measured Black Friday baseline run. While it is in view a
 * new order lands at the top every couple of seconds and the oldest leaves; the counts climb with it and reach the
 * totals of the run on the last order of the feed, then the feed starts over. At rest it shows those totals.
 */
function ArenaStill() {
  const L = ARENA_FEED.length;
  const { ref, n } = useTicker<HTMLDivElement>(L, 1800);
  // Orders are numbered from 1 in the order they land; order k is ARENA_FEED[(k - 1) % L].
  const at = (n - 1) % L;
  const later = ARENA_FEED.slice(at + 1);
  const counts = {
    created: ARENA_TOTALS.created - later.length,
    captured:
      ARENA_TOTALS.captured - later.filter((r) => r.status === "captured").length,
    declined:
      ARENA_TOTALS.declined - later.filter((r) => r.status === "declined").length,
  };
  const rows = Array.from({ length: ARENA_SHOWN }, (_, i) => {
    const k = n - i;
    return { k, row: ARENA_FEED[(k - 1) % L]! };
  });
  return (
    <Still
      ref={ref}
      label="The Arena of a Black Friday run: 37 orders, 31 captured, 4 declined, and the order board with new orders arriving"
    >
      <Frame variant="panel">
        <StatusStrip
          variant="plain"
          label="Run"
          className="border-b border-line"
        >
          <StatusStripCell>
            <StatusStripLabel>Orders</StatusStripLabel>
            <StatusStripValue>
              {counts.created} <StatusStripUnit>created</StatusStripUnit>
            </StatusStripValue>
          </StatusStripCell>
          <StatusStripCell>
            <StatusStripLabel>Captured</StatusStripLabel>
            <StatusStripValue>
              {counts.captured} <StatusStripUnit>0 shipped</StatusStripUnit>
            </StatusStripValue>
          </StatusStripCell>
          <StatusStripCell>
            <StatusStripLabel>Declined</StatusStripLabel>
            <StatusStripValue>
              {counts.declined} <StatusStripUnit>0 refunded</StatusStripUnit>
            </StatusStripValue>
          </StatusStripCell>
        </StatusStrip>
        <Table size="sm" title="Orders" count={counts.created}>
          <TableHeader>
            <TableRow>
              <TableHead>Shopper</TableHead>
              <TableHead numeric>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Timeline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ k, row: r }, i) => (
              // Keyed by the number of the order, so the newest row mounts and plays its arrival; the rest only move down.
              <TableRow
                key={k}
                className={i === 0 && n > L ? "landing-row-in" : undefined}
              >
                <TableCell>{r.who}</TableCell>
                <TableCell numeric>{r.amount}</TableCell>
                <TableCell>
                  <Tag
                    size="sm"
                    variant={r.status === "captured" ? "ok" : "fail"}
                  >
                    {r.status}
                  </Tag>
                </TableCell>
                <TableCell
                  className={cn(
                    "hidden type-code-sm sm:table-cell",
                    r.status === "declined" ? "text-text-2" : "text-warn-text",
                  )}
                >
                  {r.line}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
    </Still>
  );
}

/** The settings dialog, reduced to what the plan filled. */
function SettingsStill() {
  return (
    <Still
      label="Run settings: Black Friday, baseline merchant, 40 shoppers, your own keys, 645k tokens about $0.14"
      className="mx-auto w-full max-w-sm"
    >
      <Frame variant="panel">
        <FrameHeader>
          <FrameTitle>run settings</FrameTitle>
          <FrameValue meta>Black Friday</FrameValue>
        </FrameHeader>
        <FrameBody padding="none">
          <DataList className="px-inset">
            <DataListItem>
              <DataListLabel>Scenario</DataListLabel>
              <DataListValue>Black Friday, 40 shoppers</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Merchant</DataListLabel>
              <DataListValue>baseline, then hardened</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Model</DataListLabel>
              <DataListValue>claude-haiku-5.5</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>PayPal</DataListLabel>
              <DataListValue>your sandbox, keys encrypted</DataListValue>
            </DataListItem>
            <DataListItem>
              <DataListLabel>Token cap</DataListLabel>
              <DataListValue>800k</DataListValue>
            </DataListItem>
          </DataList>
        </FrameBody>
        <FrameFooter>
          <FrameMeta>645k tokens, about $0.14</FrameMeta>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" tabIndex={-1}>
              Close
            </Button>
            <Button size="sm" tabIndex={-1}>
              Release the swarm
            </Button>
          </span>
        </FrameFooter>
      </Frame>
    </Still>
  );
}

/** The Report's first frame: the score and the four dimensions of the same run. */
function ReportStill() {
  const dims: Array<{ name: string; value: number }> = [
    { name: "Discoverability", value: 100 },
    { name: "Transactability", value: 85 },
    { name: "Fulfilment", value: 36 },
    { name: "Resilience", value: 100 },
  ];
  // The score and the four bars count up from zero once, when the report scrolls into view.
  const { ref, progress } = useRevealProgress<HTMLDivElement>();
  return (
    <Still
      ref={ref}
      label="A readiness report: 79 of 100, grade B; fulfilment 36 because 31 captures never got tracking"
    >
      <Frame variant="panel">
        <FrameHeader>
          <FrameTitle>Readiness</FrameTitle>
          <FrameValue meta>grade B of 100</FrameValue>
        </FrameHeader>
        <FrameBody className="flex flex-row items-end justify-between gap-6">
          <span className="type-figure text-text-1 tabular-nums">
            {Math.round(79 * progress)}
          </span>
          <span className="max-w-measure-hint text-end type-caption text-text-2">
            31 captures never got tracking: 40 points off fulfilment. The
            hardened merchant scored 99.
          </span>
        </FrameBody>
        <FrameBody className="flex flex-col gap-3 border-t border-line">
          {dims.map((d) => (
            <Meter
              key={d.name}
              size="sm"
              value={Math.round(d.value * progress)}
              warnAt={null}
              failAt={null}
            >
              <MeterLabel>{d.name}</MeterLabel>
              <MeterValue>{(_f, v) => `${v} / 100`}</MeterValue>
            </Meter>
          ))}
        </FrameBody>
      </Frame>
    </Still>
  );
}

export function StackStrip() {
  return (
    <Section className="gap-6 lg:gap-6">
      <h2 className="text-center type-heading-sm text-text-2">Built on</h2>
      <ul
        aria-label="Built with"
        className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-8"
      >
        {STACK.map((s) => (
          <li
            key={s.name}
            className={cn(
              "flex flex-col items-center justify-center gap-3 bg-page px-3 py-4 text-center type-label text-text-1",
              s.wide && "col-span-2 sm:col-span-3",
            )}
          >
            {/* The name takes the spare height, so a two-line name and a one-line name leave their marks on one line. */}
            <span className="flex flex-1 items-center">{s.name}</span>
            <StackLogo name={s.logo} className="size-6 shrink-0" />
          </li>
        ))}
        {/* Five single cells leave a hole in the two-column grid on a phone; this fills it with the page ground. */}
        <li aria-hidden="true" className="bg-page sm:hidden" />
      </ul>
    </Section>
  );
}

export function Paths({ onSettings }: { onSettings: () => void }) {
  const rail = usePathsRail();
  return (
    <Section>
      <Heading title="Two ways to run it.">
        Same shoppers, same chaos, same merchant agents. Only the keys change.
      </Heading>

      {/* Each way is a numbered heading with its text set in from the number, so the rail has a clear run beside it. */}
      <div ref={rail.boxRef} className="relative flex flex-col gap-12 lg:gap-16">
        <PathsRailLine geometry={rail.geometry} drawn={rail.drawn} />
        <div
          data-way
          className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-6">
            <WayNumber n={1} lit={rail.firstLit} ref={rail.firstRef} />
            <div className="flex flex-col gap-2">
              <h3 className="type-heading text-text-1">On the demo store</h3>
              <p className="type-body text-text-2">
                No keys, no setup. Describe the crowd, confirm the cost, watch
                it happen.
              </p>
            </div>
            <Facts
              className="col-start-2"
              items={[
                {
                  icon: Lightning,
                  title: "Four scenarios",
                  line: "Quiet Tuesday to Black Friday",
                },
                {
                  icon: MeterIcon,
                  title: "Cents per run",
                  line: "$0.007 to $0.06 on Haiku 5.5",
                },
                {
                  icon: Locked,
                  title: "Hard caps",
                  line: "per turn, per shopper, per run",
                },
              ]}
            />
          </div>
          <ArenaStill />
        </div>

        <div
          data-way
          className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
        >
          <div className="lg:order-first">
            <SettingsStill />
          </div>
          <div
            ref={rail.endRef}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-6"
          >
            <WayNumber n={2} lit={rail.secondLit} ref={rail.secondRef} />
            <div className="flex flex-col gap-2">
              <h3 className="type-heading text-text-1">On your own sandbox</h3>
              <p className="type-body text-text-2">
                Paste a sandbox client id and secret. The swarm reads your
                catalog and captures your orders.
              </p>
            </div>
            <div className="col-start-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={onSettings}>
                Open settings
              </Button>
              <Button
                variant="ghost"
                size="sm"
                render={
                  <a
                    href="https://github.com/callbackcat/paypal-swarm#readme"
                    target="_blank"
                    rel="noreferrer"
                  />
                }
                nativeButton={false}
              >
                Setup guide
                <Icon icon={ArrowUpRight} />
              </Button>
            </div>
            <Facts
              className="col-start-2"
              items={[
                {
                  icon: Locked,
                  title: "Keys encrypted",
                  line: "at rest, never in an event",
                },
                {
                  icon: DataBase,
                  title: "Your catalog",
                  line: "paged the way an agent sees it",
                },
                {
                  icon: Activity,
                  title: "Your webhooks",
                  line: "matched to events, lag measured",
                },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

export function Engine() {
  return (
    <Section>
      <Heading title="Ten rules make the score.">
        No model grades the run. Each rule reads the event log and names the
        fix.
      </Heading>
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <ReportStill />
        <div className="flex flex-col divide-y divide-line-faint">
          <div className="flex gap-4 pb-6">
            <span
              className="mt-1 flex size-6 shrink-0 items-center justify-center border border-line text-text-2"
              aria-hidden
            >
              <Icon icon={Flow} size={14} />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="type-heading-sm text-text-1">
                Findings, not impressions
              </h3>
              <p className="type-body text-text-2">
                Every finding cites its event ids and PayPal ids. Open the
                sandbox and see the same order.
              </p>
            </div>
          </div>
          <div className="flex gap-4 pt-6">
            <span
              className="mt-1 flex size-6 shrink-0 items-center justify-center border border-line text-text-2"
              aria-hidden
            >
              <Icon icon={Renew} size={14} />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="type-heading-sm text-text-1">
                Re-run with the fix
              </h3>
              <p className="type-body text-text-2">
                Same seed, same chaos, the hardened merchant. The score moves
                and nothing else does.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** Measured on 9 Nov 2026, all agents on Claude Haiku 5.5, PayPal sandbox, one run per cell (README). */
const MEASURED: Array<{
  scenario: string;
  shoppers: string;
  cost: string;
  wall: string;
  baseline: number;
  hardened: number;
}> = [
  {
    scenario: "Quiet Tuesday",
    shoppers: "5",
    cost: "$0.007",
    wall: "64 s",
    baseline: 90,
    hardened: 100,
  },
  {
    scenario: "Black Friday",
    shoppers: "40",
    cost: "$0.044 to 0.058",
    wall: "145 to 169 s",
    baseline: 79,
    hardened: 99,
  },
  {
    scenario: "Dispute storm",
    shoppers: "15",
    cost: "$0.022 to 0.025",
    wall: "92 to 96 s",
    baseline: 88,
    hardened: 99,
  },
  {
    scenario: "Lost parcels",
    shoppers: "10",
    cost: "$0.012 to 0.019",
    wall: "88 s",
    baseline: 90,
    hardened: 100,
  },
];

const LOWEST_BASELINE = Math.min(...MEASURED.map((m) => m.baseline));

// The three numbers the table below adds up to, each the edge of its measured range.
const MEASURED_KEYS: Array<{
  label: string;
  figure: string;
  line: string;
  tone?: string;
}> = [
  {
    label: "Cost per run",
    figure: "< $0.06",
    line: "$0.007 to $0.058 at list prices",
  },
  {
    label: "Hardened score",
    figure: "99+",
    line: "99 or 100 on all four, up from 79 to 90",
    tone: "text-ok-text",
  },
  {
    label: "Wall time",
    figure: "< 3 min",
    line: "64 to 169 seconds a run",
  },
];

export function Measured() {
  return (
    <Section>
      <Heading title="Measured, not promised.">
        Four scenarios, both merchants, Claude Haiku 5.5 on every agent, 9 Nov
        2026.
      </Heading>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {/* One ruled row of the key numbers, large, so the section reads before the table does. */}
        <dl className="frame grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {MEASURED_KEYS.map((k) => (
            <div key={k.label} className="flex flex-col gap-1 p-4">
              <dt className="type-micro text-text-3">{k.label}</dt>
              <dd className="flex flex-col gap-1">
                <span className={cn("type-figure", k.tone ?? "text-text-1")}>
                  {k.figure}
                </span>
                <span className="type-caption text-text-2">{k.line}</span>
              </dd>
            </div>
          ))}
        </dl>
        <Table
          size="sm"
          title="Cost and score per scenario"
          count={MEASURED.length}
        >
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead numeric>Shoppers</TableHead>
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
                <TableCell numeric>{m.cost}</TableCell>
                <TableCell numeric>{m.wall}</TableCell>
                {/* Baseline scores in yellow, the lowest of them in red; hardened in green. */}
                <TableCell
                  numeric
                  className={
                    m.baseline === LOWEST_BASELINE
                      ? "text-fail-text"
                      : "text-accent-text"
                  }
                >
                  {String(m.baseline)}
                </TableCell>
                <TableCell numeric className="text-ok-text">
                  {String(m.hardened)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-center type-caption text-text-2">
          Recorded tokens at list prices. Eight more models in the README.
        </p>
      </div>
    </Section>
  );
}

const FAQ: Array<[string, string]> = [
  [
    "Does any real money move?",
    "No. Everything runs on the PayPal sandbox with test cards. Without credentials, PayPal calls go to a mock with the same tool names and error codes.",
  ],
  [
    "How much does a run cost?",
    "$0.007 to $0.06 on Claude Haiku 5.5. You see the estimate before anything is spent, and a run refuses to start over its cap.",
  ],
  [
    "What is real and what is simulated?",
    "Orders, captures, refunds, tracking and disputes are real sandbox objects. Buyer approval is a card confirm, and one real minute is one simulated hour, so 24-hour SLAs fire inside a five-minute run.",
  ],
  [
    "Which models?",
    "Any OpenRouter model id. Haiku 5.5 by default; the README compares eight, from $0.002 to $0.74 a run.",
  ],
  [
    "What stops a run from draining my key?",
    "Caps checked before every model call: per turn, per shopper, per run. At 80 percent no new shoppers start; at 100 percent the run drains and still writes its report.",
  ],
  [
    "Where is the code?",
    "On GitHub under MIT: the api, the web app, the core, paypal, agents and db packages, and the benchmark results behind these numbers.",
  ],
];

export function Questions() {
  return (
    <Section>
      <Heading title="Questions" />
      <CollapsibleGroup variant="framed" className="mx-auto w-full max-w-3xl">
        {FAQ.map(([q, a]) => (
          <Collapsible key={q}>
            <CollapsibleTrigger>{q}</CollapsibleTrigger>
            {/* A little air under the question, and more under the answer, so the open row reads as one block. */}
            <CollapsibleContent className="pt-2 pb-5">
              <p>{a}</p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </Section>
  );
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const FOOTER: Array<{
  title: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}> = [
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
      {
        label: "PayPal Agent Toolkit",
        href: "https://github.com/paypal/agent-toolkit",
        external: true,
      },
      {
        label: "PayPal Server SDK",
        href: "https://github.com/paypal/PayPal-TypeScript-Server-SDK",
        external: true,
      },
      { label: "OpenRouter", href: "https://openrouter.ai", external: true },
      {
        label: "AG Grid Studio",
        href: "https://www.ag-grid.com/ag-studio/",
        external: true,
      },
    ],
  },
  {
    title: "Project",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/callbackcat/paypal-swarm",
        external: true,
      },
      {
        label: "README",
        href: "https://github.com/callbackcat/paypal-swarm#readme",
        external: true,
      },
      {
        label: "Licence",
        href: "https://github.com/callbackcat/paypal-swarm/blob/main/LICENSE",
        external: true,
      },
      {
        label: "PayPal AI Hackathon",
        href: "https://paypal-ai-hackathon.devpost.com",
        external: true,
      },
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
            <img
              src="/logo.svg"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0"
            />
            paypal-swarm
          </span>
          <p className="max-w-measure-hint type-body-sm text-text-2">
            A flight simulator for agentic commerce. Sandbox only; no real money
            moves.
          </p>
        </div>
        {FOOTER.map((col) => (
          <nav
            key={col.title}
            aria-label={col.title}
            className="flex flex-col gap-3"
          >
            <span className="type-label text-text-2">{col.title}</span>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="type-body-sm text-text-1 hover:underline"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      href={l.href}
                      className="type-body-sm text-text-1 hover:underline"
                    >
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
          <span className="type-caption text-text-3">
            Built for the PayPal AI Hackathon, November 2026.
          </span>
          <span className="flex flex-wrap items-center gap-4 type-caption text-text-3">
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
