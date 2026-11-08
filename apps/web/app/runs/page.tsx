"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtTokens, fmtUsd, type RunListItem } from "@/lib/api";
import { ErrorAlert, LinkButton, ModeTags, RunStatus } from "@/components/ui";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableLoading, TableRow } from "@/components/sodium/ui/table";

const COLUMNS = 9;

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const load = () =>
      api
        .listRuns()
        .then((r) => {
          setRuns(r.runs);
          setError(null);
        })
        .catch((e) => {
          setError(e);
          setRuns((prev) => prev ?? []);
        });
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="type-title">Runs</h1>
        <LinkButton href="/" variant="primary">
          New run
        </LinkButton>
      </div>
      <ErrorAlert error={error} />
      <Table title="Runs" count={runs?.length ?? undefined} aria-busy={runs === null}>
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Scenario</TableHead>
            <TableHead>Merchant</TableHead>
            <TableHead className="hidden lg:table-cell">Modes</TableHead>
            <TableHead>Status</TableHead>
            <TableHead numeric>Score</TableHead>
            <TableHead numeric className="hidden lg:table-cell">Tokens</TableHead>
            <TableHead numeric className="hidden lg:table-cell">Cost</TableHead>
            <TableHead className="hidden lg:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs === null ? (
            <TableLoading columns={COLUMNS} />
          ) : runs.length === 0 ? (
            error ? (
            <TableEmpty colSpan={COLUMNS} reason="error" title="Runs could not be loaded" description="The message above says why. This list refreshes on its own once the api answers." />
          ) : (
            <TableEmpty colSpan={COLUMNS} title="No runs yet" description="Release the first swarm from Setup." />
          )
          ) : (
            runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <Link href={`/runs/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                    <span className="type-code-sm text-text-3">{r.id}</span>
                  </div>
                </TableCell>
                <TableCell mono>{r.scenario}</TableCell>
                <TableCell>{r.merchantProfile}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  <ModeTags modes={r.score?.modes ?? null} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <RunStatus status={r.status} />
                    <Link href={`/runs/${r.id}/report`} className="type-label-sm text-text-2 hover:text-text-1">
                      Report
                    </Link>
                    <Link href={`/runs/${r.id}/studio`} className="type-label-sm text-text-2 hover:text-text-1">
                      Studio
                    </Link>
                  </div>
                </TableCell>
                <TableCell numeric>{r.score?.score ? `${r.score.score.overall} ${r.score.score.grade}` : "None"}</TableCell>
                <TableCell numeric className="hidden lg:table-cell">{fmtTokens(r.tokensIn + r.tokensOut)}</TableCell>
                <TableCell numeric className="hidden lg:table-cell">{fmtUsd(r.costUsd, 3)}</TableCell>
                <TableCell mono className="hidden lg:table-cell">{new Date(r.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
