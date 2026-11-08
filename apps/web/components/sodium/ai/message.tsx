'use client';

import type {ReactNode} from 'react';
import {Button} from '@/components/sodium/ui/button';
import {cn} from '@/lib/sodium/utils';

// One turn of a run's thread: what a person told the agent, or what the agent did and said back. Sodium reads it as a
// log, not a chat. Turns are rows divided by faint rules, each with a label column (who, when, and the turn's state as
// a word) and the turn beside it; in a turn narrower than 512px the label column folds into one line above it.
//
// - The person's turn is an instruction: their words as written, in the sans, behind a mono > like a shell prompt. No
//   bubble and no fill, because nothing in Sodium is a box of text.
// - The agent's turn is flow at the full width of its column: an Activity line, a ToolCallList, the answer as a
//   Response, in that order, every part optional, then a footer for its actions.
// - The state word sits in the label column: Working behind the pending mark, Waiting on you in orange, Failed in red,
//   Stopped in text-3. A finished turn says nothing, because done is the normal end.
// - A person's turn that did not send keeps its text, says Not sent in red and offers Retry; one sending shows the
//   pending mark and Sending.
// - MessageDivider marks a point in the thread (a run starting, the context compacted, a handoff): a micro label at
//   the start and a rule to the end.
//
// The thread is a ruled list on the page, not a frame: a ToolCallList inside a turn draws its own boxes, and Sodium
// never puts a box in a box.

type MessageState = 'done' | 'running' | 'waiting' | 'failed' | 'stopped' | 'sending' | 'not-sent';

type MessageLabels = {running?: string; waiting?: string; failed?: string; stopped?: string; sending?: string; notSent?: string; retry?: string};
const defaultLabels: Required<MessageLabels> = {running: 'Working', waiting: 'Waiting on you', failed: 'Failed', stopped: 'Stopped', sending: 'Sending', notSent: 'Not sent', retry: 'Retry'};

const stateTone: Record<MessageState, string> = {
  done: '', running: 'text-text-1', waiting: 'text-warn-text', failed: 'text-fail-text', stopped: 'text-text-3', sending: 'text-text-2', 'not-sent': 'text-fail-text',
};
const stateWord = (state: MessageState, labels: Required<MessageLabels>) => state === 'done' ? '' : state === 'not-sent' ? labels.notSent : labels[state];

/** The thread: turns in order, divided by faint rules. */
function MessageGroup({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="message-group" className={cn('flex min-w-0 flex-col', className)} {...props}/>;
}

type MessageProps = Omit<React.ComponentProps<'article'>, 'title'> & {
  from?: 'agent' | 'person';
  /** Who: the agent's name or the person's. A name, so it is a mono label. */
  name: string;
  /** When, as written: 02:14:09 or Oct 18. A <time> is best. */
  time?: ReactNode;
  state?: MessageState;
  /** The actions under an agent's turn: copy, replay. Ghost buttons, at most one secondary. */
  footer?: ReactNode;
  /** Retries a person's turn that did not send. */
  onRetry?: () => void;
  labels?: MessageLabels;
};

function Message({from = 'agent', name, time, state = 'done', footer, onRetry, labels: labelsProp, className, children, ...props}: MessageProps) {
  const labels = {...defaultLabels, ...labelsProp};
  const word = stateWord(state, labels);
  const person = from === 'person';
  return <article
    data-slot="message"
    data-from={from}
    data-state={state}
    aria-busy={state === 'running' || state === 'sending' || undefined}
    className={cn('@container min-w-0 py-4 rule-row', className)}
    {...props}
  >
    {/* The label column folds by the turn's own width, not the window's, so a thread in a narrow panel reads too. */}
    <div className="grid min-w-0 gap-x-6 gap-y-2 @lg:grid-cols-[var(--label-col)_minmax(0,1fr)]">
    <header data-slot="message-header" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @lg:flex-col @lg:items-start @lg:pt-1">
      <h3 className="min-w-0 truncate type-label-sm text-text-2">{name}</h3>
      {time !== undefined && <span data-slot="message-time" className="type-code-sm text-text-3">{time}</span>}
      {word && <span data-slot="message-state" className={cn('flex items-center gap-2 type-label-sm', stateTone[state])}>
        {(state === 'running' || state === 'sending') && <span aria-hidden className="pending"/>}
        {word}
      </span>}
    </header>
    <div data-slot="message-content" className={cn('flex min-w-0 flex-col gap-3', person && 'flex-row gap-2')}>
      {person && <span aria-hidden className="type-code leading-6 text-text-3">&gt;</span>}
      {person
        ? <div className="min-w-0 type-body break-words whitespace-pre-wrap text-text-1">{children}</div>
        : children}
    </div>
    {(footer || (state === 'not-sent' && onRetry)) && <footer data-slot="message-footer" className="flex min-w-0 flex-wrap items-center gap-1 @lg:col-start-2">
      {state === 'not-sent' && onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>{labels.retry}</Button>}
      {footer}
    </footer>}
    </div>
  </article>;
}

type MessageDividerProps = React.ComponentProps<'div'> & {
  /** What happened at this point, as a short name: Run 4812 started, Context compacted. */
  children: ReactNode;
};

/** A point in the thread: a micro label at the start, then a rule to the end. */
function MessageDivider({className, children, ...props}: MessageDividerProps) {
  return <div data-slot="message-divider" className={cn('flex min-w-0 items-center gap-3 py-3', className)} {...props}>
    <span className="min-w-0 shrink truncate type-micro text-text-3">{children}</span>
    <span aria-hidden className="h-0 grow border-t border-line"/>
  </div>;
}

export {Message, MessageGroup, MessageDivider, type MessageLabels, type MessageProps, type MessageState};
