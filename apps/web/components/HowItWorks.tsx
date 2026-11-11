import type { ReactNode } from "react";
import { ArrowRight, Checkmark, Icon } from "@/components/sodium/icon";
import { cn } from "@/lib/sodium/utils";

// The body of the How it works dialog: three steps, each a small drawing and one sentence. The drawings are built
// from the same rules, bars and squares as the screens they stand for, and are decorative: the sentence says it all.

/** The box every drawing sits in, so the three line up. */
function Drawing({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-28 shrink-0 flex-col border border-line bg-well"
    >
      {children}
    </div>
  );
}

/** A line of text, drawn as a bar. */
function Bar({ className }: { className?: string }) {
  return <span className={cn("h-1 bg-text-3", className)} />;
}

/** Step 1: a prompt with two lines typed and the yellow action under it. */
function DescribeDrawing() {
  return (
    <Drawing>
      <div className="flex flex-1 flex-col justify-center gap-2 px-3">
        <Bar className="w-full" />
        <Bar className="w-2/3" />
      </div>
      <div className="flex justify-end border-t border-line px-2 py-1.5">
        <span className="h-2 w-8 bg-accent-fill" />
      </div>
    </Drawing>
  );
}

/** Step 2: the plan as three ruled rows, with the price and a tick on the last. */
function ConfirmDrawing() {
  return (
    <Drawing>
      <div className="flex flex-1 items-center justify-between px-3">
        <Bar className="w-8" />
        <Bar className="w-5" />
      </div>
      <div className="flex flex-1 items-center justify-between border-t border-line px-3">
        <Bar className="w-6" />
        <Bar className="w-9" />
      </div>
      <div className="flex flex-1 items-center justify-between border-t border-line px-3">
        <span className="type-code-sm text-text-1">$0.14</span>
        <Icon icon={Checkmark} size={14} className="text-ok-text" />
      </div>
    </Drawing>
  );
}

/** Step 3: the swarm as squares, one of them the chaos agent, over the score before and after the fix. */
function WatchDrawing() {
  const squares = [
    "bg-accent-fill",
    "bg-accent-fill",
    "bg-text-3",
    "bg-accent-fill",
    "bg-fail",
    "bg-accent-fill",
    "bg-text-3",
    "bg-accent-fill",
    "bg-accent-fill",
    "bg-text-3",
    "bg-accent-fill",
    "bg-accent-fill",
  ];
  return (
    <Drawing>
      <div className="grid flex-1 grid-cols-6 content-center gap-1.5 px-3">
        {squares.map((tone, i) => (
          <span key={i} className={cn("size-2", tone)} />
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5 border-t border-line py-1 type-code-sm">
        <span className="text-text-2">79</span>
        <Icon icon={ArrowRight} size={14} className="text-text-3" />
        <span className="text-text-1">99</span>
      </div>
    </Drawing>
  );
}

const STEPS: Array<{ title: string; body: string; drawing: ReactNode }> = [
  {
    title: "Describe",
    body: "Say who shops and what should go wrong, or pick a preset.",
    drawing: <DescribeDrawing />,
  },
  {
    title: "Confirm",
    body: "See the plan and its cost before anything is spent. Hard caps stop a runaway run.",
    drawing: <ConfirmDrawing />,
  },
  {
    title: "Watch",
    body: "Follow every order live, then read a score out of 100 with a fix for each finding.",
    drawing: <WatchDrawing />,
  },
];

export function HowItWorksSteps() {
  return (
    <>
      {/* Three centred columns from tablet width up, so the dialog is short enough to show whole; a row per step on a phone. */}
      <ol className="grid divide-y divide-line-faint sm:grid-cols-3 sm:gap-8 sm:divide-y-0 sm:px-2 sm:py-4">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex items-center gap-4 py-3 sm:flex-col sm:gap-4 sm:py-0 sm:text-center"
          >
            {step.drawing}
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="flex items-baseline gap-2 sm:justify-center">
                <span className="type-label text-text-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="type-body text-text-1">{step.title}</span>
              </span>
              <span className="type-body-sm text-text-2">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t border-line-faint pt-4 pb-1 text-center type-caption text-text-2">
        Without keys it runs on a built-in PayPal mock. Every report says which
        mode produced it.
      </p>
    </>
  );
}
