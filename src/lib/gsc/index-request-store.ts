// 「请求编入索引」历史计数存储 —— PG 单表(gsc_index_requests),按 url_norm 一行。
//
// 语义:只记「真正提交成功」(fetcher status === "requested")的次数与时刻;
// already_indexed / throttled / captcha / failed 都不是提交,不计数。
// 单页路由 /api/indexing/request-index 是唯一写入口 —— 抽屉单页按钮与批量勾选流
// 都走它,计数天然统一。
//
// 读写都软失败:记录失败只 warn(不能让"已成功的 GSC 提交"因计数落库失败而报错);
// 读取失败返回空 Map(前端显示"未请求过",不炸页面)。

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { gscIndexRequests } from "@/db/schema";
import { normalizeForMatch } from "./url-normalize";

export interface IndexRequestInfo {
  count: number;
  lastAt: string | null; // ISO;null 理论上不出现(有行必有时刻),防御留着
}

/** 成功提交一次「请求编入索引」→ 计数 +1、刷新上次时刻。失败只 warn 不抛。 */
export async function recordIndexRequested(fullUrl: string): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(gscIndexRequests)
      .values({
        urlNorm: normalizeForMatch(fullUrl),
        fullUrl,
        requestCount: 1,
        lastRequestedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: gscIndexRequests.urlNorm,
        set: {
          fullUrl,
          requestCount: sql`${gscIndexRequests.requestCount} + 1`,
          lastRequestedAt: now,
          updatedAt: now,
        },
      });
  } catch (err) {
    console.warn(
      "[gsc/index-request-store] recordIndexRequested failed (non-fatal):",
      (err as Error).message
    );
  }
}

/** 全量读回 Map<url_norm, {count, lastAt}>。失败返回空 Map(前端按"未请求过"显示)。 */
export async function loadIndexRequestMap(): Promise<Map<string, IndexRequestInfo>> {
  const out = new Map<string, IndexRequestInfo>();
  try {
    const rows = await db.select().from(gscIndexRequests);
    for (const r of rows) {
      out.set(r.urlNorm, {
        count: r.requestCount,
        lastAt: r.lastRequestedAt?.toISOString() ?? null,
      });
    }
  } catch (err) {
    console.warn(
      "[gsc/index-request-store] loadIndexRequestMap failed (non-fatal):",
      (err as Error).message
    );
  }
  return out;
}
