"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtTokens, fmtUsd, type RunListItem } from "@/lib/api";
import { ErrorBox, ModeBadges, StatusChip } from "@/components/ui";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const load = () => api.listRuns().then((r) => setRuns(r.runs)).catch(setError);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <Link href="/" className="btn btn-primary">
          New run
        </Link>
      </div>
      <ErrorBox error={error} />
      <div className="panel overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Run</th>
              <th>Scenario</th>
              <th>Merchant</th>
              <th>Modes</th>
              <th>Status</th>
              <th>Score</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/runs/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                  <div className="mono muted text-[11px]">{r.id}</div>
                </td>
                <td>{r.scenario}</td>
                <td>{r.merchantProfile}</td>
                <td>
                  <ModeBadges modes={r.score?.modes ?? null} compact />
                </td>
                <td>
                  <StatusChip status={r.status} />
                </td>
                <td className="mono">{r.score?.score ? `${r.score.score.overall} (${r.score.score.grade})` : "–"}</td>
                <td className="mono">{fmtTokens(r.tokensIn + r.tokensOut)}</td>
                <td className="mono">{fmtUsd(r.costUsd, 3)}</td>
                <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/runs/${r.id}/report`} className="muted text-xs hover:text-white">
                    report
                  </Link>
                  {" · "}
                  <Link href={`/runs/${r.id}/studio`} className="muted text-xs hover:text-white">
                    studio
                  </Link>
                </td>
              </tr>
            ))}
            {runs && runs.length === 0 && (
              <tr>
                <td colSpan={10} className="muted py-6 text-center">
                  No runs yet. Start one from Setup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
