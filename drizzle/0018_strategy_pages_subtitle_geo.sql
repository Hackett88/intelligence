-- Migration 0018: strategy_pages 加 subtitle + geo_overview（均可空 text）
-- 回滚: ALTER TABLE "strategy_pages" DROP COLUMN IF EXISTS "subtitle"; ALTER TABLE "strategy_pages" DROP COLUMN IF EXISTS "geo_overview";

ALTER TABLE "strategy_pages" ADD COLUMN IF NOT EXISTS "subtitle" text;
ALTER TABLE "strategy_pages" ADD COLUMN IF NOT EXISTS "geo_overview" text;
