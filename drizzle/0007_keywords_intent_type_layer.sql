-- M03: Add 4 intent/type/layer columns to keywords table.
-- Mirrors the 4 new columns added to N8N keywords_pool DataTable (project module M02).
-- All nullable text; values populated by Sync workflow from keywords_pool after M02 V1.7
-- runs in non-dry_run mode. Front-end falls back to "—" / "unmapped_pending" / etc. when NULL.
--
-- Columns:
--   behavior_intent       Behavioral intent: know / compare / do / website / visit_in_person / mixed / ambiguous
--   page_planning_intent  Page planning intent: brand / category / product_detail / scenario / region / knowledge / tool_ecosystem / unmapped_pending / ambiguous
--   layer_level           Hierarchy layer: L1 / L2 / L3 / L4
--   l4_subtype            L4 sub-type: emerging / low_volume / reserve (only populated when layer_level = 'L4')

ALTER TABLE "keywords" ADD COLUMN "behavior_intent" text;
ALTER TABLE "keywords" ADD COLUMN "page_planning_intent" text;
ALTER TABLE "keywords" ADD COLUMN "layer_level" text;
ALTER TABLE "keywords" ADD COLUMN "l4_subtype" text;
