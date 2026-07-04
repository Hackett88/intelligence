import {
  pgTable, text, integer, real, timestamp, serial, boolean, jsonb, index, uuid, varchar, doublePrecision, bigint, bigserial, uniqueIndex, date, primaryKey
} from "drizzle-orm/pg-core";

// ---- Main keyword table (mirrors N8N keywords_pool DataTable) ----
export const keywords = pgTable("keywords", {
  id:                serial("id").primaryKey(),

  // Core identifiers
  keyword:           text("keyword").notNull(),
  market:            text("market"),
  month:             text("month"),
  rowKey:            text("row_key").notNull().unique(),

  // Metrics
  searchVolume:      integer("search_volume"),
  keywordDifficulty: integer("keyword_difficulty"),
  cpc:               real("cpc"),
  numberOfResults:   integer("number_of_results"),
  trends:            text("trends"),

  // Intent / SERP
  intent:            text("intent"),
  serpFeaturesKeyword: text("serp_features_keyword"),

  // Scores
  bp:                integer("bp"),
  cs:                integer("cs"),

  // Lineage
  sourceRowKeys:     text("source_row_keys"),

  // Flags
  protected:         boolean("protected"),
  questionType:      text("question_type"),

  // Intent / layer / cluster (mirrors 4 new keywords_pool columns; migrations 0007 + 0008)
  behaviorIntent:      text("behavior_intent"),
  pagePlanningIntent:  text("page_planning_intent"),
  layerLevel:          text("layer_level"),
  clusterId:           text("cluster_id"),

  // Timestamps
  createdAt:         timestamp("created_at").defaultNow(),
  lastManualW03At:   timestamp("last_manual_w03_at", { withTimezone: true }),
  updatedAt:         timestamp("updated_at").defaultNow(),
});

export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;

// ---- N8N callback events (idempotency) ----
export const n8nCallbackEvents = pgTable(
  "n8n_callback_events",
  {
    eventId:     text("event_id").primaryKey(),
    seq:         integer("seq").notNull(),
    ts:          timestamp("ts", { withTimezone: true }).notNull(),
    batchId:     text("batch_id").notNull(),
    workflowId:  text("workflow_id").notNull(),
    executionId: text("execution_id").notNull(),
    nodeName:    text("node_name").notNull(),
    nodeStatus:  text("node_status").notNull(),
    payload:     jsonb("payload"),
    createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchSeqIdx: index("n8n_cb_events_batch_seq_idx").on(t.batchId, t.seq),
    wfTsIdx:     index("n8n_cb_events_wf_ts_idx").on(t.workflowId, t.ts),
  })
);

// ---- N8N callback projections ----
export const n8nCallbackProjections = pgTable("n8n_callback_projections", {
  batchId:      text("batch_id").primaryKey(),
  expectedSeq:  integer("expected_seq").notNull().default(0),
  lastEventTs:  timestamp("last_event_ts", { withTimezone: true }),
  status:       text("status"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---- Batch logs ----
export const batchLogs = pgTable("batch_logs", {
  batchId:         text("batch_id").primaryKey(),
  startedAt:       timestamp("started_at", { withTimezone: true }),
  finishedAt:      timestamp("finished_at", { withTimezone: true }),
  workflowName:    text("workflow_name"),
  userId:          text("user_id"),
  status:          text("status"),
  unitsEstimated:  integer("units_estimated"),
  unitsActual:     integer("units_actual"),
  rowsWritten:     integer("rows_written"),
  paramsSummary:   jsonb("params_summary"),
  errorMsg:        text("error_msg"),
});

export type N8nCallbackEventRow = typeof n8nCallbackEvents.$inferSelect;
export type NewN8nCallbackEventRow = typeof n8nCallbackEvents.$inferInsert;
export type N8nCallbackProjection = typeof n8nCallbackProjections.$inferSelect;
export type BatchLog = typeof batchLogs.$inferSelect;

// ---- Query history for W01-W10 workspace endpoints ----
// Per (user_id, endpoint) keep most recent 5 entries; trimming done at API layer.
// Backed by NextAuth session.user.id (currently hardcoded "1" for admin).
export const queryHistory = pgTable(
  "query_history",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    userId:       varchar("user_id", { length: 64 }).notNull(),  // from NextAuth session.user.id
    endpoint:     varchar("endpoint", { length: 8 }).notNull(),  // "W01".."W10"
    source:       varchar("source", { length: 16 }).notNull().default("workspace"),  // workspace | drawer
    label:        text("label").notNull(),
    tooltip:      text("tooltip"),
    params:       jsonb("params"),
    rows:         jsonb("rows").notNull(),       // full query result rows (mirrors localStorage)
    summary:      jsonb("summary").notNull(),    // { rowsTotal, unitsActual, totalBatches, failedBatches, ... }
    dataSource:   text("data_source"),
    submittedAt:  timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userEndpointSubmittedIdx: index("idx_query_history_user_endpoint_submitted").on(
      t.userId, t.endpoint, t.submittedAt
    ),
  })
);

export type QueryHistoryRow = typeof queryHistory.$inferSelect;
export type NewQueryHistoryRow = typeof queryHistory.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// GSC 收录与索引（迁移 0009，2026-05-24）
// 决策：① 累积历史（每次同步一个 batch，留时间序列）② 合成节点不入库
// ────────────────────────────────────────────────────────────────────────────

export const gscSyncLog = pgTable(
  "gsc_sync_log",
  {
    id:               bigserial("id", { mode: "number" }).primaryKey(),
    startedAt:        timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt:      timestamp("completed_at", { withTimezone: true }),
    status:           text("status").notNull().default("pending"),       // pending | ok | error
    mode:             text("mode").notNull().default("full"),            // full（月度全量）| daily（日更增量）
    property:         text("property"),                                  // sc-domain:weslamic.com
    freshnessText:    text("freshness_text"),                            // "上次更新日期：4小时前"
    totalPages:       integer("total_pages"),                            // 真实页数（不含合成）
    totalClicks:      integer("total_clicks"),
    totalImpressions: bigint("total_impressions", { mode: "number" }),
    avgCtr:           doublePrecision("avg_ctr"),
    avgPosition:      doublePrecision("avg_position"),
    top10Pages:       integer("top10_pages"),
    errorCode:        text("error_code"),
    errorMessage:     text("error_message"),
    // 本批次关键词抓取真正失败（网络/限流/超时）的页 fullUrl 列表（迁移 0013）。
    // 用于"24h 内续跑"：再点全量时只补这些页，其余沿用上一批。null/[] = 无失败=完整批次。
    // 注意：只记 fetch 报错的页，不含"抓到但 0 关键词"（隐私阈值）的页 —— 后者不该重试。
    queryFailedUrls:  jsonb("query_failed_urls"),
  },
  (t) => ({
    startedAtIdx: index("idx_gsc_sync_log_started_at").on(t.startedAt),
    statusIdx:    index("idx_gsc_sync_log_status").on(t.status),
  })
);

export const gscPages = pgTable(
  "gsc_pages",
  {
    id:          bigserial("id", { mode: "number" }).primaryKey(),
    batchId:     bigint("batch_id", { mode: "number" }).notNull().references(() => gscSyncLog.id, { onDelete: "cascade" }),
    url:         text("url").notNull(),
    fullUrl:     text("full_url").notNull(),
    market:      text("market").notNull(),
    pageType:    text("page_type").notNull(),
    cluster:     text("cluster").notNull(),
    topQuery:    text("top_query").notNull().default("—"),
    clicks:      integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr:         doublePrecision("ctr").notNull().default(0),
    position:    doublePrecision("position").notNull().default(0),
    indexState:  text("index_state").notNull().default("indexed"),
    trend12m:    jsonb("trend12m").notNull().default([]),
    // 该 URL 的页面关键词排名（top N），同步时批量抓取一并落库；
    // 元素形如 { query, clicks, impressions, ctr, position }
    queries:     jsonb("queries").notNull().default([]),
    // GA4 进站后指标（迁移 0012）—— 与 GSC 同批次、同一行。
    // 全部可空：NULL = 该页未拉到 / 无 GA4 数据（前端回退占位），区别于"真拉到且为 0"。
    // 口径：全渠道、近 28 天、landing_page 维度（Sean 拍板）。
    ga4ActiveUsers:       integer("ga4_active_users"),
    ga4EngagementRate:    doublePrecision("ga4_engagement_rate"),   // 0..1（engaged_sessions/sessions 派生）
    ga4AvgEngagementTime: doublePrecision("ga4_avg_engagement_time"), // 秒/会话（user_engagement_duration/sessions 派生）
    ga4TopCountries:      jsonb("ga4_top_countries"),               // [{ country, activeUsers }] Top10
    ga4Sampled:          boolean("ga4_sampled"),                    // 该批 GA4 是否被采样（近似标记）
    isPillar:    boolean("is_pillar").notNull().default(false),
    sortOrder:   integer("sort_order").notNull(),
  },
  (t) => ({
    batchIdIdx:     index("idx_gsc_pages_batch_id").on(t.batchId),
    batchClicksIdx: index("idx_gsc_pages_batch_clicks").on(t.batchId, t.clicks),
    urlIdx:         index("idx_gsc_pages_url").on(t.url),
    uqBatchUrl:     uniqueIndex("uq_gsc_pages_batch_url").on(t.batchId, t.url),
  })
);

export type GscSyncLog    = typeof gscSyncLog.$inferSelect;
export type NewGscSyncLog = typeof gscSyncLog.$inferInsert;
export type GscPage       = typeof gscPages.$inferSelect;
export type NewGscPage    = typeof gscPages.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// 选题工作台持久化（迁移 0014，2026-05-29；0015 清白板时 DROP；0016 复活 + aux_keywords）
// 决策：① owner（email）做行级隔离 ② strategy_bindings.page_id 不建 FK（应用层保证一致性）
//       ③ market 无值用空串 ''（非 NULL），保证 UNIQUE(owner, keyword, market) 可靠
//       ④ aux_keywords：辅助词（实体）数组，JSONB，默认空数组（M6 新增，0016）
// ────────────────────────────────────────────────────────────────────────────

export const strategyPages = pgTable(
  "strategy_pages",
  {
    id:             bigserial("id", { mode: "number" }).primaryKey(),
    owner:          text("owner").notNull(),
    pageId:         text("page_id").notNull(),
    role:           text("role").notNull(),             // 'pillar' | 'cluster'
    pillarId:       text("pillar_id"),                  // 集群指向其支柱 page_id；支柱为 NULL
    title:          text("title").notNull(),
    primaryKeyword: text("primary_keyword").notNull(),
    pageType:       text("page_type").notNull(),        // page_planning_intent
    status:         text("status").notNull(),           // 'live' | 'optimize' | 'gap'
    url:            text("url"),                        // 可空（待新建页为空）
    market:         text("market").notNull(),           // 主市场（2 字母码，如 us）
    markets:        jsonb("markets").notNull().default([]),  // locale 变体数组
    themeId:        text("theme_id").notNull(),
    themeName:      text("theme_name").notNull(),
    themeLatin:     text("theme_latin").notNull(),
    territory:      text("territory").notNull(),        // 产品/知识/工具/场景/品牌
    note:           text("note"),                       // 可空
    subtitle:       text("subtitle"),                   // 副标题（可空，0018）
    geoOverview:    text("geo_overview"),               // GEO 概述（可空，0018）
    sortOrder:      integer("sort_order").notNull().default(0),
    auxKeywords:    jsonb("aux_keywords").notNull().default([]),  // 辅助词（实体）数组（0016）
    scenarioId:     text("scenario_id"),                 // 自建子支柱的场景列归属（可空，0017）
    auxEdited:      boolean("aux_edited").notNull().default(false), // 辅助词是否被用户手工改过（0017）
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerPageIdUq: uniqueIndex("uq_strategy_pages_owner_page_id").on(t.owner, t.pageId),
    ownerIdx:      index("idx_strategy_pages_owner").on(t.owner),
  })
);

export type StrategyPage    = typeof strategyPages.$inferSelect;
export type NewStrategyPage = typeof strategyPages.$inferInsert;

export const strategyBindings = pgTable(
  "strategy_bindings",
  {
    id:        bigserial("id", { mode: "number" }).primaryKey(),
    owner:     text("owner").notNull(),
    keyword:   text("keyword").notNull(),
    market:    text("market").notNull().default(""),  // 无市场用空串 ''，保证唯一约束可靠
    pageId:    text("page_id"),                       // NULL = 暂存篮
    state:     text("state").notNull(),               // 'bound' | 'parked'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerKwMarketUq:    uniqueIndex("uq_strategy_bindings_owner_kw_market").on(t.owner, t.keyword, t.market),
    ownerIdx:           index("idx_strategy_bindings_owner").on(t.owner),
    ownerPageIdIdx:     index("idx_strategy_bindings_owner_page_id").on(t.owner, t.pageId),
  })
);

export type StrategyBinding    = typeof strategyBindings.$inferSelect;
export type NewStrategyBinding = typeof strategyBindings.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// GSC 收录状态（JSON → PG 迁移，2026-06-28）
// 手写幂等 CREATE TABLE IF NOT EXISTS 直接执行，此定义仅供 ORM 查询使用，
// 不走 drizzle-kit generate/push/migrate（snapshot 已漂移，禁止调用）。
// ────────────────────────────────────────────────────────────────────────────

export const gscIndexStatus = pgTable("gsc_index_status", {
  urlNorm:          text("url_norm").primaryKey(),
  fullUrl:          text("full_url").notNull(),
  indexed:          boolean("indexed"),
  coverageText:     text("coverage_text"),
  pageIndexingText: text("page_indexing_text"),
  lastCrawled:      text("last_crawled"),
  checkedAt:        timestamp("checked_at", { withTimezone: true }),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GscIndexStatus    = typeof gscIndexStatus.$inferSelect;
export type NewGscIndexStatus = typeof gscIndexStatus.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// 页面类型「人工修正」（JSON → PG 迁移，2026-07-04）
// 生产容器文件系统随部署重置，JSON 修正撑不过发版 —— PG 为唯一权威源，JSON 降级镜像兜底。
// 手写幂等 DDL 见 scripts/ddl-page-type-overrides.ts，此定义仅供 ORM 查询，禁 drizzle-kit。
// ────────────────────────────────────────────────────────────────────────────

export const gscPageTypeOverrides = pgTable("gsc_page_type_overrides", {
  urlNorm:   text("url_norm").primaryKey(),   // normalizeForMatch(fullUrl)
  fullUrl:   text("full_url").notNull(),
  pageType:  text("page_type").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GscPageTypeOverride    = typeof gscPageTypeOverrides.$inferSelect;
export type NewGscPageTypeOverride = typeof gscPageTypeOverrides.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// 「请求编入索引」历史计数（2026-07-04）
// 每 URL 一行：成功提交次数 + 上次提交时刻。请求索引清单弹窗按此显示历史，防重复烧配额。
// 手写幂等 DDL 见 scripts/ddl-index-requests.ts，此定义仅供 ORM 查询，禁 drizzle-kit。
// ────────────────────────────────────────────────────────────────────────────

export const gscIndexRequests = pgTable("gsc_index_requests", {
  urlNorm:         text("url_norm").primaryKey(),   // normalizeForMatch(fullUrl)
  fullUrl:         text("full_url").notNull(),
  requestCount:    integer("request_count").notNull().default(0),
  lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GscIndexRequest    = typeof gscIndexRequests.$inferSelect;
export type NewGscIndexRequest = typeof gscIndexRequests.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// 应用内定时器全局配置（2026-06-28）
// 单行表：CHECK (id = 1) 约束在 DDL 层保证，Drizzle 定义仅供 ORM 查询。
// 不走 drizzle-kit generate/push/migrate。
// ────────────────────────────────────────────────────────────────────────────

export const appSchedulerConfig = pgTable("app_scheduler_config", {
  id:              integer("id").primaryKey().default(1),
  enabled:         boolean("enabled").notNull().default(false),
  intervalMinutes: integer("interval_minutes").notNull().default(1440),
  runHour:         integer("run_hour").notNull().default(6),    // LA 每日触发小时 0-23（收录默认 06:00）
  runMinute:       integer("run_minute").notNull().default(0),  // LA 每日触发分钟 0-59
  mode:            text("mode").notNull().default("all"),
  lastRunAt:       timestamp("last_run_at", { withTimezone: true }),
  lastRunSummary:  jsonb("last_run_summary"),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSchedulerConfig    = typeof appSchedulerConfig.$inferSelect;
export type NewAppSchedulerConfig = typeof appSchedulerConfig.$inferInsert;

// 应用内「定时更新（流量）」配置（2026-06-28）——与 app_scheduler_config 并列的第二个定时。
// 单行表 CHECK(id=1)，手写幂等 DDL，禁 drizzle-kit。
export const appTrafficSchedulerConfig = pgTable("app_traffic_scheduler_config", {
  id:              integer("id").primaryKey().default(1),
  enabled:         boolean("enabled").notNull().default(false),
  intervalMinutes: integer("interval_minutes").notNull().default(1440),
  runHour:         integer("run_hour").notNull().default(0),    // LA 每日触发小时 0-23（流量默认 00:30）
  runMinute:       integer("run_minute").notNull().default(30), // LA 每日触发分钟 0-59
  lastRunAt:       timestamp("last_run_at", { withTimezone: true }),
  lastRunSummary:  jsonb("last_run_summary"),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AppTrafficSchedulerConfig    = typeof appTrafficSchedulerConfig.$inferSelect;
export type NewAppTrafficSchedulerConfig = typeof appTrafficSchedulerConfig.$inferInsert;

// ────────────────────────────────────────────────────────────────────────────
// GSC 每页每天流量明细（T2，2026-06-28）
// 地基：任一窗口（7/28/90 天等）的流量 = gsc_page_daily 按 date 求和最近 N 天。
// 取数 dimensions:["page","date"]；按 normalizeForMatch(fullUrl) 归一化为主键之一，
// 桥(coverage-loader)直接按 url_norm 匹配重定向图。
// sum_position = Σ(position*impressions) 当天 —— 窗口加权位置 = Σsum_position / Σimpressions。
// 手写幂等 CREATE TABLE IF NOT EXISTS 直接执行，此定义仅供 ORM 查询，禁 drizzle-kit。
// ────────────────────────────────────────────────────────────────────────────

export const gscPageDaily = pgTable(
  "gsc_page_daily",
  {
    urlNorm:     text("url_norm").notNull(),            // normalizeForMatch(fullUrl)
    fullUrl:     text("full_url").notNull(),
    date:        date("date", { mode: "string" }).notNull(),
    clicks:      integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    sumPosition: doublePrecision("sum_position").notNull().default(0), // Σ(position*impressions) 当天
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk:      primaryKey({ columns: [t.urlNorm, t.date] }),
    dateIdx: index("idx_gsc_page_daily_date").on(t.date),
  })
);

export type GscPageDaily    = typeof gscPageDaily.$inferSelect;
export type NewGscPageDaily = typeof gscPageDaily.$inferInsert;
