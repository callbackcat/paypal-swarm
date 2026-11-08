import type { Metadata } from "next";
import "@/components/sodium/styles.css";
import "./globals.css";
import { SodiumPortalProvider } from "@/lib/sodium/portal";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "paypal-swarm",
  description: "Point LLM shoppers, a merchant agent and a chaos agent at a PayPal sandbox store. Watch it live. Get an agent-readiness report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="sodium">
        <SodiumPortalProvider>
          <div className="flex min-h-dvh flex-col bg-page text-text-1">
            <SiteHeader />
            <main className="flex w-full flex-1 flex-col gap-8 px-6 py-8">{children}</main>
          </div>
        </SodiumPortalProvider>
      </body>
    </html>
  );
}
