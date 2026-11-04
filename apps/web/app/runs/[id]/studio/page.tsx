"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Empty } from "@/components/ui";

const SwarmStudio = dynamic(() => import("@/components/SwarmStudio"), { ssr: false, loading: () => <Empty>Loading AG Studio…</Empty> });

function StudioInner({ id }: { id: string }) {
  const search = useSearchParams();
  const prompt = search.get("prompt") ?? undefined;
  return <SwarmStudio runId={id} autoPrompt={prompt} />;
}

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Studio analyst</h1>
          <div className="muted text-xs">
            AG Studio over the run's event log: orders, findings, webhooks, agent turns. Ask the analyst to build widgets that expose failures. Its tokens count against the same run budget.
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/runs/${id}`} className="btn">
            Arena
          </Link>
          <Link href={`/runs/${id}/report`} className="btn">
            Report
          </Link>
        </div>
      </header>
      <Suspense fallback={<Empty>Loading…</Empty>}>
        <StudioInner id={id} />
      </Suspense>
    </div>
  );
}
