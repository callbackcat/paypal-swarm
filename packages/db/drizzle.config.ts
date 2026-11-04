import { defineConfig } from "drizzle-kit";

try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile("../../.env");
} catch {
  /* rely on the environment */
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/swarm" },
  strict: true,
  verbose: false,
});
