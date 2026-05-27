-- Query history for W01-W10 search workflow endpoints.
-- Per (user_id, endpoint) we keep the most recent 5 entries; deletion of
-- older overflow rows happens at the API layer, not via trigger.
-- Backed by NextAuth session.user.id (currently hardcoded "1" for admin).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "query_history" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      varchar(64) NOT NULL,
  "endpoint"     varchar(8) NOT NULL,
  "source"       varchar(16) NOT NULL DEFAULT 'workspace',
  "label"        text NOT NULL,
  "tooltip"      text,
  "params"       jsonb,
  "rows"         jsonb NOT NULL,
  "summary"      jsonb NOT NULL,
  "data_source"  text,
  "submitted_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_query_history_user_endpoint_submitted"
  ON "query_history" ("user_id", "endpoint", "submitted_at" DESC);
