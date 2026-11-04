import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@swarm/core"],
  typescript: { ignoreBuildErrors: false },
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? (process.env.NEXT_PUBLIC_API_HOST ? "https://" + process.env.NEXT_PUBLIC_API_HOST : "http://localhost:8787") },
};

export default nextConfig;
