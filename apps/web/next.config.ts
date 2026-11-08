import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second dev server or review build run beside an existing .next (for example while a dev server is still up).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@swarm/core"],
  typescript: { ignoreBuildErrors: false },
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? (process.env.NEXT_PUBLIC_API_HOST ? "https://" + process.env.NEXT_PUBLIC_API_HOST : "http://localhost:8787") },
};

export default nextConfig;
