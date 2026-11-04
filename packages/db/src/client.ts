import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let singleton: { db: Db; pool: pg.Pool } | null = null;

/** Lazily creates one pool per process. Throws a clear error when DATABASE_URL is missing. */
export function getDb(connectionString = process.env.DATABASE_URL): Db {
  if (singleton) return singleton.db;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  singleton = { db, pool };
  return db;
}

export async function closeDb() {
  await singleton?.pool.end();
  singleton = null;
}
