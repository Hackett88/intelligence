import {
  pgTable, text, integer, real, timestamp, serial, boolean, jsonb, index, uuid, varchar
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
