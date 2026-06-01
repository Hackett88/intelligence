-- 0017_strategy_pages_scenario_auxedited — strategy_pages 补两列
-- 背景：M6 补丁。strategy_pages 已由 0016 建立并在用（admin 名下 ~20 行）。
--       本次仅追加两列，不动任何现有数据。
-- 变更：
--   ① scenario_id TEXT（可空）—— 子支柱所属场景列 id（如 "knowledge-dhikr"），
--      决定矩阵格子归属持久化。现有行加列后值为 NULL。
--   ② aux_edited BOOLEAN NOT NULL DEFAULT false —— 辅助词是否被用户手工编辑过。
--      现有行加列后默认 false（PG11+ ADD COLUMN with constant DEFAULT 为纯元数据操作，不锁表、不回写行）。
-- 幂等：ADD COLUMN IF NOT EXISTS，可重复执行。
-- 手写 SQL，延续 0009–0016 习惯，勿跑 drizzle push。

ALTER TABLE strategy_pages
  ADD COLUMN IF NOT EXISTS scenario_id TEXT;                              -- 可空，现有行 NULL

ALTER TABLE strategy_pages
  ADD COLUMN IF NOT EXISTS aux_edited BOOLEAN NOT NULL DEFAULT false;     -- 现有行 false

-- ── 回滚（如需） ──────────────────────────────────────────────────────────────
-- ALTER TABLE strategy_pages DROP COLUMN IF EXISTS aux_edited;
-- ALTER TABLE strategy_pages DROP COLUMN IF EXISTS scenario_id;
