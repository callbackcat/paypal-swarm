'use client';

import {useEffect, useReducer, useState, type ReactNode} from 'react';
import {Button} from '@/components/sodium/ui/button';
import {cn} from '@/lib/sodium/utils';
import {ToolCallRow, ToolCallStack, type StepState} from '@/components/sodium/ai/tool-call-row';

// One tool an agent called inside a run, drawn as a Sodium tool-call row and fed by one lifecycle reducer. The row is
// the look (tool-call-row.tsx); this file is the data: what a call is, how its events move it, which words and body
// each tool gets, and the approval a paused call asks for.
//
// Seven statuses, and the row state each draws:
//   pending              the model is still streaming the arguments       running, tab "Preparing <noun>"
//   running              the tool is executing                            running, tab "<active> <detail>"
//   completed            it returned                                     done
//   error                it failed; the message is the body, open         failed, tab "<verb> failed"
//   awaiting-permission  the run is paused on the person                  waiting, the approval as the body, open
//   denied               the person said no; their reason is the body     stopped, "Denied"
//   cancelled            the run was stopped while this ran               stopped
// The last four, with completed, are terminal and absorb: no later event reopens or relabels them.
//
// The approval is the body of the waiting row: the question as a sentence, what allowing does, the exact thing in a
// well, then a secondary Deny and the one primary Allow. Allow is the slab because approving is the action the run is
// waiting for; Deny is not destructive, since nothing is lost by saying no.
//
// Events carry a per-call `seq`. A duplicate or out-of-order event is dropped and counted. A result that arrives before
// its call is kept as an orphan, held back `orphanTtl` ms in case the call is only late, then shown as an orphaned
// result, never as a success. An end with no status is an error, never a success. Stop is keyed by generation: it
// settles that turn's live calls to cancelled and drops that turn's late events, and a stale stop never cancels the
// next turn. This reducer is Glaze's and Quartz's, so a call reads the same in every system.
//
// Per-tool words come from a registry with aliases (sql and warehouse.query are query; sh and bash are shell). An unknown tool
// gets its name as the label and its first useful argument as the detail. Output shows 24 lines of a shell and 8 of
// anything else before "Show all", and 20,000 characters in all.

// ---------- Data ----------

type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'awaiting-permission' | 'denied' | 'cancelled';

const terminal: ReadonlySet<ToolStatus> = new Set(['completed', 'error', 'denied', 'cancelled']);
const isTerminal = (status: ToolStatus) => terminal.has(status);

/** What the person answers an approval with. */
type ToolReply = 'once' | 'reject';

type ToolCallData = {
  id: string;
  /** The tool's name as the model called it: query, shell, http, write_partition. */
  tool: string;
  status: ToolStatus;
  input?: Record<string, unknown>;
  /** The partial argument JSON while pending. */
  raw?: string;
  /** A title the tool reported, used as the detail when the renderer has none. */
  title?: string;
  metadata?: Record<string, unknown>;
  output?: string;
  error?: string;
  /** What a paused call asks for: the exact patterns, and one sentence of what allowing does. */
  permission?: {patterns: string[]; message?: string};
  /** The person's words when they denied it. */
  reason?: string;
  startedAt?: number;
  endedAt?: number;
  /** The last event applied. Events at or below it are dropped. */
  seq: number;
  /** A result that arrived before its call. */
  orphan?: boolean;
  receivedAt?: number;
};

type Seq = {seq: number; id: string; gen?: number; at?: number};
type ToolEvent =
  | (Seq & {type: 'call'; tool: string; input?: Record<string, unknown>; raw?: string})
  | (Seq & {type: 'input'; raw: string; input?: Record<string, unknown>})
  | (Seq & {type: 'start'; tool?: string; input?: Record<string, unknown>; title?: string})
  | (Seq & {type: 'progress'; metadata?: Record<string, unknown>; title?: string; output?: string})
  | (Seq & {type: 'ask'; patterns: string[]; message?: string})
  | (Seq & {type: 'reply'; reply: ToolReply; feedback?: string})
  | (Seq & {type: 'result'; tool?: string; status?: 'completed' | 'error'; output?: string; error?: string; title?: string; metadata?: Record<string, unknown>})
  /** Stops turn `gen`: its live calls settle to cancelled and its late events drop. */
  | {type: 'stop'; gen: number; at?: number}
  /** Opens a new turn: `gen`, or the next generation. */
  | {type: 'turn'; gen?: number}
  | {type: 'reset'};

type ToolCallsState = {calls: ToolCallData[]; gen: number; stopped?: boolean; dropped: number};

const emptyState: ToolCallsState = {calls: [], gen: 0, stopped: false, dropped: 0};
const NO_STATUS = 'The tool ended without reporting a result.';

const timeOf = (at: number | undefined) => typeof at === 'number' && Number.isFinite(at) ? at : Date.now();

function transition(call: ToolCallData, e: Exclude<ToolEvent, {type: 'stop' | 'reset' | 'turn'}>): ToolCallData {
  const at = timeOf(e.at);
  switch (e.type) {
    case 'call': return {...call, tool: e.tool, input: e.input ?? call.input, raw: e.raw ?? call.raw, status: 'pending'};
    case 'input': return {...call, raw: e.raw, input: e.input ?? call.input};
    case 'start': return {...call, tool: e.tool ?? call.tool, input: e.input ?? call.input, title: e.title ?? call.title, status: 'running', startedAt: call.startedAt ?? at};
    case 'progress': return {...call, metadata: {...call.metadata, ...e.metadata}, title: e.title ?? call.title, output: e.output ?? call.output, status: call.status === 'pending' ? 'running' : call.status, startedAt: call.startedAt ?? at};
    case 'ask': return {...call, status: 'awaiting-permission', permission: {patterns: e.patterns, message: e.message}};
    case 'reply': return e.reply === 'reject'
      ? {...call, status: 'denied', reason: e.feedback, endedAt: at}
      : {...call, status: 'running', startedAt: call.startedAt ?? at};
    case 'result': {
      const status = e.status ?? 'error';
      return {
        ...call, status, output: e.output ?? call.output, title: e.title ?? call.title,
        metadata: e.metadata ? {...call.metadata, ...e.metadata} : call.metadata,
        error: status === 'error' ? (e.error ?? (e.status ? 'The tool failed.' : NO_STATUS)) : undefined,
        endedAt: at,
      };
    }
  }
}

/** The one reducer every view uses: monotonic per call, terminal states absorb, results before calls are kept. */
function toolCallsReducer(state: ToolCallsState, e: ToolEvent): ToolCallsState {
  if (e.type === 'reset') return emptyState;
  const drop = {...state, dropped: state.dropped + 1};
  if (e.type === 'turn') return {...state, gen: e.gen ?? state.gen + 1, stopped: false};
  if (e.type === 'stop') {
    if (e.gen < state.gen || (e.gen === state.gen && state.stopped)) return drop;
    const at = timeOf(e.at);
    return {...state, gen: e.gen, stopped: true, calls: state.calls.map(c => isTerminal(c.status) ? c : {...c, status: 'cancelled', endedAt: at})};
  }
  const gen = e.gen ?? state.gen;
  if (gen < state.gen || (gen === state.gen && state.stopped)) return drop;
  if (gen > state.gen) state = {...state, gen, stopped: false};
  const i = state.calls.findIndex(c => c.id === e.id);

  if (i === -1) {
    const orphan = e.type === 'result' || e.type === 'ask' || e.type === 'reply' || e.type === 'progress';
    const seed: ToolCallData = {id: e.id, tool: ('tool' in e && e.tool) || 'unknown', status: 'pending', seq: e.seq, orphan, receivedAt: timeOf(e.at)};
    return {...state, calls: [...state.calls, {...transition(seed, e), seq: e.seq}]};
  }

  const call = state.calls[i];
  const replace = (next: ToolCallData) => ({...state, calls: state.calls.map((c, j) => (j === i ? next : c))});

  if (call.orphan && (e.type === 'call' || e.type === 'start')) {
    const filled = {...call, tool: call.tool === 'unknown' ? (e.tool ?? call.tool) : call.tool, input: call.input ?? e.input, orphan: false};
    return replace(isTerminal(call.status) || e.seq <= call.seq ? filled : {...transition(filled, e), seq: e.seq});
  }
  if (e.seq <= call.seq) return drop;
  if (isTerminal(call.status)) return drop;
  return replace({...transition(call, e), seq: e.seq});
}

/** The lifecycle as a hook: `[state, dispatch]`. */
function useToolCalls(initial: ToolCallData[] = []) {
  return useReducer(toolCallsReducer, {...emptyState, calls: initial});
}

// ---------- Registry ----------

type ToolRenderer = {
  /** The row's label, a verb and its object in sentence case: "Run query". */
  verb: string;
  /** The tab's -ing words while it runs: "Querying". */
  active: string;
  /** The noun in "Preparing <noun>" while the arguments stream, and in the approval's question. */
  noun: string;
  /** The approval's question. Default "Allow this <noun>?". */
  confirm?: (input: Record<string, unknown>) => string;
  /** What it acted on, as written: a table, a path, a URL. */
  detail?: (input: Record<string, unknown>, call: ToolCallData) => string | undefined;
  /** Output lines before "Show all". */
  lines: number;
};

const registry = new Map<string, ToolRenderer>();
const aliases = new Map<string, string>();

/** Adds or replaces a tool's words, with alias names that resolve to it. Call once at module scope. */
function registerTool(name: string, renderer: ToolRenderer, alias: string[] = []) {
  registry.set(name, renderer);
  for (const a of alias) aliases.set(a, name);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const firstOf = (input: Record<string, unknown>, keys: string[]) => keys.map(k => str(input[k])).find(Boolean);
const useful = ['table', 'path', 'uri', 'url', 'query', 'sql', 'command', 'job', 'pipeline', 'name', 'id'];
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function genericRenderer(tool: string): ToolRenderer {
  const words = tool.replace(/[._-]+/g, ' ').trim() || 'tool';
  return {verb: sentence(words), active: `Running ${words}`, noun: 'call', lines: 8, detail: input => firstOf(input, useful)};
}

/** The words for a tool name, through aliases, falling back to the generic ones. */
function resolveTool(name: string): ToolRenderer {
  return registry.get(aliases.get(name) ?? name) ?? genericRenderer(name);
}

registerTool('query', {verb: 'Run query', active: 'Querying', noun: 'query', lines: 8, detail: input => firstOf(input, ['table', 'sql', 'query'])?.replace(/\s+/g, ' ')}, ['sql', 'warehouse.query']);
registerTool('read', {verb: 'Read source', active: 'Reading', noun: 'read', lines: 8, detail: input => firstOf(input, ['uri', 'path', 'url'])}, ['read_file', 'fetch']);
registerTool('write', {verb: 'Write partitions', active: 'Writing', noun: 'write', lines: 8, confirm: input => `Write to ${str(input.table) ?? 'this table'}?`, detail: input => firstOf(input, ['table', 'path', 'uri'])}, ['write_partition', 'insert']);
registerTool('shell', {verb: 'Run command', active: 'Running', noun: 'command', lines: 24, confirm: () => 'Run this command?', detail: input => str(input.command)}, ['bash', 'sh', 'exec']);
registerTool('http', {verb: 'Call API', active: 'Calling', noun: 'request', lines: 8, detail: input => firstOf(input, ['url', 'path'])}, ['webfetch', 'request']);
registerTool('scale', {verb: 'Scale workers', active: 'Scaling', noun: 'change', lines: 8, confirm: input => `Scale ${str(input.pool) ?? 'the pool'} to ${String(input.workers ?? 'more')} workers?`, detail: input => firstOf(input, ['pool', 'name'])});

// ---------- Output ----------

// ANSI escapes never reach the screen. A lone \r overwrites the line from its start, so a progress bar reads as its
// last frame.
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const cleanOutput = (text: string) => text.replace(ansi, '').replace(/\r\n/g, '\n').split('\n')
  .map(line => line.split('\r').reduce((shown, part) => part + shown.slice(part.length), ''))
  .join('\n');
const MAX_CHARS = 20_000;

type ToolCallLabels = {
  showAll?: (hidden: number) => string;
  showLess?: string;
  cut?: (chars: number) => string;
  preparing?: (noun: string) => string;
  failed?: (verb: string) => string;
  denied?: string;
  stopped?: string;
  orphaned?: string;
  allow?: string;
  deny?: string;
  confirm?: (noun: string) => string;
  reason?: string;
};
const defaultLabels: Required<ToolCallLabels> = {
  showAll: hidden => `Show all, ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
  showLess: 'Show less',
  cut: chars => `Cut at ${new Intl.NumberFormat('en-US').format(chars)} characters.`,
  preparing: noun => `Preparing ${noun}`,
  failed: verb => `${verb.split(' ')[0]} failed`,
  denied: 'Denied',
  stopped: 'Stopped',
  orphaned: 'Orphaned result',
  allow: 'Allow',
  deny: 'Deny',
  confirm: noun => `Allow this ${noun}?`,
  reason: 'Reason',
};

function ToolOutput({text, lines, labels, tone = 'default'}: {text: string; lines: number; labels: Required<ToolCallLabels>; tone?: 'default' | 'fail'}) {
  const [all, setAll] = useState(false);
  const clean = cleanOutput(text);
  const cut = clean.length > MAX_CHARS;
  const body = cut ? clean.slice(0, MAX_CHARS) : clean;
  const rows = body.split('\n');
  const hidden = Math.max(0, rows.length - lines);
  const shown = all || !hidden ? body : rows.slice(0, lines).join('\n');
  return <div data-slot="tool-call-output" className="flex min-w-0 flex-col">
    <pre className={cn('max-h-(--popup-max) min-w-0 overflow-auto px-inset py-inset type-code-sm whitespace-pre-wrap break-words', tone === 'fail' ? 'text-fail-text' : 'bg-well text-text-1')}>{shown}</pre>
    {(hidden > 0 || cut) && <div className="flex min-w-0 items-center gap-3 border-t border-line-faint px-1 py-1">
      {hidden > 0 && <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? labels.showLess : labels.showAll(hidden)}</Button>}
      {cut && all && <span className="type-caption text-text-3">{labels.cut(MAX_CHARS)}</span>}
    </div>}
  </div>;
}

function Approval({call, renderer, onReply, actions, labels}: {call: ToolCallData; renderer: ToolRenderer; onReply?: (reply: ToolReply) => void; actions?: ReactNode; labels: Required<ToolCallLabels>}) {
  const question = renderer.confirm?.(call.input ?? {}) ?? labels.confirm(renderer.noun);
  const what = call.permission?.patterns.length ? call.permission.patterns : [str(call.input?.command) ?? renderer.detail?.(call.input ?? {}, call) ?? call.tool];
  return <div role="group" aria-label={question} data-slot="tool-call-approval" className="flex min-w-0 flex-col gap-3 p-inset">
    <div className="flex min-w-0 flex-col gap-1">
      <p className="type-body-sm text-text-1">{question}</p>
      {call.permission?.message && <p className="max-w-measure-hint type-caption text-text-2">{call.permission.message}</p>}
    </div>
    <pre className="min-w-0 overflow-auto bg-well px-3 py-2 type-code-sm whitespace-pre-wrap break-words text-text-1">{what.join('\n')}</pre>
    {(onReply || actions) && <div className="flex flex-wrap items-center justify-end gap-2">
      {onReply
        ? <>
            <Button size="sm" variant="secondary" onClick={() => onReply('reject')}>{labels.deny}</Button>
            <Button size="sm" onClick={() => onReply('once')}>{labels.allow}</Button>
          </>
        : actions}
    </div>}
  </div>;
}

// ---------- Views ----------

const rowState: Record<ToolStatus, StepState> = {
  'pending': 'running', 'running': 'running', 'completed': 'done', 'error': 'failed',
  'awaiting-permission': 'waiting', 'denied': 'stopped', 'cancelled': 'stopped',
};

type ToolCallProps = Omit<React.ComponentProps<typeof ToolCallRow>, 'label' | 'detail' | 'state' | 'tab' | 'word' | 'children'> & {
  call: ToolCallData;
  /** The person's answer to a waiting call: shows Deny and the one Allow. */
  onReply?: (reply: ToolReply) => void;
  /** Your own buttons on a waiting call, in place of Deny and Allow. onReply wins. */
  actions?: ReactNode;
  /** Overrides for one row. */
  label?: string;
  detail?: string;
  /** A custom body in place of the output. */
  children?: ReactNode;
  labels?: ToolCallLabels;
};

function ToolCall({call, onReply, actions, label, detail, children, labels: labelsProp, duration, defaultOpen, onOpenChange, ...props}: ToolCallProps) {
  const labels = {...defaultLabels, ...labelsProp};
  const renderer = resolveTool(call.tool);
  const input = call.input ?? {};
  const shownDetail = detail ?? renderer.detail?.(input, call) ?? call.title;
  // An orphaned result is never shown as a success: it takes the quiet stopped look with its own word.
  const state = call.orphan ? (isTerminal(call.status) ? 'stopped' : 'running') : rowState[call.status];
  const time = duration ?? (call.startedAt !== undefined && call.endedAt !== undefined ? call.endedAt - call.startedAt : undefined);

  const tab = call.status === 'pending' ? labels.preparing(renderer.noun)
    : call.status === 'running' ? renderer.active
    : call.status === 'error' ? labels.failed(renderer.verb)
    : undefined;
  const word = call.orphan ? labels.orphaned : call.status === 'denied' ? labels.denied : call.status === 'cancelled' ? labels.stopped : undefined;

  const body = children ?? (
    call.status === 'awaiting-permission' ? <Approval call={call} renderer={renderer} onReply={onReply} actions={actions} labels={labels}/>
    : call.status === 'error' ? <ToolOutput text={call.error ?? NO_STATUS} lines={renderer.lines} labels={labels} tone="fail"/>
    : call.status === 'denied' && call.reason ? <p className="px-inset py-inset type-body-sm text-text-2"><span className="type-label-sm text-text-3">{labels.reason}</span> {call.reason}</p>
    : call.output ? <ToolOutput text={call.output} lines={renderer.lines} labels={labels}/>
    : undefined
  );
  // A failure and a question open the moment they arrive, even on a row that was closed: they are what the person has to
  // read. Set while rendering, so the row never paints one frame closed.
  const urgent = call.status === 'error' || call.status === 'awaiting-permission';
  const [open, setOpen] = useState(defaultOpen ?? urgent);
  const [opened, setOpened] = useState(urgent);
  if (urgent && !opened) { setOpened(true); setOpen(true); }

  return <ToolCallRow
    data-tool={call.tool}
    data-status={call.status}
    label={label ?? renderer.verb}
    detail={shownDetail}
    state={state}
    tab={tab}
    word={word}
    duration={time}
    open={open}
    onOpenChange={next => { setOpen(next); onOpenChange?.(next); }}
    {...props}
  >{body}</ToolCallRow>;
}

/** Holds a result that came before its call for `ttl` ms, in case the call is only late. */
function useOrphanGate(calls: readonly ToolCallData[], ttl: number) {
  const [, force] = useState(0);
  const young = calls.filter(c => c.orphan && c.receivedAt !== undefined && Date.now() - c.receivedAt < ttl);
  useEffect(() => {
    if (!young.length) return;
    const next = Math.min(...young.map(c => ttl - (Date.now() - c.receivedAt!)));
    const t = setTimeout(() => force(n => n + 1), Math.max(0, next) + 10);
    return () => clearTimeout(t);
  });
  return calls.filter(c => !young.includes(c));
}

type ToolCallListProps = Omit<React.ComponentProps<typeof ToolCallStack>, 'children'> & {
  calls: readonly ToolCallData[];
  /** Hides completed calls. Running, waiting and failed calls always show. */
  hideCompleted?: boolean;
  /** ms a result that came before its call waits before it shows as orphaned. */
  orphanTtl?: number;
  onReply?: (call: ToolCallData, reply: ToolReply) => void;
  actions?: (call: ToolCallData) => ReactNode;
  labels?: ToolCallLabels;
};

/** A run's calls as one Sodium stack, in order, the connectors drawing as calls arrive. */
function ToolCallList({calls, hideCompleted = false, orphanTtl = 2000, onReply, actions, labels, ...props}: ToolCallListProps) {
  const ready = useOrphanGate(calls, orphanTtl);
  const visible = hideCompleted ? ready.filter(c => c.status !== 'completed') : ready;
  return <ToolCallStack data-slot="tool-call-list" {...props}>
    {visible.map(call => <ToolCall
      key={call.id}
      call={call}
      labels={labels}
      onReply={onReply ? reply => onReply(call, reply) : undefined}
      actions={actions?.(call)}
    />)}
  </ToolCallStack>;
}

export {
  ToolCall, ToolCallList, toolCallsReducer, useToolCalls, registerTool, resolveTool, isTerminal, cleanOutput,
  type ToolCallData, type ToolCallLabels, type ToolCallListProps, type ToolCallProps, type ToolCallsState, type ToolEvent, type ToolRenderer, type ToolReply, type ToolStatus,
};
