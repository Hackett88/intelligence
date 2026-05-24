// GSC PG 读写抽象：每次同步打一个 batch，pages 表只存"真实页"（不含合成节点）。
// 决策回顾：累积历史 + 合成节点不入库 + JSON 兜底（详见 gsc-sync 迁移说明）。

import { db } from "@/db/client";
import { gscSyncLog, gscPages } from "@/db/schema";
import type { NewGscSyncLog, NewGscPage, GscSyncLog, GscPage } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

export interface BatchMeta {
  property?: string;
  freshnessText?: string;
  totalPages: number;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  top10Pages: number;
}

// gsc_pages 行的"应用层视图" —— 数字列已是 number，trend12m 已 parse
export interface RealPageRecord {
  url: string;
  fullUrl: string;
  market: string;
  pageType: string;
  cluster: string;
  topQuery: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  indexState: string;
  trend12m: number[];
  isPillar: boolean;
  sortOrder: number;
}

// ── 写入 ───────────────────────────────────────────────────────────────────

/**
 * 同步成功后调用。一个 transaction 完成：
 *   1) INSERT gsc_sync_log 开新 batch，拿 batch_id
 *   2) 批量 INSERT gsc_pages（per-batch unique url）
 *   3) UPDATE gsc_sync_log 标 ok + completed_at + 汇总指标
 * 返回 batchId 给调用者。
 */
export async function saveBatch(meta: BatchMeta, pages: RealPageRecord[]): Promise<number> {
  return await db.transaction(async (tx) => {
    // 1) 开 batch
    const [batch] = await tx
      .insert(gscSyncLog)
      .values({
        status: "pending",
        property: meta.property,
        freshnessText: meta.freshnessText,
      } satisfies NewGscSyncLog)
      .returning({ id: gscSyncLog.id });

    const batchId = batch.id;

    // 2) 批量插页
    if (pages.length > 0) {
      const rows: NewGscPage[] = pages.map((p) => ({
        batchId,
        url: p.url,
        fullUrl: p.fullUrl,
        market: p.market,
        pageType: p.pageType,
        cluster: p.cluster,
        topQuery: p.topQuery,
        clicks: p.clicks,
        impressions: p.impressions,
        ctr: p.ctr,
        position: p.position,
        indexState: p.indexState,
        trend12m: p.trend12m,
        isPillar: p.isPillar,
        sortOrder: p.sortOrder,
      }));
      // PG 默认 INSERT 多值上限按参数计；259 行 × ~15 列 ≈ 3.9k 参数，远低于 65535
      await tx.insert(gscPages).values(rows);
    }

    // 3) 收尾
    await tx
      .update(gscSyncLog)
      .set({
        status: "ok",
        completedAt: new Date(),
        totalPages: meta.totalPages,
        totalClicks: meta.totalClicks,
        totalImpressions: meta.totalImpressions,
        avgCtr: meta.avgCtr,
        avgPosition: meta.avgPosition,
        top10Pages: meta.top10Pages,
      })
      .where(eq(gscSyncLog.id, batchId));

    return batchId;
  });
}

/**
 * 写入失败时调用：保留 sync_log 行作为故障历史，标 error + 错误信息。
 */
export async function recordError(error: { code?: string; message?: string; property?: string }): Promise<number> {
  const [batch] = await db
    .insert(gscSyncLog)
    .values({
      status: "error",
      completedAt: new Date(),
      property: error.property,
      errorCode: error.code,
      errorMessage: error.message,
    } satisfies NewGscSyncLog)
    .returning({ id: gscSyncLog.id });
  return batch.id;
}

// ── 读取 ───────────────────────────────────────────────────────────────────

export interface LoadedBatch {
  log: GscSyncLog;
  pages: RealPageRecord[];
}

/** 取最近一次成功的 batch（含 pages）。无成功批次返回 null。 */
export async function loadLatestBatch(): Promise<LoadedBatch | null> {
  const [latest] = await db
    .select()
    .from(gscSyncLog)
    .where(eq(gscSyncLog.status, "ok"))
    .orderBy(desc(gscSyncLog.startedAt))
    .limit(1);

  if (!latest) return null;

  const rows = await db
    .select()
    .from(gscPages)
    .where(eq(gscPages.batchId, latest.id))
    .orderBy(gscPages.sortOrder);

  return {
    log: latest,
    pages: rows.map(toRealPageRecord),
  };
}

/** 取指定 batch（含 pages） */
export async function loadBatchById(batchId: number): Promise<LoadedBatch | null> {
  const [log] = await db.select().from(gscSyncLog).where(eq(gscSyncLog.id, batchId)).limit(1);
  if (!log) return null;
  const rows = await db
    .select()
    .from(gscPages)
    .where(eq(gscPages.batchId, batchId))
    .orderBy(gscPages.sortOrder);
  return { log, pages: rows.map(toRealPageRecord) };
}

function toRealPageRecord(row: GscPage): RealPageRecord {
  return {
    url: row.url,
    fullUrl: row.fullUrl,
    market: row.market,
    pageType: row.pageType,
    cluster: row.cluster,
    topQuery: row.topQuery,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    indexState: row.indexState,
    // jsonb 列出来已经是 unknown，强转
    trend12m: Array.isArray(row.trend12m) ? (row.trend12m as number[]) : [],
    isPillar: row.isPillar,
    sortOrder: row.sortOrder,
  };
}
