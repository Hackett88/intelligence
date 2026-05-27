-- gsc_sync_log 加 mode 列：区分 full（月度全量）/ daily（日更增量）
-- 现有历史批次默认视为 full（它们都是全量抓的）。
ALTER TABLE gsc_sync_log ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full';
