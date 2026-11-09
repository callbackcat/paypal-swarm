'use client';

import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref} from 'react';
import {Icon, Add} from '@/components/sodium/icon';
import {Button} from '@/components/sodium/ui/button';
import {cn, mergeRefs} from '@/lib/sodium/utils';

// Where a person writes the next instruction for an agent working on their pipelines.
//
// One field, square, in the field's light (styles.css, field-surface): the secondary's hair-off-white body and a 1px
// --line edge at rest, lifted toward white under the pointer, and white with the --focus edge doubled inward and a pale
// yellow halo while the cursor is in it, so the box never grows. Two layouts:
// - stacked (the default): the text on top, two lines tall and growing to ten, then a footer row behind a faint rule:
//   attach, your tools (the target pipeline, a mode), a key hint, and Send.
// - inline: one row. Attach, the text growing upward as it wraps, Send.
// Send is the composer's one primary: a small Button (the slab, lit from below, with its halo), never restyled. Every
// control in the composer is 26px and sits --space-1-5 (6px) inside the edge, so Send is as far from the end and bottom
// edges as Attach is from the start and bottom, and the controls share one centre line. The text starts on Attach's
// glyph ink, and its capitals sit as far under the top edge as that. Attach is a ghost icon
// button, so the composer never shows two primaries.
//
// While the agent works, Send turns into Stop, a secondary. Neither carries a glyph, because a labeled button never
// does. Stopping is not what the screen pushes the person toward, and it loses nothing. Enter with text while it works still sends, so the product can queue it.
//
// - Enter sends, Shift+Enter breaks the line, and nothing fires while an IME is composing (isComposing, or keyCode 229
//   which WebKit sends after compositionend).
// - Escape stops the run when one is going, and does nothing else, so a parent dialog stays open otherwise.
// - An empty prompt or one of only spaces never sends.
// - A message that failed to send keeps its text, the edge turns red, and the error sits in the footer as a sentence.
// - It is a textarea, controlled through value and onValueChange or left uncontrolled with defaultValue, and cleared
//   after a send when uncontrolled.

type PromptStatus = 'ready' | 'submitted' | 'streaming' | 'error';

type PromptInputLabels = {send?: string; stop?: string; attach?: string; hint?: string; label?: string};
const defaultLabels: Required<PromptInputLabels> = {send: 'Send', stop: 'Stop', attach: 'Add a file', hint: 'Enter to send', label: 'Message the agent'};

type PromptInputProps = Omit<React.ComponentProps<'div'>, 'onSubmit' | 'defaultValue' | 'ref'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Fires with the trimmed text on Enter or Send. */
  onSubmit?: (text: string) => void;
  /** ready, or the run's state: submitted and streaming turn Send into Stop; error keeps the text and turns the edge red. */
  status?: PromptStatus;
  /** Stops the run. Without it, Stop is not shown. */
  onStop?: () => void;
  /** Shows the attach button and fires when it is pressed. */
  onAttach?: () => void;
  layout?: 'stacked' | 'inline';
  placeholder?: string;
  /** The sentence under a failed send. */
  error?: string;
  disabled?: boolean;
  /** Your controls between attach and the hint: a target, a mode. */
  tools?: ReactNode;
  /** Lines at rest, and before it scrolls. Default 2 and 10 stacked, 1 and 6 inline. */
  minRows?: number;
  maxRows?: number;
  labels?: PromptInputLabels;
  /** The textarea. */
  ref?: Ref<HTMLTextAreaElement>;
  /** Forces the field's focus look, for a docs specimen. */
  forceFocus?: boolean;
};

const supportsFieldSizing = () => typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function PromptInput({
  value: valueProp, defaultValue = '', onValueChange, onSubmit, status = 'ready', onStop, onAttach, layout = 'stacked',
  placeholder, error, disabled = false, tools, minRows, maxRows, labels: labelsProp, ref, forceFocus, className, ...props
}: PromptInputProps) {
  const labels = {...defaultLabels, ...labelsProp};
  const area = useRef<HTMLTextAreaElement>(null);
  const setRef = useMemo(() => mergeRefs(area, ref), [ref]);
  const errorId = useId();
  const [own, setOwn] = useState(defaultValue);
  const value = valueProp ?? own;
  const [fallback, setFallback] = useState(false);
  const inline = layout === 'inline';
  const rows = {min: minRows ?? (inline ? 1 : 2), max: maxRows ?? (inline ? 6 : 10)};
  const working = status === 'submitted' || status === 'streaming';
  const failed = status === 'error' || !!error;
  const canSend = !disabled && value.trim().length > 0;

  useEffect(() => { setFallback(!supportsFieldSizing()); }, []);
  // Without field-sizing, grow by measuring: reset to auto, then take the content's height, within the max.
  useIsoLayoutEffect(() => {
    const el = area.current;
    if (!fallback || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });

  const setValue = (next: string) => { if (valueProp === undefined) setOwn(next); onValueChange?.(next); };
  const send = () => {
    if (!canSend) return;
    onSubmit?.(value.trim());
    if (valueProp === undefined) setOwn('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape' && working && onStop) { e.preventDefault(); onStop(); }
  };

  const attach = onAttach && <Button size="icon-sm" variant="ghost" aria-label={labels.attach} disabled={disabled} onClick={onAttach}><Icon icon={Add}/></Button>;
  // Send and Stop are ordinary small Buttons inside the edge, on the controls' 6px inset, never cells over it.
  const action = working && onStop
    ? <Button data-slot="prompt-input-stop" size="sm" variant="secondary" className="shrink-0" onClick={onStop}>{labels.stop}</Button>
    : <Button data-slot="prompt-input-send" size="sm" type="submit" className="shrink-0" disabled={!canSend} focusableWhenDisabled>{labels.send}</Button>;

  const textarea = <textarea
    ref={setRef}
    data-slot="prompt-input-text"
    data-control=""
    rows={rows.min}
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    aria-label={labels.label}
    aria-invalid={failed || undefined}
    aria-describedby={error ? errorId : undefined}
    onChange={e => setValue(e.target.value)}
    onKeyDown={onKeyDown}
    style={{'--min-rows': rows.min, '--max-rows': rows.max} as CSSProperties}
    className={cn(
      'block w-full min-w-0 resize-none bg-transparent type-body-sm text-text-1 placeholder:text-text-3 disabled:cursor-not-allowed disabled:text-text-disabled',
      'field-sizing-content min-h-[calc(var(--min-rows)*1lh)] max-h-[calc(var(--max-rows)*1lh)] [contain:inline-size]',
      // Stacked: the text starts over Attach's glyph ink, and 8px under the edge puts its capitals about as far from
      // the top as its first glyph is from the side (measured: 14.3 and 14.5px).
      inline ? 'py-0.5' : 'px-(--prompt-text-x) pt-2',
    )}
  />;

  return <form
    data-slot="prompt-input"
    data-layout={layout}
    data-status={status}
    data-force-focus={forceFocus || undefined}
    aria-busy={status === 'submitted' || undefined}
    onSubmit={e => { e.preventDefault(); send(); }}
    className={cn(
      // The field's states; aria-invalid on the text gives the failure edge and halo, a disabled text the flat well.
      'field-surface flex min-w-0 cursor-text',
      // The + glyph's ink starts 2px inside its 16px box, so the text starts on the ink, not the box.
      '[--prompt-text-x:calc(var(--space-1-5)+(var(--control-sm)-var(--icon))/2+var(--space-0-5))]',
      inline ? 'items-end gap-2 p-1.5' : 'flex-col',
      className,
    )}
    {...(props as React.ComponentProps<'form'>)}
  >
    {inline
      ? <>
          {/* With no Attach, the text starts on the glyph's inset all the same. */}
          {attach ?? <span className="w-[calc(var(--prompt-text-x)-var(--space-1-5)-var(--space-2))] shrink-0"/>}
          {/* One line is the controls' height, so the first line shares their centre line. */}
          <div className="flex min-h-(--control-sm) min-w-0 grow items-center">{textarea}</div>
          {action}
        </>
      : <>
          {textarea}
          <div data-slot="prompt-input-footer" className="flex min-w-0 items-center gap-2 p-1.5">
            {attach}
            {tools && <div data-slot="prompt-input-tools" className="flex min-w-0 items-center gap-2">{tools}</div>}
            <span className="me-auto"/>
            {error
              ? <p id={errorId} className="min-w-0 truncate type-caption text-fail-text">{error}</p>
              : <span aria-hidden className="hidden truncate type-micro text-text-3 sm:block">{labels.hint}</span>}
            {action}
          </div>
        </>}
    {inline && error && <p id={errorId} className="sr-only">{error}</p>}
  </form>;
}

export {PromptInput, type PromptInputLabels, type PromptInputProps, type PromptStatus};
