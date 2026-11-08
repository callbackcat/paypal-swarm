'use client';

import {useState, type ReactNode} from 'react';
import {cn} from '@/lib/sodium/utils';
import {ChartDataTable, useDrawn, useElementDirection, useElementWidth, useRovingPoints} from '@/components/sodium/ui/chart-parts';
import {CHART_EMPTY, EMPTY_VALUE, formatExact, niceScale, numberAt, tickCount, unitFormat, type ChartRow, type ChartUnit} from '@/components/sodium/ui/chart-scale';

// Sodium's stem chart: one value per period as a vertical stem with a square head, the value printed above it and the
// period printed below, both turned a quarter so twelve months fit at phone width with no label thinning. The heads
// are joined by the outline of a filled area, so the shape over time still reads, and the stem above each head runs on
// dotted to its printed value, so the eye can go from the head to the number without a tooltip.
//
// It is for a short run of periods a person reads value by value: calls per month, jobs per day this week, rows loaded
// per partition. Every value is on the page, so there is no readout; each stem is still one focusable column (roving
// tabindex, arrow keys) whose name says the period and the value, and a table carries the data for a screen reader.
//
// tone="accent" (the default) gives the heads Sodium's yellow, edged in the gold line colour, for the one figure on the
// screen that matters. tone="ink" is for every other stem chart beside it. The stems are --data-3 (khaki), the area
// the well, the printed values text-2, the periods text-3: the heads carry the colour.
//
// Motion is state: the stems rise from the baseline over --dur-wipe, linear, then the heads drop onto their values over
// --dur-draw, ease-out, while the area wipes in along the baseline. Reduced motion zeroes all three.

type StemChartProps = {
  /** The chart's name: the point group and the table caption. Say what and over when. */
  label: string;
  data: ChartRow[];
  /** The field that names each period. */
  xKey: string;
  /** The field that holds each value. */
  valueKey: string;
  /** The table's column heads. */
  xLabel?: string;
  valueLabel?: string;
  /** accent: yellow heads, for the one chart that matters. ink: ink heads. */
  tone?: 'accent' | 'ink';
  /** The well under the line through the heads. */
  area?: boolean;
  /** px, labels included. */
  height?: number;
  xFormat?: (value: unknown, index: number) => string;
  /** The printed values. Exact with separators by default (1,925); unit picks one unit from the largest value. */
  valueFormat?: (value: number) => string;
  unit?: ChartUnit;
  empty?: ReactNode;
  className?: string;
};

/** An 11px Commit Mono capital advance with its +0.06em tracking, and a 12px one as written. */
const MICRO_CHAR = 7.3;
const CODE_CHAR = 7.2;
const GAP = 8;
/** The square head, --marker. */
const HEAD = 8;

function StemChart({label, data, xKey, valueKey, xLabel = 'Period', valueLabel = 'Value', tone = 'accent', area = true, height = 240, xFormat = v => String(v), valueFormat, unit, empty = CHART_EMPTY, className}: StemChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const rtl = useElementDirection(ref) === 'rtl';
  const drawn = useDrawn(width > 0);
  const [active, setActive] = useState<number | null>(null);
  const n = data.length;
  const values = data.map(row => numberAt(row, valueKey));
  const known = values.filter((v): v is number => v !== null);
  const format = valueFormat ?? unitFormat(unit, known) ?? formatExact;
  const roving = useRovingPoints(n, setActive);

  const valueText = values.map(v => v === null ? EMPTY_VALUE : format(v));
  const xText = data.map((row, i) => xFormat(row[xKey], i));
  const table = <ChartDataTable
    caption={label}
    empty={empty}
    rowHeader={xLabel}
    columns={[{key: 'v', label: valueLabel}]}
    rows={data.map((_, i) => ({key: String(i), label: xText[i], values: {v: valueText[i]}}))}
  />;

  // value-ok: the chart's height is a prop in px, so the drawing and its box agree; it can only live inline.
  const box = {height};

  if (n === 0) {
    return <div ref={ref} data-slot="stem-chart" className={cn('relative type-body-sm text-text-2', className)} style={box}>
      {table}
      <span aria-hidden className="block pt-2">{empty}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-6 h-px bg-line"/>
    </div>;
  }

  const topRoom = Math.max(...valueText.map(t => t.length)) * CODE_CHAR + GAP;
  const bottomRoom = Math.max(...xText.map(t => t.length)) * MICRO_CHAR + GAP;
  const plot = {left: GAP, right: Math.max(GAP + 1, width - GAP), top: topRoom, bottom: height - bottomRoom};
  const plotWidth = plot.right - plot.left;
  const band = plotWidth / Math.max(n - 1, 1);
  const x = (i: number) => n === 1 ? plot.left + plotWidth / 2 : rtl ? plot.right - band * i : plot.left + band * i;
  const scale = niceScale(Math.min(0, ...known), Math.max(0, ...known), tickCount(plot.bottom - plot.top));
  const y = (v: number) => plot.bottom - ((v - scale.min) / (scale.max - scale.min || 1)) * (plot.bottom - plot.top);
  const base = y(Math.max(scale.min, 0));

  const heads = values.map((v, i) => v === null ? null : {x: x(i), y: y(v)});
  const runs: {x: number; y: number}[][] = [];
  let run: {x: number; y: number}[] = [];
  for (const head of heads) { if (head) run.push(head); else { if (run.length) runs.push(run); run = []; } }
  if (run.length) runs.push(run);

  const accent = tone === 'accent';
  const hitWidth = n === 1 ? plotWidth : band;

  return <div ref={ref} data-slot="stem-chart" data-state={drawn ? 'drawn' : 'start'} data-tone={tone} className={cn('relative w-full min-w-0', className)} style={box}>
    {table}
    {width > 0 && <>
      <svg aria-hidden direction="ltr" width={width} height={height} className="block overflow-visible">
        {area && <g style={{
          clipPath: drawn ? 'inset(0)' : rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)',
          transition: 'clip-path var(--dur-wipe) var(--ease-linear) var(--dur-wipe)',
        }}>
          {runs.map((pts, i) => pts.length > 1 && <path
            key={i}
            d={`${pts.map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`).join('')}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z`}
            className="fill-well stroke-none forced-colors:hidden"
          />)}
        </g>}
        {scale.ticks.map(tick => <line key={tick} x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} strokeWidth={1} className={tick === 0 ? 'stroke-line' : 'stroke-line-faint'} shapeRendering="crispEdges"/>)}
        {data.map((_, i) => {
          const head = heads[i];
          const on = active === i;
          const cx = x(i);
          return <g key={i} data-slot="stem" data-active={on || undefined}>
            {/* The dotted run from the head up to its printed value. */}
            {head && <line
              x1={cx} x2={cx} y1={plot.top} y2={head.y - HEAD / 2}
              strokeWidth={1.5} strokeDasharray="1.5 2.5"
              className={cn(on ? 'stroke-text-2' : 'stroke-data-3', 'forced-colors:stroke-[CanvasText]')}
              style={{opacity: drawn ? 1 : 0, transition: 'opacity var(--dur-state) var(--ease-out) var(--dur-wipe)'}}
            />}
            {/* The stem rises from the baseline. */}
            <line
              x1={cx} x2={cx} y1={base} y2={head ? head.y : base}
              strokeWidth={1.5}
              className={cn(on ? 'stroke-text-1' : 'stroke-data-3', 'forced-colors:stroke-[CanvasText]')}
              style={{transformBox: 'fill-box', transformOrigin: 'bottom', scale: drawn ? '1' : '1 0', transition: 'scale var(--dur-wipe) var(--ease-linear)'}}
            />
            {head && <rect
              x={cx - HEAD / 2 + 0.5} y={head.y - HEAD / 2 + 0.5} width={HEAD - 1} height={HEAD - 1} strokeWidth={1}
              className={cn(accent ? 'fill-data-1 stroke-accent-text' : 'fill-text-1 stroke-text-1', 'forced-colors:fill-[CanvasText]')}
              style={{translate: drawn ? '0 0' : `0 ${plot.top - head.y}px`, opacity: drawn ? 1 : 0, transition: 'translate var(--dur-draw) var(--ease-out) var(--dur-wipe), opacity var(--dur-state) var(--ease-out) var(--dur-wipe)'}}
            />}
            <text
              x={cx} y={0} transform={`rotate(90 ${cx} 0)`} dominantBaseline="central"
              className={cn('type-code-sm', on ? 'fill-text-1' : 'fill-text-2')}
            >{valueText[i]}</text>
            <text
              x={cx} y={plot.bottom + GAP} transform={`rotate(90 ${cx} ${plot.bottom + GAP})`} dominantBaseline="central"
              className={cn('type-micro', on ? 'fill-text-1' : 'fill-text-3')}
            >{xText[i]}</text>
          </g>;
        })}
      </svg>
      <div
        role="group"
        aria-label={label}
        aria-roledescription="chart"
        className={cn('absolute inset-y-0 flex', rtl && 'flex-row-reverse')}
        // value-ok: one column per stem, centred on it, over a plot whose edges are measured; it can only live inline.
        style={{left: n === 1 ? plot.left : plot.left - band / 2, width: n === 1 ? plotWidth : plotWidth + band}}
        onPointerLeave={() => { if (!ref.current?.contains(document.activeElement)) setActive(null); }}
      >
        {data.map((_, i) => <button
          key={i}
          ref={roving.ref(i)}
          type="button"
          tabIndex={roving.tabIndex(i)}
          aria-label={`${xText[i]}: ${values[i] === null ? 'no data' : valueText[i]}`}
          onPointerEnter={() => { roving.setCurrent(i); setActive(i); }}
          onFocus={() => { roving.setCurrent(i); setActive(i); }}
          onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setActive(null); }}
          onKeyDown={event => { if (event.key === 'Escape') setActive(null); else roving.onKeyDown(event, i); }}
          className="h-full min-w-0 shrink-0 cursor-crosshair focus-visible:focus-ring-inset"
          // value-ok: each column is one stem's share of the measured plot.
          style={{width: hitWidth}}
        />)}
      </div>
    </>}
  </div>;
}

export {StemChart, type StemChartProps};
