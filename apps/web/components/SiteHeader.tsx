"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/sodium/utils";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

const NAV = [
  { href: "/", label: "Setup", match: (p: string) => p === "/" },
  { href: "/runs", label: "Runs", match: (p: string) => p.startsWith("/runs") },
] as const;

/** The app bar: the product name as written, one sentence of what it is, and the two sections plus the API docs. */
export function SiteHeader() {
  const path = usePathname() ?? "/";
  return (
    <header className="border-b border-line bg-panel">
      <div className="flex h-(--head) items-center justify-between gap-6 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="type-code text-text-1">
            swarm
          </Link>
          <span className="hidden truncate type-caption text-text-2 md:inline">Agentic-commerce flight simulator for PayPal merchants</span>
        </div>
        <nav aria-label="Sections" className="flex items-center gap-4">
          {NAV.map((n) => {
            const active = n.match(path);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("type-label hover:text-text-1", active ? "text-text-1" : "text-text-2")}>
                {n.label}
              </Link>
            );
          })}
          <a href={API + "/docs"} target="_blank" rel="noreferrer" className="type-label text-text-2 hover:text-text-1">
            API docs
          </a>
        </nav>
      </div>
    </header>
  );
}
