-- 0015_drop_strategy_plan — 删除已废弃的选题工作台持久化层
--
-- 背景：
--   选题工作台已清成白板重搭，持久化层已从应用层完全拆除：
--     · src/db/schema.ts 中两张表的 Drizzle 定义已删
--     · src/app/strategy/_plan-store.ts / _plan-actions.ts 已删
--     · page.tsx / Wrapper / Client 的接线已全部移除
--   两张表不再被任何代码引用，属于孤立对象。
--
-- 数据已备份：
--   · 备份/strategy_pages_backup_2026-05-31.json    (31 行)
--   · 备份/strategy_bindings_backup_2026-05-31.json (116 行)
--
-- 回滚方式：
--   1. 重新跑 drizzle/0014_strategy_plan.sql 可重建表结构（含索引与约束）。
--   2. 用备份 JSON 中的 rows 数组回灌数据即可完整恢复。
--
-- DROP 顺序：bindings 先于 pages（bindings 在应用层引用 pages.page_id，
--   虽无 FK 但逻辑上 bindings 是子表，遵循子先父后的安全顺序）。
-- 两表附属索引（idx_strategy_bindings_*、idx_strategy_pages_*）随表自动删除。

DROP TABLE IF EXISTS strategy_bindings;
DROP TABLE IF EXISTS strategy_pages;
