"use client";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LinkButton, StudioSkeleton } from "@/components/ui";

const SwarmStudio = dynamic(() => import("@/components/SwarmStudio"), { ssr: false, loading: () => <StudioSkeleton /> });

function StudioInner({ id }: { id: string }) {
  const search = useSearchParams();
  const prompt = search.get("prompt") ?? undefined;
  return <SwarmStudio runId={id} autoPrompt={prompt} />;
}

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-measure flex-col gap-2">
          <h1 className="type-title">Studio analyst</h1>
          <p className="type-body-sm text-text-2">AG Studio over the run&apos;s event log: orders, findings, webhooks and agent turns. Ask the analyst to build widgets that expose failures. Its tokens count against the same run budget.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/runs/${id}`}>Arena</LinkButton>
          <LinkButton href={`/runs/${id}/report`}>Report</LinkButton>
        </div>
      </div>
      <Suspense fallback={<StudioSkeleton />}>
        <StudioInner id={id} />
      </Suspense>
    </>
  );
}
