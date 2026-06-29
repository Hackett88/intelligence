// GSC「更新（流量）」共享核心 —— 走官方 Search Analytics API 服务端直拉最近 60 天 per-page 流量，
// 落 PG 批次（桥与展示自动用上），并做旧址 60 天退休。供路由与应用内定时器复用。
//
// 这里只放「鉴权之后」的纯流量更新逻辑：拉数 → 归并 pathname → 转 RealPageRecord → saveBatch → 退休。
// 刻意【不含】：鉴权、NextResponse、revalidatePath、500 包装 —— 这些留在路由层。
// 风格与 run-inspection.ts 一致：鉴权/未配类错误走 summary.code 透传（不抛）；非预期错误
// （DB 写失败）直接抛出（路由 catch 成 500；定时器 catch 成 console.error）。
// 退休图落盘失败是 best-effort（吞掉 + warn），不让"已成功的流量更新"暴露成 500。
//
// apiOnly：给定时器用。true 且未配官方 API → 直接返回空 summary，连 API 都不调。
//
// 退休口径（关键洞察）：用单一 60 天窗口拉流量 —— 某旧址若 60 天静默，它在这个窗口里本就贡献 0，
// 退休它对显示数字零影响。故退休纯属"重定向图清洁 + 进度信号"，无需持久化/新退休表，
// 生产临时文件系统重置也每轮自愈。

import { fetchSearchAnalytics, fetchPageDaily, isGscApiConfigured, type SAQueryRow } from "./search-analytics-api-fetcher";
import { saveBatch, type RealPageRecord } from "./repository";
import { invalidateSnapshotCache } from "./loader";
import { inferMarket, inferPageType, inferCluster, inferIsPillar } from "./transform";
import { loadRedirectMap, saveRedirectMap } from "./redirect-map";
import { upsertPageDaily } from "./page-daily-store";
import { db } from "@/db/client";
import { gscPageDaily } from "@/db/schema";
import { sql, and, gte, lte } from "drizzle-orm";

// 路由/定时器拿到的统计体。code/error 仅在「未配 key」或「已配但授权失败」错误态出现，
// 由路由据此转 400；成功态二者恒为 undefined（JSON 自动省略）。
export interface TrafficUpdateSummary {
  ok: boolean;
  via: "api";
  pages: number;
  totalClicks: number;
  totalImpressions: number;
  retiredThisRun: number;
  retiredTotal: number;
  durationMs: number;
  code?: string;
  error?: string;
  // T2：本轮写入 gsc_page_daily 的去重后行数（best-effort，失败为 0，不影响主更新）。
  dailyRows?: number;
}

// 便于日后调整的常量。
const DAY = 86_400_000;
const DISPLAY_WINDOW_DAYS = 60; // 流量展示/拉取窗口（最近 60 天）
const RETIRE_SILENCE_DAYS = 60; // 旧址静默多少天 → 退休（与展示窗口同 60，故静默址在窗口里本就 0）
// GSC 数据延迟：实测本属性最新数据约到 today-2（Google 自身处理延迟，全站通用、改不了）。
// end 取 today-1 即可吃满 GSC 现有最新（GSC 本就没有"今天"的数据，取更小无意义）；
// 不取 0 只为躲开极偶发的"今天"半截数据。window = [end-60d, end]。
const GSC_LAG_DAYS = 1;
// 每日明细回拉窗口：每轮重拉最近 90 天 page×date 落 gsc_page_daily（覆盖式 UPSERT）。
// 比 60 天展示窗口宽，给"新页完整积累 + 切更长窗口"留地基，并自我修正 GSC 延迟。
const DAILY_PULL_DAYS = 90;

// Date → "YYYY-MM-DD"（GSC Search Analytics 要求的日期格式）。
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 完整 URL → pathname（解析失败回退原串）。
function toPath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

// 聚合一组关键词（同 query 串合并、曝光加权 ctr/position），按 clicks 降序取 Top 50。
// 用于 pathname 归并时把塌缩到一起的多个 URL 的关键词合一。
function mergeQueries(qs: SAQueryRow[]): SAQueryRow[] {
  if (qs.length === 0) return [];
  const m = new Map<string, { clicks: number; impressions: number; ctrSum: number; posSum: number }>();
  for (const q of qs) {
    if (!q?.query) continue;
    let e = m.get(q.query);
    if (!e) {
      e = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0 };
      m.set(q.query, e);
    }
    e.clicks += q.clicks;
    e.impressions += q.impressions;
    e.ctrSum += q.ctr * q.impressions;
    e.posSum += q.position * q.impressions;
  }
  const out = [...m.entries()].map(([query, e]) => ({
    query,
    clicks: e.clicks,
    impressions: e.impressions,
    ctr: e.impressions > 0 ? e.ctrSum / e.impressions : 0,
    position: e.impressions > 0 ? e.posSum / e.impressions : 0,
  }));
  out.sort((a, b) => b.clicks - a.clicks);
  return out.slice(0, 50);
}

/**
 * 流量更新核心（鉴权之外的全部逻辑）。
 *
 * @param opts.apiOnly 默认 false。true 时若未配官方 API → 直接返回空 summary（不碰任何 API），给定时器用。
 */
export async function runTrafficUpdateCore(
  opts?: { apiOnly?: boolean }
): Promise<TrafficUpdateSummary> {
  const apiOnly = opts?.apiOnly ?? false;
  const startedAt = Date.now();
  const apiConfigured = isGscApiConfigured();

  // apiOnly 守卫：强制 API-only 但未配 key → 直接空返回，绝不调任何 API（给定时器兜底）。
  if (apiOnly && !apiConfigured) {
    return emptyOk(startedAt);
  }

  // 单一 60 天窗口：end = today - GSC_LAG_DAYS，start = end - DISPLAY_WINDOW_DAYS。
  const end = new Date(Date.now() - GSC_LAG_DAYS * DAY);
  const start = new Date(end.getTime() - DISPLAY_WINDOW_DAYS * DAY);
  const startDate = ymd(start);
  const endDate = ymd(end);

  // ── 1) 先拉每日明细并落库（gsc_page_daily）──────────────────────────────────
  // 新流程把每日表升为页级指标的【唯一来源】：先拉 DAILY_PULL_DAYS 天 page×date → UPSERT，
  // 再从表里按 60 天窗口求和算页级指标。T2 已证「每日明细按窗口求和」== 旧的 per-page 单批拉取
  // （逐项一分不差），故去掉旧的 ["page"] 那一趟批量拉取（冗余），每轮批量拉取从 3 次降到 2 次。
  //
  // 这一步是 load-bearing：其取数三态（未配/授权失败/可用）即整个更新的鉴权闸门，与旧版
  // fetchSearchAnalytics 同口径透传给路由（NOT_CONFIGURED / NOT_AUTHORIZED → 400）。
  const dailyEnd = new Date(Date.now() - GSC_LAG_DAYS * DAY);
  const dailyStart = new Date(dailyEnd.getTime() - DAILY_PULL_DAYS * DAY);
  const daily = await fetchPageDaily({ startDate: ymd(dailyStart), endDate: ymd(dailyEnd) });

  // 未配置服务账号。apiOnly 已在上面提前返回（configured 与 isGscApiConfigured 同口径），
  // 故此分支仅在路由调用且未配时进入 → 返回 NOT_CONFIGURED（路由转 400）。
  if (!daily.configured) {
    if (apiOnly) return emptyOk(startedAt);
    return {
      ok: false,
      via: "api",
      pages: 0,
      totalClicks: 0,
      totalImpressions: 0,
      retiredThisRun: 0,
      retiredTotal: 0,
      durationMs: Date.now() - startedAt,
      code: "GSC_API_NOT_CONFIGURED",
      error: "未配置官方 API（GSC_SA_KEY_JSON / GSC_SA_KEY_FILE）",
    };
  }

  // 配了 key 但鉴权/授权失败 → 透传给路由转 400（让前端 toast 指引去 GSC 加用户），不静默吞掉。
  if (daily.error) {
    return {
      ok: false,
      via: "api",
      pages: 0,
      totalClicks: 0,
      totalImpressions: 0,
      retiredThisRun: 0,
      retiredTotal: 0,
      durationMs: Date.now() - startedAt,
      code: "GSC_API_NOT_AUTHORIZED",
      error: daily.error,
    };
  }

  // 落库：每日表现在是页级指标的来源，UPSERT 失败直接抛（路由→500 / 定时器→console.error），
  // 不再 best-effort 吞掉 —— 因为后续整个批次都从这张表求和而来。
  let dailyRows = 0;
  if (daily.rows.length > 0) {
    dailyRows = await upsertPageDaily(daily.rows);
    console.log(`[run-traffic-update] gsc_page_daily UPSERT ${dailyRows} 行（${DAILY_PULL_DAYS} 天 page×date）`);
  }

  // ── 2) 只拉关键词（dimensions:["page","query"]，跳过 ["page"]）──────────────────
  // queriesOnly 让 fetcher 省掉 ["page"] 那一趟；这里只取每页关键词，页级指标不用它。
  const res = await fetchSearchAnalytics({ startDate, endDate, queriesOnly: true });
  if (res.error) {
    return {
      ok: false,
      via: "api",
      pages: 0,
      totalClicks: 0,
      totalImpressions: 0,
      retiredThisRun: 0,
      retiredTotal: 0,
      durationMs: Date.now() - startedAt,
      code: "GSC_API_NOT_AUTHORIZED",
      error: res.error,
    };
  }

  // 关键词按 pathname 归组（同 pathname 的多个完整 URL 的关键词合一），稍后挂到对应页。
  const queriesByPath = new Map<string, SAQueryRow[]>();
  for (const p of res.pages) {
    if (!p.queries?.length) continue;
    const pathname = toPath(p.url);
    let arr = queriesByPath.get(pathname);
    if (!arr) {
      arr = [];
      queriesByPath.set(pathname, arr);
    }
    arr.push(...p.queries);
  }

  // ── 3) 页级指标从每日表按 60 天窗口求和（与旧 per-page 单批拉取等价）──────────────
  // 直接查 gsc_page_daily：按 url_norm 分组求和 clicks/impressions/sum_position，并带回一个
  // 代表性 full_url（MAX 仅取确定性代表，只影响展示用 fullUrl，不影响指标）用于反推 pathname。
  // 窗口 [startDate, endDate] 与上方 60 天展示窗口完全一致。ctr 由 clicks/impressions 还原
  // （GSC 的 ctr 定义即 clicks/impressions，与旧 per-page 完全等价）；position 由 Σ(pos*impr)/Σimpr
  // 还原（每日表 sum_position 即 Σ(pos*impr)/天，T2 已证窗口求和 == per-page 的 position）。
  const aggRows = await db
    .select({
      urlNorm: gscPageDaily.urlNorm,
      fullUrl: sql<string>`MAX(${gscPageDaily.fullUrl})`,
      clicks: sql<string>`SUM(${gscPageDaily.clicks})`,
      impressions: sql<string>`SUM(${gscPageDaily.impressions})`,
      sumPos: sql<string>`SUM(${gscPageDaily.sumPosition})`,
    })
    .from(gscPageDaily)
    .where(and(gte(gscPageDaily.date, startDate), lte(gscPageDaily.date, endDate)))
    .groupBy(gscPageDaily.urlNorm);

  // 转换 → 按 pathname 归并。
  // 关键：每日表按 url_norm 聚合，不同完整 URL 可能塌缩到同一 pathname（http/https、www、
  // 末尾斜杠、query 串等变体）—— 而 gsc_pages 有 uniqueIndex(batch_id, url=pathname)，同 pathname
  // 多行会撞唯一约束（曾致 saveBatch 500）。故先按 pathname 归并（clicks/impr 相加、position 曝光
  // 加权），再落库。归并对桥也更正确（同 pathname = 同页，流量本就该相加）。
  // 同时收集本窗口"仍活着"的 url_norm 集（clicks>0 或 impr>0）供旧址退休判定（取代旧的 res.pages 口径）。
  interface MergedPage {
    fullUrl: string;
    clicks: number;
    impressions: number;
    sumPos: number; // Σ position * impressions
  }
  const byPath = new Map<string, MergedPage>();
  const aliveNorms = new Set<string>();
  for (const r of aggRows) {
    const clicks = Number(r.clicks) || 0;
    const impressions = Number(r.impressions) || 0;
    const sumPos = Number(r.sumPos) || 0;
    if (clicks > 0 || impressions > 0) aliveNorms.add(r.urlNorm);
    const pathname = toPath(r.fullUrl);
    let g = byPath.get(pathname);
    if (!g) {
      g = { fullUrl: r.fullUrl, clicks: 0, impressions: 0, sumPos: 0 };
      byPath.set(pathname, g);
    }
    g.clicks += clicks;
    g.impressions += impressions;
    g.sumPos += sumPos;
  }

  const realRows: RealPageRecord[] = [...byPath.entries()]
    .map(([pathname, g]) => ({ pathname, g }))
    .sort((a, b) => b.g.clicks - a.g.clicks)
    .map(({ pathname, g }, i) => {
      const queries = mergeQueries(queriesByPath.get(pathname) ?? []);
      return {
        url: pathname,
        fullUrl: g.fullUrl,
        market: inferMarket(pathname),
        pageType: inferPageType(pathname),
        cluster: inferCluster(pathname),
        topQuery: queries[0]?.query ?? "—",
        clicks: g.clicks,
        impressions: g.impressions,
        ctr: g.impressions > 0 ? g.clicks / g.impressions : 0,
        position: g.impressions > 0 ? g.sumPos / g.impressions : 0,
        indexState: "indexed", // gsc_pages 占位列，桥不读它
        trend12m: [],
        queries,
        isPillar: inferIsPillar(pathname),
        sortOrder: i,
        // GA4 列：流量更新不拉 GA4 → 全 null（前端走"无数据"分支）。
        ga4ActiveUsers: null,
        ga4EngagementRate: null,
        ga4AvgEngagementTime: null,
        ga4TopCountries: null,
        ga4Sampled: null,
      };
    });

  // 统计：totalClicks/totalImpressions 求和；avgCtr=clicks/impr（impr>0 否则 0）；
  // avgPosition = 有曝光页的 position 简单均值（保留 1 位）；top10 = position∈[1,10] 的页数。
  let totalClicks = 0;
  let totalImpressions = 0;
  let posSum = 0;
  let posCount = 0;
  let top10Pages = 0;
  for (const r of realRows) {
    totalClicks += r.clicks;
    totalImpressions += r.impressions;
    if (r.impressions > 0) {
      posSum += r.position;
      posCount += 1;
    }
    if (r.position >= 1 && r.position <= 10) top10Pages += 1;
  }
  const totalPages = realRows.length;
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgPosition = posCount > 0 ? parseFloat((posSum / posCount).toFixed(1)) : 0;

  // 0 页守卫：SA 病态返回 0 页（活站 60 天窗口几乎不可能）→ 跳过落库，
  // 避免空批次经"同日同 mode 去重"把现有好批次替换掉、抹掉展示数据。
  if (totalPages === 0) {
    console.warn("[run-traffic-update] SA 返回 0 页，跳过落库（避免空批次覆盖现有数据）");
    return {
      ok: true,
      via: "api",
      pages: 0,
      totalClicks: 0,
      totalImpressions: 0,
      retiredThisRun: 0,
      retiredTotal: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // 落库：PG 批次即桥的数据源（不写 JSON 镜像）；写完失效快照缓存，页面立即读到新批次。
  await saveBatch(
    {
      property: "sc-domain:weslamic.com",
      mode: "full",
      totalPages,
      totalClicks,
      totalImpressions,
      avgCtr,
      avgPosition,
      top10Pages,
    },
    realRows
  );
  invalidateSnapshotCache();

  // ── 旧址 60 天退休 ──────────────────────────────────────────────────────────
  // retiredTotal = 当前 map 里值为 null 的条目数（含历史孤儿 404 + 历史/本轮退休），简化口径。
  const map = await loadRedirectMap();
  const byOldUrl = map.byOldUrl;
  const preNullCount = Object.values(byOldUrl).filter((v) => v === null).length;

  // 健康守卫：仅在本次 pull 健康（已配 && 无错误 && 总点击>0）时才退休，
  // 避免空结果/瞬时抖动 pull 把还活着的旧址误退。
  let retiredThisRun = 0;
  let retiredTotal = preNullCount;
  const healthy = apiConfigured && !res.error && totalClicks > 0;
  if (healthy) {
    // 本窗口里仍"活着"的旧址归一化集合（clicks>0 或 impr>0）—— 直接用上面从每日表聚合时
    // 收集的 aliveNorms（key 即 url_norm == normalizeForMatch 口径），取代旧的 res.pages 口径。

    const retiredSamples: string[] = [];
    for (const [oldNorm, newNorm] of Object.entries(byOldUrl)) {
      // 真·迁移条目（非自映射、非已退休）；该旧址本窗口静默 → 退休（置 null）。
      if (newNorm && newNorm !== oldNorm && !aliveNorms.has(oldNorm)) {
        byOldUrl[oldNorm] = null;
        retiredThisRun += 1;
        if (retiredSamples.length < 5) retiredSamples.push(oldNorm);
      }
    }

    if (retiredThisRun > 0) {
      // 退休是「重定向图清洁」，best-effort：落盘失败不该让"已成功的流量更新"暴露成 500。
      try {
        await saveRedirectMap(byOldUrl);
        retiredTotal = preNullCount + retiredThisRun;
        console.log(
          `[run-traffic-update] 退休 ${retiredThisRun} 个 ${RETIRE_SILENCE_DAYS} 天静默旧址：${retiredSamples.join(", ")}`
        );
      } catch (e) {
        console.warn(
          "[run-traffic-update] 退休图落盘失败（不影响本次更新）:",
          e instanceof Error ? e.message : e
        );
        retiredThisRun = 0;
        retiredTotal = preNullCount;
      }
    }
  }

  return {
    ok: true,
    via: "api",
    pages: totalPages,
    totalClicks,
    totalImpressions,
    retiredThisRun,
    retiredTotal,
    durationMs: Date.now() - startedAt,
    dailyRows,
  };
}

// 空成功 summary（apiOnly 未配 key 的兜底返回）。
function emptyOk(startedAt: number): TrafficUpdateSummary {
  return {
    ok: true,
    via: "api",
    pages: 0,
    totalClicks: 0,
    totalImpressions: 0,
    retiredThisRun: 0,
    retiredTotal: 0,
    durationMs: Date.now() - startedAt,
  };
}
