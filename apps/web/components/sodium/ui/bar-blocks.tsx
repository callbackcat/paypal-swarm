'use client';

import {useRef, type ReactNode} from 'react';
import {cva} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';
import {useDrawn, useElementDirection} from '@/components/sodium/ui/chart-parts';
import {formatExact, unitFormat, type ChartUnit} from '@/components/sodium/ui/chart-scale';

// Sodium's bar blocks: the parts of one whole as quiet blocks in a row, --space-1 apart, each as wide as its share, its number at
// the top and its name turned up the bottom edge. The number is a value (type-code, mono as written) at every size, so
// 1.2M here reads like 1.2M in a table or a status strip, and the block's height carries the size. The name is a name in
// a chart, so it takes type-micro like an axis or a swimlane. Nothing runs under the row: the blocks
// already show where each part starts and how wide it is.
//
// It is for a total split into a few named parts a person reads by number and by size at once: storage by tier, rows by
// source, spend by region. Two to six parts. Width is the value's share of the total, with a floor so the smallest
// part still holds its number and name; the number is always the truth, the width the impression.
//
// The first part is the one that matters and takes Sodium's yellow as a wash, --selected, the selected-row yellow,
// never the solid slab: a panel of blocks is read, not acted on, and a slab this size would outshout the panel's one
// button. The rest sit on the well. Text is text-1 on every plain block, so the numbers read alike and only the fill
// changes. A part that is an outcome (failed rows) takes its status tint instead, with its name saying it. Every block
// has the same edge, --line, the card colour: tone is fill and word, never an edge. The blocks stand --space-1 apart,
// so no two edges touch and every line is one 1px line.
//
// The list is a list: each part is an item a screen reader reads as its name, its value and its share. Nothing in it
// is focusable, because every value is printed.
//
// Motion is state: the blocks wipe in one after another, start to end, each over --dur-wipe, linear, as data grows
// along the row. Reduced motion zeroes it.

type BarBlockTone = 'accent' | 'well' | 'ok' | 'warn' | 'fail';

type BarBlock = {
  /** The part's name, in sentence case: the capitals come from the label role. */
  label: string;
  value: number;
  /** The fill. By default the first part is accent and the rest are the well. */
  tone?: BarBlockTone;
};

const blockVariants = cva('relative flex min-w-0 flex-col justify-between overflow-hidden border border-line', {
  variants: {
    tone: {
      accent: 'bg-selected text-text-1',
      well: 'bg-well text-text-1',
      ok: 'bg-ok-tint text-ok-text',
      warn: 'bg-warn-tint text-warn-text',
      fail: 'bg-fail-tint text-fail-text',
    },
    size: {
      sm: 'p-2 [--block-h:calc(var(--control-lg)*2.5)]',
      default: 'p-2 [--block-h:calc(var(--control-lg)*5)]',
      lg: 'p-3 [--block-h:calc(var(--control-lg)*7)]',
    },
  },
  defaultVariants: {tone: 'well', size: 'default'},
});

/**
 * The floor under each block's width, so a small part still holds its number. It
 * gives way to an equal share of the row when the row is too narrow for every floor, so no block runs past the edge.
 */
const floor = {sm: '[--block-floor:calc(var(--space-2)*9)]', default: '[--block-floor:calc(var(--space-2)*11)]', lg: '[--block-floor:calc(var(--space-2)*17)]'} as const;
const floorWidth = (n: number) => `min(var(--block-floor), calc((100% - var(--space-1) * ${n - 1}) / ${n}))`;

/** The tone of the part at index i: its own, or accent on the first plain part and the well on the rest. */
function blockTone(blocks: BarBlock[], i: number): BarBlockTone {
  if (blocks[i].tone) return blocks[i].tone!;
  return blocks.slice(0, i).some(b => !b.tone) ? 'well' : 'accent';
}

type BarBlocksProps = Omit<React.ComponentProps<'figure'>, 'children'> & {
  /** The whole's name, as the figure's caption for a screen reader: say what and when. */
  label: string;
  data: BarBlock[];
  /** sm 90px, default 180px, lg 252px tall: two and a half, five and seven large controls. sm still holds the number
   * and a six-letter turned name with room to spare. */
  size?: 'sm' | 'default' | 'lg';
  /** The printed values. Exact with separators by default (1,240); unit compacts each one in its own unit (1.2M, 94K). */
  valueFormat?: (value: number) => string;
  unit?: ChartUnit;
  /** Shown when data is empty or sums to zero. */
  empty?: ReactNode;
};

function BarBlocks({label, data, size = 'default', valueFormat, unit, empty = 'Nothing to show yet.', className, ...props}: BarBlocksProps) {
  const ref = useRef<HTMLElement>(null);
  const rtl = useElementDirection(ref) === 'rtl';
  const drawn = useDrawn();
  const parts = data.filter(b => Number.isFinite(b.value) && b.value > 0);
  const total = parts.reduce((sum, b) => sum + b.value, 0);
  // Each block picks its own unit: there is no axis to share, and 94K beside 1.2M reads better than 0.1M.
  const format = valueFormat ?? (unit ? (v: number) => unitFormat(unit, [v])!(v) : formatExact);

  if (!total) {
    return <figure ref={ref} data-slot="bar-blocks" data-state="empty" className={cn('flex min-w-0 flex-col', className)} {...props}>
      <figcaption className="sr-only">{label}</figcaption>
      <div className={cn(blockVariants({tone: 'well', size}), 'h-(--block-h) w-full justify-start type-body-sm text-text-2')}>{empty}</div>
    </figure>;
  }

  const share = (v: number) => `${Math.round((v / total) * 100)}%`;

  return <figure ref={ref} data-slot="bar-blocks" data-state={drawn ? 'drawn' : 'start'} className={cn('flex min-w-0 flex-col', className)} {...props}>
    <figcaption className="sr-only">{label}</figcaption>
    <ul className={cn('flex min-w-0 gap-1', floor[size])}>
      {parts.map((block, i) => {
        const tone = blockTone(parts, i);
        return <li
          key={`${block.label}-${i}`}
          data-slot="bar-block"
          data-tone={tone}
          className={cn(blockVariants({tone, size}), 'h-(--block-h) basis-0')}
          // value-ok: the width is the part's share of the total, and the wipe's delay is its place in the row; both are data.
          style={{
            flexGrow: block.value,
            minWidth: floorWidth(parts.length),
            clipPath: drawn ? 'inset(0)' : rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)',
            transition: `clip-path var(--dur-wipe) var(--ease-linear) calc(var(--dur-wipe) * ${i})`,
          }}
        >
          <span className="sr-only">{block.label}: {format(block.value)}, {share(block.value)} of the total</span>
          <span aria-hidden className="truncate type-code">{format(block.value)}</span>
          <span aria-hidden className="min-h-0 truncate type-micro [writing-mode:vertical-rl] rotate-180">{block.label}</span>
        </li>;
      })}
    </ul>
  </figure>;
}

export {BarBlocks, blockVariants, type BarBlocksProps, type BarBlock, type BarBlockTone};
