import { bigserial, index, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scenario: text("scenario").notNull(),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  merchantProfile: text("merchant_profile").notNull().default("baseline"),
  status: text("status").notNull().default("created"), // created | running | paused | finished | finished_budget | failed
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  scoreJson: jsonb("score_json").$type<Record<string, unknown>>(),
  /** AES-GCM blob of bring-your-own PayPal / OpenRouter credentials; null for demo-store runs. */
  credentialsEnc: text("credentials_enc"),
  tokenCap: integer("token_cap").notNull().default(400_000),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    t: timestamp("t", { withTimezone: true }).notNull().defaultNow(),
    simT: integer("sim_t").notNull().default(0),
    actor: text("actor").notNull(),
    actorClass: text("actor_class").notNull(),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    paypalIds: text("paypal_ids").array().notNull().default([]),
  },
  (t) => [index("events_run_id_idx").on(t.runId, t.id), index("events_run_type_idx").on(t.runId, t.type)],
);

export const personas = pgTable("personas", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  traitsJson: jsonb("traits_json").$type<Record<string, unknown>>().notNull().default({}),
  budget: numeric("budget", { precision: 10, scale: 2 }).notNull(),
  intent: text("intent").notNull(),
  cardBrand: text("card_brand").notNull().default("VISA"),
  seed: integer("seed").notNull().default(0),
});

export const findings = pgTable("findings", {
  id: serial("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  rule: text("rule").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  fix: text("fix").notNull(),
  eventIds: integer("event_ids").array().notNull().default([]),
  paypalIds: text("paypal_ids").array().notNull().default([]),
});

export const webhooks = pgTable(
  "webhooks",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    resourceId: text("resource_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().notNull(),
    matchedEventId: integer("matched_event_id"),
    lagMs: integer("lag_ms"),
    verified: integer("verified").notNull().default(0),
  },
  (t) => [index("webhooks_resource_idx").on(t.resourceId)],
);

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // refund | accept_dispute
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"), // pending | granted | denied | timeout
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Content-addressed cache for development reruns (LLM_CACHE=1). Never used in production or the smoke test. */
export const llmCache = pgTable("llm_cache", {
  hash: text("hash").primaryKey(),
  model: text("model").notNull(),
  responseJson: jsonb("response_json").$type<Record<string, unknown>>().notNull(),
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
