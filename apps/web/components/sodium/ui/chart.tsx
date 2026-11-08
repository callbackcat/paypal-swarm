'use client';

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {cn} from '@/lib/sodium/utils';
import {Button} from '@/components/sodium/ui/button';
import {
  ChartContainer, ChartDataTable, ChartLegend, ChartSwatch, ChartTooltip, ChartTooltipContent, ChartTooltipRow, WithChart,
  seriesTone, toneArea, toneClass, toneFill, useChart, useDrawn, useElementDirection, useElementWidth, useOptionalChart, useRovingPoints,
  type ChartConfig, type ChartContextValue, type ChartDataTableColumn, type ChartDataTableProps, type ChartDataTableRow,
  type ChartLegendProps, type ChartSeriesConfig, type ChartStatus, type ChartTooltipProps,
} from '@/components/sodium/ui/chart-parts';
import {
  CHART_EMPTY, EMPTY_VALUE, formatCompact, formatExact, linearPath, niceScale, numberAt, stepPath, tickCount, unitFormat,
  type ChartRow, type ChartUnit, type Curve, type Point,
} from '@/components/sodium/ui/chart-scale';

// Sodium's chart: a line, or a line with the area under it, over a ruled plot. Plain SVG, no chart library. One series
// is yellow, the one that matters, and the rest are ink; see chart-parts.tsx for the colour rule.
//
// The plot is quiet so the series reads first: gridlines in the faint row rule, the zero line one step darker. The
// axes speak in mono: the x labels are names (JUL, MON, 14:00) in type-micro capitals, the y ticks are values as
// written in type-code-sm, both in text-3. Lines are straight between points, never smoothed: a curve invents values
// the data does not have, and Sodium draws what was measured. Each x value is one focusable column (roving tabindex,
// arrow keys) with a crosshair, a square head on each series and the readout; a table carries the data for a screen
// reader. In a right-to-left chart x runs right to left and the y axis sits on the right.
//
// Motion is state, not a keyframe: the plot mounts undrawn and turns drawn one frame later. Each solid line draws from
// its first point over --dur-draw, ease-out; the area and a dashed line wipe in along the baseline over --dur-wipe,
// linear. Reduced motion zeroes both, so the chart is simply there.
//
// The frame: frame="frame" is the chart as a region, the frame recipe with a panel-head carrying the label and any
// actions, an optional big value under it, and the legend ruled off below. frame="plain" has no chrome, for a chart
// inside a region that already has its edge. A chart holds its height in every state (loading, error, empty), so a
// page of charts never jumps as they land.

type ChartScale = {
  width: number;
  height: number;
  plot: {left: number; right: number; top: number; bottom: number};
  /** The x of a row index. */
  x: (index: number) => number;
  /** Pixel y for a value. */
  y: (value: number) => number;
  /** The distance between two x values. */
  band: number;
  /** The row under the pointer or focus. */
  active: number | null;
  rtl: boolean;
  /** False until one frame after the plot measured: what the draw and the wipe run from. */
  drawn: boolean;
};

type ChartPlotProps = {
  data: ChartRow[];
  /** The field that names each row on the x axis. */
  xKey: string;
  /** The series drawn, in order. */
  series: string[];
  config: ChartConfig;
  /** Smallest and largest value to fit. The scale rounds out to nice ticks. */
  extent: [number, number];
  height: number;
  /** The chart's name, for the point group and the table caption. */
  label: string;
  xFormat: (value: unknown, index: number) => string;
  valueFormat: (value: number) => string;
  /** Value text in the readout, table and accessible names. Defaults to valueFormat. */
  tooltipFormat?: (value: number) => string;
  children: (scale: ChartScale) => ReactNode;
  /** Drawn over the series for the active row: the square heads. */
  overlay?: (scale: ChartScale) => ReactNode;
  empty?: ReactNode;
  className?: string;
};

/** Room under the plot for the x labels: an 11px capital line and its gap. */
const X_LABEL_ROOM = 24;
/** A 12px Commit Mono advance, 0.6em, for sizing the y labels' column. */
const TICK_CHAR = 7.2;
/** An 11px Commit Mono capital's advance with its tracking, for sizing the x labels' slots. */
const MICRO_CHAR = 7.3;
/** The clear between two x labels. */
const X_LABEL_GAP = 16;
/** The gap between an axis label and the plot, --space-2. */
const AXIS_GAP = 8;

/** The cartesian frame of a line chart: axes, rules, keyboard points, readout and table. */
function ChartPlot({data, xKey, series, config, extent, height, label, xFormat, valueFormat, tooltipFormat = valueFormat, children, overlay, empty = CHART_EMPTY, className}: ChartPlotProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const rtl = useElementDirection(ref) === 'rtl';
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{x: number; y: number} | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawn = useDrawn(width > 0);
  const n = data.length;

  const top = AXIS_GAP;
  const scale = niceScale(extent[0], extent[1], tickCount(height - X_LABEL_ROOM - top));
  const tickLabels = scale.ticks.map(valueFormat);
  const axisRoom = Math.max(...tickLabels.map(t => t.length)) * TICK_CHAR + AXIS_GAP;
  const endRoom = AXIS_GAP;
  const plot = rtl
    ? {left: endRoom, right: Math.max(endRoom + 1, width - axisRoom), top, bottom: height - X_LABEL_ROOM}
    : {left: axisRoom, right: Math.max(axisRoom + 1, width - endRoom), top, bottom: height - X_LABEL_ROOM};
  const plotWidth = plot.right - plot.left;
  const band = plotWidth / Math.max(n - 1, 1);
  const origin = rtl ? plot.right : plot.left;
  const forward = rtl ? -1 : 1;
  const x = (i: number) => n === 1 ? plot.left + plotWidth / 2 : origin + forward * band * i;
  const y = (v: number) => plot.bottom - ((v - scale.min) / (scale.max - scale.min)) * (plot.bottom - plot.top);
  const s: ChartScale = {width, height, plot, x, y, band, active, rtl, drawn};

  const anchorFor = (index: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const values = series.map(key => numberAt(data[index], key)).filter((v): v is number => v !== null);
    const at = values.length ? y(Math.max(...values)) : plot.top;
    return {x: rect.left + x(index), y: rect.top + Math.min(at, plot.bottom)};
  };
  const show = (index: number) => { setActive(index); setAnchor(anchorFor(index)); };
  const hide = () => { setActive(null); setAnchor(null); };
  const roving = useRovingPoints(n, index => show(index));

  // A readout at the pointer would drift from its point on scroll, so it closes.
  useEffect(() => {
    if (active === null) return;
    const close = () => { if (!ref.current?.contains(document.activeElement)) hide(); };
    window.addEventListener('scroll', close, {capture: true, passive: true});
    return () => window.removeEventListener('scroll', close, {capture: true});
  }, [active, ref]);

  // A slot is the longest x label plus a gap, so labels thin out before any two touch.
  const xLabels = data.map((row, i) => xFormat(row[xKey], i));
  const xLabelMin = Math.max(...xLabels.map(t => t.length), 1) * MICRO_CHAR + X_LABEL_GAP;
  const xLabelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotWidth / xLabelMin))));
  const pointName = (index: number) => {
    const row = data[index];
    const values = series.map(key => {
      const v = numberAt(row, key);
      return `${config[key]?.label ?? key} ${v === null ? 'no data' : tooltipFormat(v)}`;
    });
    return `${xFormat(row?.[xKey], index)}: ${values.join(', ')}`;
  };

  const table = <ChartDataTable
    caption={label}
    empty={empty}
    rowHeader={config[xKey]?.label ?? 'Date'}
    columns={series.map(key => ({key, label: config[key]?.label ?? key}))}
    rows={data.map((row, i) => ({key: String(i), label: xFormat(row[xKey], i), values: Object.fromEntries(series.map(key => {
      const v = numberAt(row, key);
      return [key, v === null ? EMPTY_VALUE : tooltipFormat(v)];
    }))}))}
  />;

  // value-ok: the plot's height is the chart's, in px, so the drawing and its box agree; it can only live inline.
  const box = {height};

  // No rows: the sentence, the table still there saying the same, and the baseline, so the chart keeps its shape.
  if (n === 0) {
    return <div ref={ref} data-slot="chart-plot" className={cn('relative type-body-sm text-text-2', className)} style={box}>
      {table}
      <span aria-hidden className="block pt-2">{empty}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-6 h-px bg-line"/>
    </div>;
  }

  return <div ref={ref} data-slot="chart-plot" data-state={drawn ? 'drawn' : 'start'} className={cn('relative w-full min-w-0', className)} style={box}>
    {table}
    {width > 0 && <>
      {/* Coordinates are physical, mirrored above for right to left, so the drawing itself stays left to right. */}
      <svg ref={svgRef} aria-hidden direction="ltr" width={width} height={height} className="block overflow-visible">
        {scale.ticks.map((tick, i) => <g key={tick}>
          <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} strokeWidth={1} className={tick === 0 ? 'stroke-line' : 'stroke-line-faint'} shapeRendering="crispEdges"/>
          <text x={rtl ? plot.right + AXIS_GAP : plot.left - AXIS_GAP} y={y(tick)} dy="0.34em" textAnchor={rtl ? 'start' : 'end'} className="fill-text-3 type-code-sm">{tickLabels[i]}</text>
        </g>)}
        {data.map((row, i) => {
          if ((n - 1 - i) % xLabelEvery !== 0) return null;
          // The last label hangs inward from the edge, so a label within one label's room of it would overlap it.
          if (i !== n - 1 && Math.abs(x(n - 1) - x(i)) < xLabelMin * 1.5) return null;
          const first = rtl ? 'end' : 'start', last = rtl ? 'start' : 'end';
          const at = n > 1 ? (i === 0 ? first : i === n - 1 ? last : 'middle') : 'middle';
          return <text key={i} x={x(i)} y={height - 6} textAnchor={at} className="fill-text-3 type-micro">{xLabels[i]}</text>;
        })}
        {active !== null && <line x1={x(active)} x2={x(active)} y1={plot.top} y2={plot.bottom} strokeWidth={1} className="stroke-line-control" shapeRendering="crispEdges"/>}
        {children(s)}
        {overlay?.(s)}
      </svg>
      <div
        role="group"
        aria-label={label}
        aria-roledescription="chart"
        className="absolute flex"
        // value-ok: the hit areas cover the plot, whose edges are measured, so they can only live inline.
        style={{left: n === 1 ? plot.left : plot.left - band / 2, top: plot.top, width: n === 1 ? plotWidth : plotWidth + band, height: plot.bottom - plot.top}}
        onPointerLeave={() => { if (!ref.current?.contains(document.activeElement)) hide(); }}
      >
        {data.map((_, i) => <button
          key={i}
          ref={roving.ref(i)}
          type="button"
          tabIndex={roving.tabIndex(i)}
          aria-label={pointName(i)}
          onPointerEnter={() => { roving.setCurrent(i); show(i); }}
          onFocus={() => { roving.setCurrent(i); show(i); }}
          onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) hide(); }}
          onKeyDown={event => { if (event.key === 'Escape') hide(); else roving.onKeyDown(event, i); }}
          className="h-full min-w-0 flex-1 cursor-crosshair focus-visible:focus-ring-inset"
        />)}
      </div>
      <ChartTooltip anchor={active !== null ? anchor : null}>
        {active !== null && <ChartTooltipContent title={xFormat(data[active]?.[xKey], active)}>
          {series.map(key => {
            const v = numberAt(data[active], key);
            return <ChartTooltipRow key={key} indicator={<ChartSwatch series={key}/>} label={config[key]?.label ?? key} value={v === null ? EMPTY_VALUE : tooltipFormat(v)}/>;
          })}
        </ChartTooltipContent>}
      </ChartTooltip>
    </>}
  </div>;
}

// ---------- Line ----------

type LineChartProps = {
  data: ChartRow[];
  /** The field that names each row on the x axis, usually a date. */
  xKey: string;
  /** Series to draw. Defaults to every key in the config, minus those the legend hid. */
  series?: string[];
  /** Pass a config to use the chart on its own. Inside a ChartContainer it reads the container's. */
  config?: ChartConfig;
  /** The key of the one yellow series; the first series by default, false for none. */
  accent?: string | false;
  label: string;
  /** px. */
  height?: number;
  curve?: Curve;
  /** The area under the accent series (or the only series), a quarter of its colour down to the zero line. */
  area?: boolean;
  /** Start the y axis at zero. Turn off for values far from zero, like latency percentiles. */
  zero?: boolean;
  xFormat?: (value: unknown, index: number) => string;
  valueFormat?: (value: number) => string;
  tooltipFormat?: (value: number) => string;
  empty?: ReactNode;
  className?: string;
};

const paths = {linear: linearPath, step: stepPath};

/** Runs of consecutive points with a value. A gap in the data is a gap in the line. */
function runs(data: ChartRow[], key: string, x: (i: number) => number, y: (v: number) => number) {
  const out: Point[][] = [];
  let current: Point[] = [];
  data.forEach((row, i) => {
    const v = numberAt(row, key);
    if (v === null) { if (current.length) out.push(current); current = []; return; }
    current.push({x: x(i), y: y(v)});
  });
  if (current.length) out.push(current);
  return out;
}

/** The line's weight and dash: 1.5px, and a 4 by 3 dash for a dashed series. */
const LINE = 1.5;
const DASH = '4 3';
/** A square head: --marker, 8px. */
const HEAD = 8;

/** The wipe a mark arrives with: clipped to its start edge, opened to full over --dur-wipe, linear. */
function wipeStyle(drawn: boolean, rtl: boolean, delay = '0ms'): React.CSSProperties {
  return {
    clipPath: drawn ? 'inset(0)' : rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)',
    transition: `clip-path var(--dur-wipe) var(--ease-linear) ${delay}`,
  };
}

/** The draw a solid line arrives with: its dash offset runs from the whole length to none over --dur-draw. */
function drawStyle(drawn: boolean): React.CSSProperties {
  return {strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1, transition: 'stroke-dashoffset var(--dur-draw) var(--ease-out)'};
}

function LineChartPlot({data, xKey, series, label, height = 200, curve = 'linear', area, zero = true, xFormat = v => String(v), valueFormat = formatCompact, tooltipFormat, empty, className}: Omit<LineChartProps, 'config' | 'accent'>) {
  const chart = useChart();
  const {config, keys, hidden, accent} = chart;
  const shown = (series ?? keys).filter(key => !hidden.has(key));
  const values = data.flatMap(row => shown.map(key => numberAt(row, key)).filter((v): v is number => v !== null));
  const extent: [number, number] = [zero ? Math.min(0, ...values) : Math.min(...values), Math.max(...values, zero ? 0 : -Infinity)];
  const toPath = paths[curve];
  const areaKey = area ? (shown.length === 1 ? shown[0] : accent && shown.includes(accent) ? accent : null) : null;
  // The accent draws last, over the ink, so the yellow series is never under another line.
  const order = [...shown.filter(k => k !== accent), ...shown.filter(k => k === accent)];

  return <ChartPlot
    data={data} xKey={xKey} series={shown} config={config} extent={extent} height={height} label={label}
    xFormat={xFormat} valueFormat={valueFormat} tooltipFormat={tooltipFormat} empty={empty} className={className}
    overlay={s => s.active !== null && order.map(key => {
      const v = numberAt(data[s.active!], key);
      if (v === null) return null;
      const {tone} = seriesTone(chart, key);
      // The active point: an 8px square head in the series, edged in its line colour. Never a dot.
      return <rect key={key} x={s.x(s.active!) - HEAD / 2 + 0.5} y={s.y(v) - HEAD / 2 + 0.5} width={HEAD - 1} height={HEAD - 1} strokeWidth={1} className={cn(toneClass[tone], toneFill[tone], 'stroke-current')}/>;
    })}
  >
    {s => order.map(key => {
      const {tone, dashed} = seriesTone(chart, key);
      const segments = runs(data, key, s.x, s.y);
      const base = Math.min(Math.max(s.y(0), s.plot.top), s.plot.bottom);
      return <g key={key} data-slot="line-chart-series" data-series={key} className={toneClass[tone]}>
        {key === areaKey && <g style={wipeStyle(s.drawn, s.rtl)}>
          {segments.map((pts, i) => pts.length > 1 && <path
            key={`a${i}`}
            d={`${toPath(pts)}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z`}
            className={cn(toneArea[tone], 'stroke-none forced-colors:hidden')}
          />)}
        </g>}
        <g style={dashed ? wipeStyle(s.drawn, s.rtl) : undefined}>
          {segments.map((pts, i) => pts.length === 1
            ? <rect key={i} x={pts[0].x - 2} y={pts[0].y - 2} width={4} height={4} className="fill-current"/>
            : <path
                key={i}
                d={toPath(pts)}
                fill="none"
                strokeWidth={LINE}
                strokeDasharray={dashed ? DASH : undefined}
                strokeLinejoin="miter"
                strokeLinecap="square"
                pathLength={dashed ? undefined : 1}
                style={dashed ? undefined : drawStyle(s.drawn)}
                className="stroke-current forced-colors:stroke-[CanvasText]"
              />)}
        </g>
      </g>;
    })}
  </ChartPlot>;
}

/** Values over time. Inside a ChartContainer it shares the container's config, accent and legend. */
function LineChart({config, accent, ...props}: LineChartProps) {
  return <WithChart config={config} xKey={props.xKey} accent={accent}><LineChartPlot {...props}/></WithChart>;
}

// ---------- Frame ----------

type ChartFrameStyle = 'frame' | 'plain';

type ChartFrameProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  /** frame: the region's edge, a panel-head and the legend ruled off below. plain: no chrome. */
  frame?: ChartFrameStyle;
  title: ReactNode;
  /** The big number the chart explains: the total, the latest reading. */
  value?: ReactNode;
  /** A sentence beside the value, or under the title with no value. */
  description?: ReactNode;
  /** Controls at the head's end: a range Select, a ghost icon Button. */
  actions?: ReactNode;
  /** The legend, ruled off under the plot. */
  footer?: ReactNode;
  /** px. The body's height in every state. */
  height?: number;
  loading?: boolean;
  /** What failed, as a sentence. Shows the error state instead of the chart. */
  error?: ReactNode;
  onRetry?: () => void;
  /** True while a retry runs. */
  retrying?: boolean;
  /** No data: the body to show. */
  empty?: ReactNode;
};

/** The loading shape: a still line in the rule colour over the baseline, the chart's own outline before its data. */
function Silhouette() {
  const points = [62, 48, 56, 34, 42, 28, 38, 22, 30, 18].map((h, i, all) => `${(i / (all.length - 1)) * 100},${h + 20}`).join(' ');
  return <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
    <line x1={0} x2={100} y1={100} y2={100} vectorEffect="non-scaling-stroke" strokeWidth={1} className="stroke-line"/>
    <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinejoin="miter" className="stroke-line forced-colors:stroke-[GrayText]"/>
  </svg>;
}

function ChartFrame({title, value, description, actions, footer, height = 200, loading, error, onRetry, retrying, empty, frame = 'frame', className, children, ...props}: ChartFrameProps) {
  const state = loading ? 'loading' : error ? 'error' : empty ? 'empty' : 'ready';
  // Retry unmounts with the error; if it had focus, focus moves to the chart's title, never the page.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retryFocused = useRef(false);
  useEffect(() => {
    if (state === 'error' || !retryFocused.current) return;
    retryFocused.current = false;
    if (!document.activeElement || document.activeElement === document.body) titleRef.current?.focus();
  }, [state]);
  const framed = frame === 'frame';

  // Framed, the title is the region header's name, as written. Plain, it labels a part of a body, like a meter's label.
  const heading = <h3 ref={titleRef} tabIndex={-1} data-slot="chart-frame-title" className={cn('min-w-0 truncate outline-none', framed ? 'text-text-1' : 'type-label-sm text-text-2')}>{title}</h3>;
  const header = framed
    ? <header data-slot="chart-frame-header" className="panel-head justify-between">
        {heading}
        {actions && <div data-slot="chart-frame-actions" className="panel-head-actions">{actions}</div>}
      </header>
    : <header data-slot="chart-frame-header" className="flex min-w-0 items-center justify-between gap-3 pb-3">
        {heading}
        {actions && <div data-slot="chart-frame-actions" className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>;

  const lead = (value !== undefined || description) && <div data-slot="chart-frame-lead" className={cn('flex min-w-0 items-end gap-4', framed ? 'px-inset pt-inset' : 'pb-4')}>
    {value !== undefined && <p data-slot="chart-frame-value" className="type-figure text-text-1">{value}</p>}
    {description && <p data-slot="chart-frame-description" className={cn('min-w-0 max-w-(--measure-hint) type-caption text-text-2', value !== undefined && 'border-s border-line-control ps-2')}>{description}</p>}
  </div>;

  const body = <div data-slot="chart-frame-plot" className={cn('min-w-0', framed && 'p-inset')}>
    {/* value-ok: the body holds the chart's height in px in every state, so nothing jumps; it can only live inline. */}
    <div data-slot="chart-frame-body" className="relative min-w-0" style={{height}}>
      {state === 'loading' && <div data-slot="chart-frame-loading" className="h-full pb-6 ps-10">
        <span className="sr-only">Loading {typeof title === 'string' ? title : 'chart'}</span>
        <Silhouette/>
      </div>}
      {/* Top-left, where the chart would start, in a body that keeps its height. */}
      {state === 'error' && <div role="status" className="flex h-full flex-col items-start gap-3">
        <p className="type-body-sm text-fail-text">{error}</p>
        {onRetry && <Button size="sm" variant="secondary" pending={!!retrying} pendingLabel="Retrying" onFocus={() => { retryFocused.current = true; }} onBlur={event => { if (event.relatedTarget) retryFocused.current = false; }} onClick={onRetry}>Retry</Button>}
      </div>}
      {state === 'empty' && <div className="relative h-full type-body-sm text-text-2">
        {empty}
        <span aria-hidden className="absolute inset-x-0 bottom-6 h-px bg-line"/>
      </div>}
      {state === 'ready' && children}
    </div>
  </div>;

  // The footer keeps its room in every state, so the legend landing never moves what is below. Framed, it takes the
  // region's 12px inset like any footer, and a legend reaches past it by its ghost items' 6px, so the first swatch
  // sits on the inset with the header's name.
  const foot = footer ? <div data-slot="chart-frame-footer" aria-hidden={state !== 'ready' || undefined} inert={state !== 'ready' || undefined} className={cn(framed ? 'border-t border-line-faint p-inset *:data-[slot=chart-legend]:-mx-1.5' : 'pt-2', state !== 'ready' && 'invisible')}>{footer}</div> : null;

  return <section
    data-slot="chart-frame"
    data-state={state}
    data-frame={frame}
    aria-busy={loading || undefined}
    className={cn('flex min-w-0 flex-col text-text-1', framed && 'frame', className)}
    {...props}
  >
    {header}{lead}{body}{foot}
  </section>;
}

// ---------- Chart ----------

type ChartProps = {
  /** line: the series as lines. area: the same, with the yellow series' area filled down to zero. */
  type?: 'line' | 'area';
  /** The chart's name: the frame title, the point group and the data table's caption. Say what and over when. */
  label: string;
  /** Shown in the head; the label by default. */
  title?: ReactNode;
  /** The big number the chart explains. */
  value?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** frame: the region's edge, a panel-head and a ruled legend. plain: no chrome. */
  frame?: ChartFrameStyle;
  data: ChartRow[];
  /** The field that names each row on the x axis. */
  xKey: string;
  config: ChartConfig;
  series?: string[];
  /** The key of the one yellow series; the first series that is not a status by default, false for none. */
  accent?: string | false;
  xFormat?: (value: unknown, index: number) => string;
  /** The legend under the plot. On with more than one series. */
  legend?: boolean;
  /** Series switched off at first. */
  defaultHidden?: string[];
  curve?: Curve;
  zero?: boolean;
  /** px. The body holds it in every state. */
  height?: number;
  loading?: boolean;
  /** What failed. Shows the error state, with Retry when onRetry is set. */
  error?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /** The sentence for no data, shown when data is empty. */
  empty?: ReactNode;
  /** Axis, readout and table share one unit from the largest value. */
  unit?: ChartUnit;
  valueFormat?: (value: number) => string;
  className?: string;
};

/** A line or area chart in its frame, with its states, legend, readout and table. */
function Chart({type = 'line', label, title, value, description, actions, frame = 'frame', data, xKey, config, series, accent, xFormat, legend, defaultHidden, curve, zero, height = 200, loading, error, onRetry, retrying, empty, unit, valueFormat, className}: ChartProps) {
  const shown = series ?? Object.keys(config).filter(k => k !== xKey);
  const values: number[] = [];
  for (const row of data) for (const key of shown) { const v = numberAt(row, key); if (v !== null) values.push(v); }
  const format = valueFormat ?? unitFormat(unit, values);
  const isEmpty = !loading && !error && data.length === 0;
  // An empty chart still has its table, one row that says so; the sentence on screen is hidden from a reader, so it is heard once.
  const emptyText = empty ?? CHART_EMPTY;
  const emptyState = isEmpty
    ? <><span aria-hidden>{emptyText}</span><ChartDataTable caption={label} rowHeader={config[xKey]?.label ?? 'Date'} columns={shown.map(key => ({key, label: config[key]?.label ?? key}))} rows={[]} empty={emptyText}/></>
    : undefined;
  const showLegend = legend ?? shown.length > 1;
  return <ChartContainer config={config} xKey={xKey} accent={accent} defaultHidden={defaultHidden} className="min-w-0">
    <ChartFrame title={title ?? label} value={value} description={description} actions={actions} footer={showLegend ? <ChartLegend series={series}/> : null} height={height} loading={loading} error={error} onRetry={onRetry} retrying={retrying} empty={emptyState} frame={frame} data-chart-type={type} className={className}>
      <LineChart data={data} xKey={xKey} series={series} label={label} height={height} curve={curve} area={type === 'area'} zero={zero} xFormat={xFormat} valueFormat={format} empty={empty}/>
    </ChartFrame>
  </ChartContainer>;
}

export {
  Chart, ChartFrame, ChartPlot, LineChart,
  ChartContainer, WithChart, useChart, useOptionalChart, useElementWidth, useElementDirection, useRovingPoints, useDrawn,
  seriesTone, ChartSwatch, ChartTooltip, ChartTooltipContent, ChartTooltipRow, ChartDataTable, ChartLegend,
  niceScale, tickCount, formatCompact, formatExact, unitFormat, numberAt, linearPath, stepPath, wipeStyle, drawStyle,
  type ChartProps, type ChartFrameProps, type ChartPlotProps, type ChartScale, type LineChartProps,
  type ChartConfig, type ChartSeriesConfig, type ChartStatus, type ChartContextValue, type ChartUnit, type ChartRow, type Curve,
  type ChartTooltipProps, type ChartDataTableProps, type ChartDataTableColumn, type ChartDataTableRow, type ChartLegendProps,
};
