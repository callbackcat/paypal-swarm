'use client';

import {Icon, Play, Renew, Search} from '@/components/sodium/icon';
import {cn} from '@/lib/sodium/utils';
import {Button} from '@/components/sodium/ui/button';
import {Status, type StatusValue} from '@/components/sodium/ui/status';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/sodium/ui/table';

// A block: the runs of every pipeline, the screen a data tool opens on. One table, a Status word in every row and IDs
// and numbers in mono. The table measures its own width: the pipeline column drops under 32rem and the rows column
// under 20rem, so it never scrolls sideways in a narrow slot and every column keeps its 12px gap and the 12px inset. Six runs fit on one
// screen, so there is no filter bar and no pager; once the runs run past a screen, add FilterBar as the table's toolbar
// (filter-bar-long-lists). The head row names the table and counts it, then three quiet icon buttons in the header
// order: search (open or focus your search), refresh, then run now. The open row is the run the page beside it shows.
// Wire `runs` to your scheduler and the three buttons to your handlers.

type Run = {id: string; pipeline: string; status: StatusValue; rows: string};

const runs: Run[] = [
  {id: 'run_8f2a91', pipeline: 'ingest-events', status: 'running', rows: '812K'},
  {id: 'run_8f2a90', pipeline: 'orders-daily', status: 'fail', rows: '48.2K'},
  {id: 'run_8f2a8e', pipeline: 'sessions-rollup', status: 'ok', rows: '1.2M'},
  {id: 'run_8f2a8c', pipeline: 'ingest-events', status: 'ok', rows: '790K'},
  {id: 'run_8f2a8b', pipeline: 'billing-export', status: 'warn', rows: '6.9K'},
  {id: 'run_8f2a8a', pipeline: 'orders-daily', status: 'queued', rows: '0'},
];

/** The runs table with its Status cells and its search, refresh and run now buttons. */
export function JobRuns({className}: {className?: string}) {
  return (
    <Table
      frameClassName={cn('@container/runs', className ?? 'w-full')}
      size="sm"
      title="Runs"
      count={runs.length}
      actions={<>
        <Button variant="ghost" size="icon-sm" aria-label="Search runs"><Icon icon={Search}/></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh"><Icon icon={Renew}/></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Run now"><Icon icon={Play}/></Button>
      </>}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead className="hidden @lg/runs:table-cell">Pipeline</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric className="hidden @xs/runs:table-cell">Rows</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map(run => <TableRow key={run.id} open={run.id === 'run_8f2a90'}>
          <TableCell mono>{run.id}</TableCell>
          <TableCell mono className="hidden @lg/runs:table-cell">{run.pipeline}</TableCell>
          <TableCell><Status status={run.status} size="sm"/></TableCell>
          <TableCell numeric className="hidden @xs/runs:table-cell">{run.rows}</TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  );
}
