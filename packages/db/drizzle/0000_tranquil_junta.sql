CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"t" timestamp with time zone DEFAULT now() NOT NULL,
	"sim_t" integer DEFAULT 0 NOT NULL,
	"actor" text NOT NULL,
	"actor_class" text NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paypal_ids" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"fix" text NOT NULL,
	"event_ids" integer[] DEFAULT '{}' NOT NULL,
	"paypal_ids" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"traits_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget" numeric(10, 2) NOT NULL,
	"intent" text NOT NULL,
	"card_brand" text DEFAULT 'VISA' NOT NULL,
	"seed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scenario" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merchant_profile" text DEFAULT 'baseline' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"score_json" jsonb,
	"credentials_enc" text,
	"token_cap" integer DEFAULT 400000 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text,
	"event_type" text NOT NULL,
	"resource_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb NOT NULL,
	"matched_event_id" integer,
	"lag_ms" integer,
	"verified" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_run_id_idx" ON "events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "events_run_type_idx" ON "events" USING btree ("run_id","type");--> statement-breakpoint
CREATE INDEX "webhooks_resource_idx" ON "webhooks" USING btree ("resource_id");