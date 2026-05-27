-- 0009_gsc_tables — 收录与索引模块从 JSON 单文件迁移到 PG，累积历史快照
-- 决策回顾：① 累积历史（每次同步一个 batch，留时间序列）② 合成节点不入库（UI 加载时内存重建）③ JSON 兜底保留
-- 手写 SQL 避开 drizzle snapshot 漂移（详见 开发资产.md §10.2）

CREATE TABLE IF NOT EXISTS gsc_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ok', 'error')),
  property        TEXT,
  freshness_text  TEXT,
  -- 汇总指标（与 SummaryBar 一一对应）
  total_pages       INTEGER,
  total_clicks      INTEGER,
  total_impressions BIGINT,
  avg_ctr           DOUBLE PRECISION,
  avg_position      DOUBLE PRECISION,
  top10_pages       INTEGER,
  -- 失败信息
  error_code      TEXT,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_gsc_sync_log_started_at ON gsc_sync_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_sync_log_status     ON gsc_sync_log (status);

CREATE TABLE IF NOT EXISTS gsc_pages (
  id            BIGSERIAL PRIMARY KEY,
  batch_id      BIGINT NOT NULL REFERENCES gsc_sync_log(id) ON DELETE CASCADE,
  -- 路径与归类
  url           TEXT NOT NULL,           -- pathname，如 /products/zikr-ring
  full_url      TEXT NOT NULL,           -- 含 origin，如 https://www.weslamic.com/products/zikr-ring
  market        TEXT NOT NULL,           -- us / sa / fr / de / tr / id …
  page_type     TEXT NOT NULL,           -- 首页/品类列表页/产品详情页/博客文章/…（12 类中文）
  cluster       TEXT NOT NULL,
  top_query     TEXT NOT NULL DEFAULT '—',
  -- GSC 原生 4 指标
  clicks        INTEGER NOT NULL DEFAULT 0,
  impressions   INTEGER NOT NULL DEFAULT 0,
  ctr           DOUBLE PRECISION NOT NULL DEFAULT 0,   -- 0.013 表示 1.3%
  position      DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- 索引状态 + 趋势 + 标记
  index_state   TEXT NOT NULL DEFAULT 'indexed',       -- indexed / discovered / excluded / error
  trend12m      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- 12 个月点击趋势（数组）；当前 fetcher 还没拉，全 0
  is_pillar     BOOLEAN NOT NULL DEFAULT FALSE,
  -- 排序与排序后位置（UI 层用 sort_order 生成稳定 id）
  sort_order    INTEGER NOT NULL,
  -- 合成节点不入库（决策已定），所以这里没有 parent_url / parent_id —— UI 加载后内存重建父链

  -- 同一 batch 内不应有重复 URL
  CONSTRAINT uq_gsc_pages_batch_url UNIQUE (batch_id, url)
);

CREATE INDEX IF NOT EXISTS idx_gsc_pages_batch_id     ON gsc_pages (batch_id);
CREATE INDEX IF NOT EXISTS idx_gsc_pages_batch_clicks ON gsc_pages (batch_id, clicks DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_pages_url          ON gsc_pages (url);   -- 跨 batch 查同一 URL 历史
