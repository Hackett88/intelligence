-- 0013_gsc_sync_query_failed_urls — gsc_sync_log 增列：本批次关键词抓取失败的页 URL 列表
-- 背景：全量同步逐页抓 GSC 关键词时可能被限流（如某次 261 页中 28 页失败）。为支持
--       "24 小时内再点全量 → 默认续跑、只补失败页、其余沿用上一批"，需持久化失败页清单。
-- 设计：NULLable JSONB（字符串数组，元素为 fullUrl）。NULL / [] = 无失败 = 完整批次。
--       只记 fetch 真失败（网络/限流/超时）的页；"抓到但 0 关键词"（GSC 隐私阈值）不入此列，
--       否则会被无限重试。续跑判定 = 最近一次 full 批次 started_at 距今 ≤ 24h 且本列非空。
-- 手写 SQL，避开 drizzle snapshot 漂移（延续 0009–0012 习惯，勿跑 drizzle push）。

ALTER TABLE gsc_sync_log ADD COLUMN IF NOT EXISTS query_failed_urls JSONB;

-- ── 回滚（如需）──────────────────────────────────────────────────────────────
-- 加 NULLable 列是在线 DDL（不重写表、瞬时完成），回滚对存量同步历史无损：
-- ALTER TABLE gsc_sync_log DROP COLUMN IF EXISTS query_failed_urls;
