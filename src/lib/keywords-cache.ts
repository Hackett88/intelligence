// 关键词库（keywords 表）的跨请求内存缓存 + 统计聚合。
//
// 背景：/app/keywords 原本每次进页面都全表 select 两遍（列表一遍、统计又拉全表回 JS
// 算一遍），在本地→PG ~400ms/往返的环境下偏慢。这里：
//   1) 列表与统计各带 globalThis + TTL 缓存（同 GSC loader 的做法，防 dev 热重载丢缓存）；
//   2) 统计改为 DB 端聚合（count/avg），不再把整张表拉回内存。
// 任何写 keywords 表的地方（actions 增删改、fetch route 的 manual 刷新）都要调
// invalidateKeywordsCache() 主动失效，保证缓存始终最新。
//
// 注意：本模块**不是** "use server" —— server action 模块只能 export async 函数，
// 而 invalidateKeywordsCache 需要是同步的、且要被 API route 直接 import 调用。

import { db } from "@/db/client";
import { keywords } from "@/db/schema";
import { sql } from "drizzle-orm";

type KeywordRow = typeof keywords.$inferSelect;

export type KeywordStats = {
  total: number;
  scored: number;
  unscored: number;
  protected: number;
  avgSv: number;
  avgCpc: number;
  lastSync: Date | null;
};

const TTL_MS = 60_000;
type ListCache = { data: KeywordRow[]; expiresAt: number };
type StatsCache = { data: KeywordStats; expiresAt: number };
const globalForKeywords = global as typeof globalThis & {
  kwListCache?: ListCache;
  kwStatsCache?: StatsCache;
};

/** 清空列表 + 统计缓存。任何写 keywords 表后调用，使下次读拿到最新数据。 */
export function invalidateKeywordsCache(): void {
  globalForKeywords.kwListCache = undefined;
  globalForKeywords.kwStatsCache = undefined;
}

/** 全表关键词（按创建时间）—— 带缓存。 */
export async function getKeywordsCached(): Promise<KeywordRow[]> {
  const now = Date.now();
  const cached = globalForKeywords.kwListCache;
  if (cached && cached.expiresAt > now) return cached.data;

  const data = await db.select().from(keywords).orderBy(keywords.createdAt);
  globalForKeywords.kwListCache = { data, expiresAt: now + TTL_MS };
  return data;
}

/** 统计指标 —— DB 端聚合（不拉全表），带缓存。
 *  postgres-js 默认把 bigint/numeric 当 string 返回，故用 ::int / ::float8 显式 cast。 */
export async function getKeywordStatsCached(): Promise<KeywordStats> {
  const now = Date.now();
  const cached = globalForKeywords.kwStatsCache;
  if (cached && cached.expiresAt > now) return cached.data;

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      scored: sql<number>`count(*) filter (where ${keywords.bp} is not null and ${keywords.cs} is not null)::int`,
      protectedCount: sql<number>`count(*) filter (where ${keywords.protected} = true)::int`,
      avgSv: sql<number>`coalesce(round(avg(${keywords.searchVolume})), 0)::int`,
      avgCpc: sql<number>`coalesce(avg(${keywords.cpc}), 0)::float8`,
      lastSync: sql<Date | null>`max(${keywords.updatedAt})`,
    })
    .from(keywords);

  const data: KeywordStats = {
    total: row.total,
    scored: row.scored,
    unscored: row.total - row.scored,
    protected: row.protectedCount,
    avgSv: row.avgSv,
    avgCpc: row.avgCpc,
    lastSync: row.lastSync ? new Date(row.lastSync) : null,
  };
  globalForKeywords.kwStatsCache = { data, expiresAt: now + TTL_MS };
  return data;
}
