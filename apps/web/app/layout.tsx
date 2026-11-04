import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swarm · agentic-commerce flight simulator",
  description: "Unleash LLM shoppers, a merchant agent and a chaos agent on a PayPal sandbox store. Watch it live. Get an agent-readiness report.",
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 85%, transparent)", backdropFilter: "blur(8px)" }}>
          <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block h-5 w-5 rounded-md" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }} />
              Swarm
              <span className="muted ml-2 hidden text-xs font-normal sm:inline">agentic-commerce flight simulator for PayPal merchants</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="muted hover:text-white">Setup</Link>
              <Link href="/runs" className="muted hover:text-white">Runs</Link>
              <a href={API + "/docs"} target="_blank" rel="noreferrer" className="muted hover:text-white">API docs</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
