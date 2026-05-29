-- 0014_strategy_plan — 选题工作台持久化：页面规划表 + 词—页绑定表
-- 背景：strategy 模块规划成果（支柱/集群页面结构 + 词→页绑定）此前仅存 localStorage，
--       本次落库以支持多设备同步、历史保留与后续 SEO 自动化调度。
-- 设计决策：
--   ① strategy_bindings.page_id 在应用层引用 strategy_pages.page_id（同 owner），不建 FK，
--      原因：保存时按 owner 整组覆盖写，应用层保证一致性；避免工作台内部字符串 id 带来的复合 FK 复杂度。
--   ② market 无值用空串 '' 而非 NULL，以保证 UNIQUE(owner, keyword, market) 约束可靠。
--   ③ 两表均以 owner（email）做行级隔离，无需全局唯一约束。
-- 手写 SQL，避开 drizzle snapshot 漂移（延续 0009–0013 习惯，勿跑 drizzle push）。

-- ── strategy_pages：页面规划表（支柱 + 集群） ────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_pages (
  id               BIGSERIAL PRIMARY KEY,
  owner            TEXT        NOT NULL,                     -- 登录用户 email，行级隔离
  page_id          TEXT        NOT NULL,                     -- 工作台内部页面 id（如 zr-pillar / usr-pil-1001）
  role             TEXT        NOT NULL,                     -- 'pillar' | 'cluster'
  pillar_id        TEXT,                                     -- 集群指向其支柱 page_id；支柱为 NULL
  title            TEXT        NOT NULL,
  primary_keyword  TEXT        NOT NULL,
  page_type        TEXT        NOT NULL,                     -- page_planning_intent（如 知识深度页 / 品类聚合页…）
  status           TEXT        NOT NULL,                     -- 'live' | 'optimize' | 'gap'
  url              TEXT,                                     -- 可空（待新建页为空）
  market           TEXT        NOT NULL,                     -- 主市场（2 字母码，如 us）
  markets          JSONB       NOT NULL DEFAULT '[]'::jsonb, -- locale 变体数组
  theme_id         TEXT        NOT NULL,
  theme_name       TEXT        NOT NULL,
  theme_latin      TEXT        NOT NULL,
  territory        TEXT        NOT NULL,                     -- 产品 / 知识 / 工具 / 场景 / 品牌
  note             TEXT,                                     -- 可空
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_strategy_pages_owner_page_id UNIQUE (owner, page_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_pages_owner ON strategy_pages (owner);

-- ── strategy_bindings：词—页绑定表 ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_bindings (
  id          BIGSERIAL   PRIMARY KEY,
  owner       TEXT        NOT NULL,                -- 登录用户 email，行级隔离
  keyword     TEXT        NOT NULL,                -- 关键词文本
  market      TEXT        NOT NULL DEFAULT '',     -- 市场码；无市场用空串 ''（保证唯一约束可靠）
  page_id     TEXT,                                -- 绑到的页面（= strategy_pages.page_id，同 owner）；NULL = 暂存篮
  state       TEXT        NOT NULL,                -- 'bound' | 'parked'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_strategy_bindings_owner_kw_market UNIQUE (owner, keyword, market)
);

CREATE INDEX IF NOT EXISTS idx_strategy_bindings_owner            ON strategy_bindings (owner);
CREATE INDEX IF NOT EXISTS idx_strategy_bindings_owner_page_id    ON strategy_bindings (owner, page_id);

-- ── 回滚（如需）──────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS strategy_bindings;
-- DROP TABLE IF EXISTS strategy_pages;
