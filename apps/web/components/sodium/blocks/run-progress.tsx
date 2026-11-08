'use client';

import {ToolCallRow, ToolCallStack, formatElapsed} from '@/components/sodium/ai/tool-call-row';
import {Button} from '@/components/sodium/ui/button';
import {Frame, FrameBody, FrameFooter, FrameHeader, FrameMeta, FrameStatus, FrameTitle, FrameValue} from '@/components/sodium/ui/frame';
import {Progress, ProgressLabel, ProgressValue} from '@/components/sodium/ui/progress';
import {Status} from '@/components/sodium/ui/status';
import {StatusStrip, StatusStripCell, StatusStripLabel, StatusStripUnit, StatusStripValue} from '@/components/sodium/ui/status-strip';

// A block: a backfill followed from a phone, at phone width with no device frame. One frame: the header names the
// pipeline and carries its state (sessions-rollup, then Running and the time it has run at the end), so the body starts
// with the partitions done as a progress bar, then the run's numbers as a plain strip of two columns in a second body,
// which the frame rules off, then the run id and Pause run in the footer, the view's one yellow slab: on a run in
// progress, pausing it is the one thing to do. The live step is the running row of the steps, which follow as a small
// stack under the frame, because each step is its own box and a frame around them would box them twice. Wire it to the
// run's events; pass `clock` for a still picture.

const steps = [
  {label: 'Read source', detail: 'raw.sessions', state: 'done', duration: 4100},
  {label: 'Dedupe rows', detail: '1.2M rows', state: 'done', duration: 38_000},
  {label: 'Write partitions', detail: 'wh.sessions_daily', state: 'running', tab: 'Writing partitions'},
  {label: 'Compact files', state: 'queued'},
] as const;

/** A running backfill at phone width: the live step, its progress, its numbers and its steps. */
export function RunProgress({className, clock}: {className?: string; clock?: number}) {
  return (
    <div className={className ?? 'flex w-full max-w-sm flex-col gap-4'}>
      <Frame aria-label="Backfill run_91c0d4">
        <FrameHeader>
          <FrameTitle>sessions-rollup</FrameTitle>
          <FrameStatus><Status status="running" size="sm"/></FrameStatus>
          <FrameValue meta>{formatElapsed(372_000)}</FrameValue>
        </FrameHeader>
        <FrameBody>
          <Progress value={812} max={1240}>
            <ProgressLabel>Partitions</ProgressLabel>
            <ProgressValue>{(_, v) => `${v} / 1,240`}</ProgressValue>
          </Progress>
        </FrameBody>
        <FrameBody padding="none">
          <StatusStrip variant="plain" label="Run status">
            <StatusStripCell>
              <StatusStripLabel>Rows</StatusStripLabel>
              <StatusStripValue>48.2M</StatusStripValue>
            </StatusStripCell>
            <StatusStripCell>
              <StatusStripLabel>Workers</StatusStripLabel>
              <StatusStripValue>12<StatusStripUnit>/ 16</StatusStripUnit></StatusStripValue>
            </StatusStripCell>
            <StatusStripCell>
              <StatusStripLabel>Failed</StatusStripLabel>
              <StatusStripValue>0</StatusStripValue>
            </StatusStripCell>
            <StatusStripCell>
              <StatusStripLabel>Left</StatusStripLabel>
              <StatusStripValue>about 4m</StatusStripValue>
            </StatusStripCell>
          </StatusStrip>
        </FrameBody>
        <FrameFooter>
          <FrameMeta>run_91c0d4</FrameMeta>
          <Button size="sm">Pause run</Button>
        </FrameFooter>
      </Frame>
      <ToolCallStack size="sm" aria-label="Steps of run_91c0d4" clock={clock}>
        {steps.map(step => <ToolCallRow key={step.label} {...step}/>)}
      </ToolCallStack>
    </div>
  );
}
