-- 0012_ga4_columns — gsc_pages 扩展 GA4「进站后」指标列（与 GSC 同批次、同一行）
-- 背景：GA4 数据并入 GSC 采集流，按 landing_page/pathname 对齐写进同一行，与 GSC 一起更新。
-- 设计：全部 NULLable 无默认 → 对存量行零影响、向后兼容（旧 INSERT 不传新列也成功）。
--       NULL = 该页未拉到 / 无 GA4 数据（前端回退占位），区别于"真拉到且为 0"。
-- 口径（Sean 拍板 2026-05-27）：全渠道、近 28 天、landing_page 维度。
-- 手写 SQL，避开 drizzle snapshot 漂移（延续 0009–0011 习惯，勿跑 drizzle push）。

ALTER TABLE gsc_pages ADD COLUMN IF NOT EXISTS ga4_active_users        INTEGER;
ALTER TABLE gsc_pages ADD COLUMN IF NOT EXISTS ga4_engagement_rate     DOUBLE PRECISION;  -- 0..1
ALTER TABLE gsc_pages ADD COLUMN IF NOT EXISTS ga4_avg_engagement_time DOUBLE PRECISION;  -- 秒/会话
ALTER TABLE gsc_pages ADD COLUMN IF NOT EXISTS ga4_top_countries       JSONB;             -- [{country,activeUsers}] Top10
ALTER TABLE gsc_pages ADD COLUMN IF NOT EXISTS ga4_sampled             BOOLEAN;            -- 该批是否被 GA4 采样（近似标记）

-- ── 回滚（如需）──────────────────────────────────────────────────────────────
-- 加 NULLable 列是在线 DDL（不重写表、瞬时完成），回滚对存量 GSC 数据无损：
-- ALTER TABLE gsc_pages DROP COLUMN IF EXISTS ga4_active_users;
-- ALTER TABLE gsc_pages DROP COLUMN IF EXISTS ga4_engagement_rate;
-- ALTER TABLE gsc_pages DROP COLUMN IF EXISTS ga4_avg_engagement_time;
-- ALTER TABLE gsc_pages DROP COLUMN IF EXISTS ga4_top_countries;
-- ALTER TABLE gsc_pages DROP COLUMN IF EXISTS ga4_sampled;
