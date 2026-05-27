-- M03b: Add cluster_id column to keywords table.
-- Mirrors N8N keywords_pool DataTable column cluster_id (string, index 22).
-- Populated by [Sync] keywords_pool → PG keywords workflow after this migration applies.
-- IF NOT EXISTS for idempotency (manual re-runs).
--
-- Sister of 0007: 0007 added behavior_intent / page_planning_intent / layer_level / l4_subtype,
-- but cluster_id was missed. This migration completes the keywords_pool ↔ keywords mirror
-- for the 4 fields the front-end is now consuming (behavior_intent, page_planning_intent,
-- layer_level, cluster_id).

ALTER TABLE "keywords" ADD COLUMN IF NOT EXISTS "cluster_id" text;
