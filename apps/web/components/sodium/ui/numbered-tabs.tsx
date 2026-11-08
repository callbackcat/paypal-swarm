'use client';

import {Children, cloneElement, createContext, isValidElement, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode} from 'react';
import {Tabs as TabsPrimitive} from '@base-ui/react/tabs';
import {cn, mergeClass, mergeRefs} from '@/lib/sodium/utils';
import {tabBase, useActiveInView} from '@/components/sodium/ui/tabs';

// Sodium's numbered tabs: the few sections of one page, each led by its index in brackets, [01] INGEST [02] TRANSFORM.
// The index is a mono label that reads as a step in an order, so the row says how many there are and where you are in
// them. It is the one tab row that takes the brand: the selected tab's index turns accent text (dark gold in light,
// yellow in dark) and a 2px sodium bar runs under the tab on the list's rule. In light the bar is decoration beside
// the gold index, never the only cue; the label turns text-1 too.
//
// Built on Base UI Tabs and drawn like Tabs (one rule under the row, the selection a cut), 40px tall, the height of a
// row, since numbered tabs head a page or a frame rather than sit in a toolbar; 32 small. The index counts from 01 in
// the order the triggers are written, or takes `index` for a row that starts later.

type Size = 'sm' | 'default';
const ListContext = createContext<{size: Size}>({size: 'default'});

function NumberedTabs({className, ...props}: Omit<TabsPrimitive.Root.Props, 'orientation'>) {
  return <TabsPrimitive.Root data-slot="numbered-tabs" className={mergeClass('flex max-w-full min-w-0 flex-col gap-4', className)} {...props}/>;
}

type NumberedTabsListProps = TabsPrimitive.List.Props & {size?: Size};

/** The row. Numbers its triggers in written order unless one carries its own index; it holds only triggers. */
function NumberedTabsList({className, size = 'default', children, ref, ...props}: NumberedTabsListProps) {
  const list = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => mergeRefs(list, ref), [ref]);
  useActiveInView(list, 'numbered-tabs-trigger');
  const ctx = useMemo(() => ({size}), [size]);
  let n = 0;
  const numbered = Children.map(children as ReactNode, child => {
    // Every element in the list is a trigger. Its type cannot be compared: a trigger written in a server component
    // arrives here as a client reference, not this function.
    if (!isValidElement(child)) return child;
    n += 1;
    const el = child as ReactElement<NumberedTabsTriggerProps>;
    return el.props.index === undefined ? cloneElement(el, {index: n}) : el;
  });
  return <ListContext.Provider value={ctx}>
    <TabsPrimitive.List
      ref={refs}
      data-slot="numbered-tabs-list"
      data-size={size}
      className={mergeClass('relative flex w-full max-w-full min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden after:min-w-0 after:flex-1 after:border-b after:border-line', className)}
      {...props}
    >{numbered}</TabsPrimitive.List>
  </ListContext.Provider>;
}

type NumberedTabsTriggerProps = TabsPrimitive.Tab.Props & {
  /** The number shown in brackets, from 1. Set by the list in written order; pass it to start elsewhere. */
  index?: number;
};

const sizes: Record<Size, string> = {
  sm: 'h-[max(var(--control),calc(1lh+var(--space-2)))] px-3 type-label-sm',
  default: 'h-[max(var(--row),calc(1lh+var(--space-2)))] px-3 type-label',
};

function NumberedTabsTrigger({className, index = 1, children, ...props}: NumberedTabsTriggerProps) {
  const {size} = useContext(ListContext);
  return <TabsPrimitive.Tab
    data-slot="numbered-tabs-trigger"
    className={mergeClass([tabBase, sizes[size], 'data-active:after:bg-accent-fill'], className)}
    {...props}
  >
    {/* The index: a step number, read as part of the tab's name ("01 Ingest"), drawn in brackets. */}
    <span data-slot="numbered-tabs-index" className="bracketed data text-text-3 in-data-active:text-accent-text in-data-disabled:text-text-disabled">{String(index).padStart(2, '0')}</span>
    <span className="min-w-0">{children}</span>
  </TabsPrimitive.Tab>;
}

/** A tab's panel. It stays mounted while hidden, so a chart in it draws once and keeps its state, rather than replaying
 *  its entrance every time the tab is chosen again. Pass keepMounted={false} for a panel too heavy to keep. */
function NumberedTabsContent({className, keepMounted = true, ...props}: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel
    keepMounted={keepMounted}
    data-slot="numbered-tabs-content"
    className={mergeClass('min-w-0 flex-1 type-body-sm text-text-1 focus-visible:focus-ring-inset', className)}
    {...props}
  />;
}

/** Wraps the panels so the frame eases to the next panel's height over --dur-wipe instead of jumping. The panels sit in
 *  an inner box it watches; the outer box takes that height and clips while it moves. Reduced motion zeroes the
 *  duration, so the height changes at once. */
function NumberedTabsPanels({className, children, ...props}: React.ComponentProps<'div'>) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div
    data-slot="numbered-tabs-panels"
    className={cn('min-w-0 overflow-hidden transition-[height] duration-(--dur-wipe) ease-out', className)}
    style={{height}}
    {...props}
  >
    <div ref={inner}>{children}</div>
  </div>;
}

export {NumberedTabs, NumberedTabsList, NumberedTabsTrigger, NumberedTabsContent, NumberedTabsPanels, type NumberedTabsTriggerProps};
