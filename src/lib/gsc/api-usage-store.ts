// API 用量按天计数(gsc_api_usage)—— 供「用量」面板展示,防配额被悄悄烧穿。
//
// kind:
//   · "url_inspection" —— URL Inspection API 调用数,精确逐 URL 计(配额 2000/天/property);
//     只在 via==="api" 时计(会话法走浏览器,不吃 API 配额)。
//   · "traffic_rounds" —— 流量更新轮数(每轮 ≈2-3 次 Search Analytics 批量请求,配额宽裕,
//     记轮数供参考即可,不做精确请求计数)。
//
// day 取洛杉矶日期 —— Google 配额窗口按太平洋时间滚动,与调度器 LA 钟点同口径。
// 读写皆软失败:计数失败绝不影响业务主流程。

import { and, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { gscApiUsage } from "@/db/schema";

export const URL_INSPECTION_DAILY_QUOTA = 2000; // Google 官方:URL Inspection 2000 次/天/property

/** 当前洛杉矶日期 "YYYY-MM-DD"(en-CA locale 恰好输出 ISO 形状)。 */
export function laDay(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** 计数 +n(UPSERT on (day,kind))。失败只 warn。 */
export async function bumpApiUsage(kind: string, n = 1): Promise<void> {
  if (n <= 0) return;
  try {
    await db
      .insert(gscApiUsage)
      .values({ day: laDay(), kind, count: n, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [gscApiUsage.day, gscApiUsage.kind],
        set: {
          count: sql`${gscApiUsage.count} + ${n}`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn("[gsc/api-usage-store] bumpApiUsage failed (non-fatal):", (err as Error).message);
  }
}

export interface ApiUsageRow {
  day: string;
  kind: string;
  count: number;
}

/** 最近 N 天(按 LA 日期)的用量行,day 降序。失败返回空数组。 */
export async function loadApiUsage(days = 7): Promise<ApiUsageRow[]> {
  try {
    const cutoff = laDay(new Date(Date.now() - days * 86_400_000));
    const rows = await db
      .select({ day: gscApiUsage.day, kind: gscApiUsage.kind, count: gscApiUsage.count })
      .from(gscApiUsage)
      .where(and(gte(gscApiUsage.day, cutoff)));
    return rows
      .map((r) => ({ day: String(r.day).slice(0, 10), kind: r.kind, count: r.count }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.kind.localeCompare(b.kind)));
  } catch (err) {
    console.warn("[gsc/api-usage-store] loadApiUsage failed (non-fatal):", (err as Error).message);
    return [];
  }
}
