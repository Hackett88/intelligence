-- 0010_gsc_page_queries — gsc_pages 增加「页面关键词排名」列
-- 背景：从"打开抽屉才懒加载单页 query"改为"同步时批量抓全部页面的 query 一并落库"，
-- 抽屉/列表直接读库，不再每次点击发请求。手写 SQL，避开 drizzle snapshot 漂移。

ALTER TABLE gsc_pages
  ADD COLUMN IF NOT EXISTS queries JSONB NOT NULL DEFAULT '[]'::jsonb;
