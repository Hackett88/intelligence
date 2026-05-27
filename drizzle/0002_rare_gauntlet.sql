ALTER TYPE "public"."region" ADD VALUE 'FR';--> statement-breakpoint
ALTER TYPE "public"."region" ADD VALUE 'DE';--> statement-breakpoint
ALTER TYPE "public"."region" ADD VALUE 'ES';--> statement-breakpoint
CREATE TABLE "batch_logs" (
	"batch_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"workflow_name" text,
	"user_id" text,
	"status" text,
	"units_estimated" integer,
	"units_actual" integer,
	"rows_written" integer,
	"params_summary" jsonb,
	"error_msg" text
);
--> statement-breakpoint
CREATE TABLE "n8n_callback_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"batch_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"node_name" text NOT NULL,
	"node_status" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "n8n_callback_projections" (
	"batch_id" text PRIMARY KEY NOT NULL,
	"expected_seq" integer DEFAULT 0 NOT NULL,
	"last_event_ts" timestamp with time zone,
	"status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "n8n_cb_events_batch_seq_idx" ON "n8n_callback_events" USING btree ("batch_id","seq");--> statement-breakpoint
CREATE INDEX "n8n_cb_events_wf_ts_idx" ON "n8n_callback_events" USING btree ("workflow_id","ts");