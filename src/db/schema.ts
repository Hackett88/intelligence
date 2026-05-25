import {
  pgTable, text, integer, real, timestamp, serial, boolean, jsonb, index, uuid, varchar, doublePrecision, bigint, bigserial, uniqueIndex
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
