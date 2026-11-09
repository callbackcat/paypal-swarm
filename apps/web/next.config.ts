import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// The repo keeps one .env at the root (api and web). Next.js only reads env files next to itself, so pull the
// NEXT_PUBLIC_* values from the root file here; values already in the process environment win (Vercel, CI).
const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2]!.replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value && !process.env[m[1]!]) process.env[m[1]!] = value;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second dev server or review build run beside an existing .next (for example while a dev server is still up).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@swarm/core"],
  typescript: { ignoreBuildErrors: false },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? (process.env.NEXT_PUBLIC_API_HOST ? "https://" + process.env.NEXT_PUBLIC_API_HOST : "http://localhost:8787"),
    NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY: process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY ?? "",
  },
};

export default nextConfig;
