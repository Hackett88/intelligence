// POST /api/indexing/sync
//
// 流程：
//   1. 校验登录态
//   2. 通过 puppeteer-core 连本地 Chrome (CDP 127.0.0.1:9222)
//   3. 在 GSC Performance > Pages 视图抓页面级 4 指标
//   4. 转换为 PageRow[] + IndexingStats
//   5. 写到 data/gsc-snapshot.json（原子写入）
//   6. revalidatePath('/app/indexing') 让 RSC 重新读取
//   7. 返回统计摘要 + 抓取耗时

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { fetchGscSnapshot, fetchAllPageQueries, type GscQueryRaw } from "@/lib/gsc/fetcher";
import { fetchGa4PageMetrics, ga4PathKey } from "@/lib/gsc/ga4-fetcher";
import { transformGscSnapshot } from "@/lib/gsc/transform";
import { saveSnapshot, type IndexingSnapshotFile } from "@/lib/gsc/store";
import { invalidateSnapshotCache } from "@/lib/gsc/loader";
import {
  saveBatch,
  recordError,
  loadLatestFullBatchBaseline,
  loadLatestBatch,
  loadLatestFullBatch,
  type RealPageRecord,
} from "@/lib/gsc/repository";
import { classifyCadence } from "@/lib/gsc/classify";
import type { QueryRow, Ga4Metrics } from "@/app/app/indexing/_components/_mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 一次同步要逐页抓关键词排名（并发，数百页），耗时可能数分钟 —— 放宽时限。
export const maxDuration = 600;

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";
const QUERY_LIMIT_PER_PAGE = 25;
const QUERY_FETCH_CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  // 部署守卫：GSC 抓取依赖本地 Chrome 调试端口（127.0.0.1:9222），线上没有。
  // 前端已据 NODE_ENV 禁用入口，这里再加一道服务端 403，防止绕过 UI 直接打接口。
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        code: "SYNC_DISABLED_ON_DEPLOY",
        message: "线上环境无法抓取 GSC，请联系管理员在本地执行同步。",
        hint: "GSC 抓取依赖本地浏览器（调试端口 9222），部署环境不具备该条件。",
      },
      { status: 403 }
    );
  }

  // 允许从 body 传入自定义 property（多站点时用得上）+ 同步模式
  //   mode=full  （默认）：爬全部有曝光页 —— 月度全量，刷新"每页关键词数"基准。
  //   mode=daily          ：只爬周期档 = 日更的页（关键词≥6 的核心排名页）。
  //   mode=weekly         ：只爬周期档 = 周更的页（关键词少 + 无关键词的正常内容页）。
  // 周期档由 classifyCadence(关键词数, 页面类型) 决定，基准取最近一次 full 批次。
  let resourceId = DEFAULT_PROPERTY;
  let requestedMode: "full" | "daily" | "weekly" = "full";
  try {
    const body = (await req.json()) as { resourceId?: string; mode?: string };
    if (typeof body?.resourceId === "string" && body.resourceId.trim()) {
      resourceId = body.resourceId.trim();
    }
    if (body?.mode === "daily" || body?.mode === "full" || body?.mode === "weekly") {
      requestedMode = body.mode;
    }
  } catch {
    // 没 body 也行
  }

  const startedAt = Date.now();
  let pgBatchId: number | null = null;
  let pgError: string | null = null;

  let queryFailures = 0;
  let queryFetched = 0;

  try {
    const snapshot = await fetchGscSnapshot({ resourceId });
    const { pages, stats } = transformGscSnapshot(snapshot);

    // ── 批量抓每个真实页的关键词排名（一次同步全部拉好，前端不再逐次点击请求） ──
    // 只抓有曝光的真实页：零曝光页本就没有 query，省去无谓导航。
    const realPages = pages.filter((p) => !p.isSynthetic);
    const withImpr = realPages.filter((p) => p.impressions > 0);

    // 决定本次爬取范围：
    //   full          → 全部有曝光页。
    //   daily / weekly → 仅"周期档 == 该模式"的页（按上次全量的关键词数分档）。
    //                    新页（上次全量没见过）关键词数按 0 计，由 classifyCadence 归档。
    //                    没有任何全量基准时退化为 full，并按 full 落库作为后续增量的基准。
    let effectiveMode: "full" | "daily" | "weekly" = requestedMode;
    let pagesToQuery = withImpr;

    // ── 24h 续跑（Sean 2026-05-27）：点全量时，若最近一次 full 批次在 24h 内且有
    //    关键词抓取失败页 → 不重跑全量，只补失败页，其余沿用上一批（含 GA4）。
    //    保持手动（仍是用户点全量触发）、无新 UI、无自动调度；纯按 24h 窗口默认续跑。
    //    续跑仍以 full 落库（effectiveMode 不变）→ 同日去重会用更完整的新批替换旧的不完整批。
    let isResume = false;
    let resumeBatch: Awaited<ReturnType<typeof loadLatestFullBatch>> = null;
    if (requestedMode === "full") {
      const lastFull = await loadLatestFullBatch();
      const failed = (lastFull?.log.queryFailedUrls as string[] | null | undefined) ?? [];
      const ageMs = lastFull ? Date.now() - new Date(lastFull.log.startedAt).getTime() : Infinity;
      if (lastFull && failed.length > 0 && ageMs <= 24 * 60 * 60 * 1000) {
        isResume = true;
        resumeBatch = lastFull;
        const failedSet = new Set(failed);
        pagesToQuery = withImpr.filter((p) => failedSet.has(p.fullUrl));
        console.log(`[sync/route] 续跑：最近 full 批 ${lastFull.log.id} 在 24h 内有 ${failed.length} 个失败页，本次只补 ${pagesToQuery.length} 页（其余沿用上一批）`);
      }
    }

    if (!isResume && (requestedMode === "daily" || requestedMode === "weekly")) {
      const baseline = await loadLatestFullBatchBaseline();
      if (!baseline) {
        effectiveMode = "full";
        pagesToQuery = withImpr;
      } else {
        pagesToQuery = withImpr.filter((p) => {
          const kwCount = baseline.keywordCounts.get(p.fullUrl) ?? 0;
          return (
            classifyCadence({ pageType: p.pageType, keywordCount: kwCount, url: p.fullUrl }) ===
            requestedMode
          );
        });
      }
    }

    // 未被本次爬取的页要"沿用上一批已有的关键词/GA4 数据"，否则新批次会把它们清空。
    //   · 增量模式（daily/weekly）：沿用最近一批（loadLatestBatch）。
    //   · full 续跑：沿用正在续的那个 full 批（resumeBatch）—— 失败页之外全部照搬。
    //   · 普通 full：全爬，不需要 carry。
    let carry: Map<string, { queries: QueryRow[]; topQuery: string; ga4?: Ga4Metrics }> | null = null;
    if (isResume || effectiveMode !== "full") {
      const latest = isResume ? resumeBatch : await loadLatestBatch();
      if (latest) {
        carry = new Map();
        for (const lp of latest.pages) {
          // 上一批 GA4（flat 列）重建成 Ga4Metrics，供未爬页沿用，避免增量同步清空 GA4
          const prevGa4: Ga4Metrics | undefined =
            lp.ga4ActiveUsers != null
              ? {
                  activeUsers: lp.ga4ActiveUsers,
                  engagementRate: lp.ga4EngagementRate ?? 0,
                  avgEngagementTime: lp.ga4AvgEngagementTime ?? 0,
                  topCountries: lp.ga4TopCountries ?? [],
                }
              : undefined;
          carry.set(lp.fullUrl, { queries: lp.queries, topQuery: lp.topQuery, ga4: prevGa4 });
        }
      }
    }

    const toQuery = new Set(pagesToQuery.map((p) => p.fullUrl));
    let byUrl = new Map<string, GscQueryRaw[]>();
    // 本批关键词抓取真失败的页（网络/限流/超时）。落库后供 24h 内续跑只补这些页。
    // 续跑场景下 pagesToQuery 已是上批失败页，这里得到的是"仍失败"的子集 → 逐次收敛。
    let queryFailedUrls: string[] = [];
    if (pagesToQuery.length > 0) {
      const res = await fetchAllPageQueries(pagesToQuery.map((p) => p.fullUrl), {
        resourceId,
        limit: QUERY_LIMIT_PER_PAGE,
        concurrency: QUERY_FETCH_CONCURRENCY,
      });
      byUrl = res.byUrl;
      queryFailures = res.failures.length;
      queryFailedUrls = res.failures;
    }

    // 统一回填：本次爬过 → 用新结果；增量模式未爬 → 沿用上一批；其余 → 空。
    for (const p of realPages) {
      if (toQuery.has(p.fullUrl)) {
        const qs = byUrl.get(p.fullUrl);
        if (qs && qs.length > 0) {
          p.queries = qs;
          p.topQuery = qs[0].query; // 页面级抓取拿不到主关键词，用榜首词补
          queryFetched++;
        } else {
          p.queries = [];
        }
      } else if (carry) {
        const prev = carry.get(p.fullUrl);
        p.queries = prev?.queries ?? [];
        if (prev?.topQuery && prev.topQuery !== "—") p.topQuery = prev.topQuery;
      } else {
        p.queries = [];
      }
    }

    // ── GA4「进站后」指标（与 GSC 同批次、同档）──────────────────────────────
    // 口径（Sean 拍板）：全渠道、近 28 天、landing_page 维度。范围与 GSC 同档：
    //   full → 全部真实页；daily/weekly → 仅 pagesToQuery 的 path；其余沿用上一批 carry。
    // 独立 try/catch + fetcher 自身不抛：GA4 挂了只留 NULL + 标记降级，绝不拖垮 GSC。
    let ga4Sampled = false;
    let ga4Failed = false;
    let ga4Fetched = 0;
    if (isResume) {
      // 续跑：GA4 此前并未失败，不重拉，全部沿用上一批（只补 GSC 关键词失败页）。
      for (const p of realPages) {
        const prev = carry?.get(p.fullUrl);
        if (prev?.ga4) p.ga4 = prev.ga4;
      }
    } else {
      try {
        const ga4Paths =
          effectiveMode === "full" ? undefined : pagesToQuery.map((p) => p.url);
        const ga4 = await fetchGa4PageMetrics({ pathnames: ga4Paths });
        ga4Failed = ga4.failed;
        ga4Sampled = ga4.sampledAny;
        for (const p of realPages) {
          // p.url 是百分号编码的 pathname；GA4 byPath 以解码后的路径为键 → 必须同款归一再查
          const m = ga4.failed ? undefined : ga4.byPath.get(ga4PathKey(p.url));
          if (m) {
            p.ga4 = {
              activeUsers: m.activeUsers,
              engagementRate: m.engagementRate,
              avgEngagementTime: m.avgEngagementTime,
              topCountries: m.topCountries,
            };
            ga4Fetched++;
          } else if (carry) {
            // 本次未爬到（增量档未选中 / 失配 / GA4 整体失败）→ 沿用上一批 GA4，不清空
            const prev = carry.get(p.fullUrl);
            if (prev?.ga4) p.ga4 = prev.ga4;
          }
        }
      } catch (e) {
        ga4Failed = true;
        console.error("[sync/route] GA4 fetch failed (GSC unaffected):", (e as Error).message);
      }
    }

    // PG 写入：只存"真实页"（不含合成节点）；transaction 内开 batch + 批量插页
    const realRows: RealPageRecord[] = realPages.map((p) => ({
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
        queries: p.queries ?? [],
        isPillar: !!p.isPillar,
        sortOrder: p.sortOrder,
        // GA4 进站后指标（迁移 0012）—— 没拉到则全 null，列 DEFAULT NULL
        ga4ActiveUsers: p.ga4?.activeUsers ?? null,
        ga4EngagementRate: p.ga4?.engagementRate ?? null,
        ga4AvgEngagementTime: p.ga4?.avgEngagementTime ?? null,
        ga4TopCountries: p.ga4?.topCountries ?? null,
        ga4Sampled: p.ga4 ? ga4Sampled : null,
      }));
    try {
      pgBatchId = await saveBatch(
        {
          property: snapshot.propertyResourceId,
          freshnessText: snapshot.summary.freshnessText || undefined,
          mode: effectiveMode,
          totalPages: stats.totalPages,
          totalClicks: stats.totalClicks,
          totalImpressions: stats.totalImpressions,
          avgCtr: stats.avgCtr,
          avgPosition: stats.avgPosition,
          top10Pages: stats.top10Pages,
          queryFailedUrls, // 持久化失败页 → 24h 内续跑只补这些；空数组=完整批次（saveBatch 落 null）
        },
        realRows
      );
    } catch (e) {
      // PG 写失败不阻断：JSON 兜底依然落地，前端会收到 degraded 标记
      pgError = e instanceof Error ? e.message : String(e);
      console.error("[sync/route] PG saveBatch failed (continuing with JSON fallback):", pgError);
    }

    // JSON 兜底（永远写）：保留与原逻辑一致的格式
    const file: IndexingSnapshotFile = {
      version: 1,
      fetchedAt: snapshot.fetchedAt,
      propertyResourceId: snapshot.propertyResourceId,
      freshnessText: snapshot.summary.freshnessText || undefined,
      stats,
      pages,
    };
    await saveSnapshot(file);

    // 清掉 loader 的内存快照缓存 —— 否则"更新"后页面仍读旧缓存，要等 TTL 才刷新。
    invalidateSnapshotCache();
    // 让 /app/indexing 的 RSC 在下次请求时重新跑（loader 优先 PG，degraded 时降级 JSON）
    revalidatePath("/app/indexing");

    return NextResponse.json({
      ok: true,
      property: snapshot.propertyResourceId,
      fetchedAt: snapshot.fetchedAt,
      durationMs: Date.now() - startedAt,
      pgBatchId,
      mode: effectiveMode,
      requestedMode,
      // 续跑：本次是否走了 24h 续跑（只补失败页）+ 落库后仍失败的页数（>0 → 下次点全量会继续补）
      resume: isResume ? { active: true, retried: pagesToQuery.length, stillFailed: queryFailedUrls.length } : undefined,
      pagesQueried: pagesToQuery.length,
      queryFetched,
      queryFailures,
      // GA4 采集状态：fetched=本次成功合入的页数；failed=整体降级（字段沿用上批/留空）；sampled=被采样近似
      ga4: { fetched: ga4Fetched, failed: ga4Failed, sampled: ga4Sampled },
      degraded: pgError ? { reason: "PG_WRITE_FAILED", message: pgError } : undefined,
      stats: {
        totalPages: stats.totalPages,
        totalClicks: stats.totalClicks,
        totalImpressions: stats.totalImpressions,
        avgCtr: stats.avgCtr,
        avgPosition: stats.avgPosition,
        top10Pages: stats.top10Pages,
      },
      freshnessText: snapshot.summary.freshnessText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    const isCdpConnRefused = /ECONNREFUSED|connect ENOENT|failed to connect/i.test(
      message
    );

    // 记录失败到 sync_log（不阻断响应；PG 不可用就放弃记录）
    try {
      await recordError({
        code: isCdpConnRefused ? "CDP_UNAVAILABLE" : "SYNC_FAILED",
        message,
        property: resourceId,
      });
    } catch (e) {
      console.warn("[sync/route] recordError to PG failed:", (e as Error).message);
    }

    return NextResponse.json(
      {
        ok: false,
        code: isCdpConnRefused ? "CDP_UNAVAILABLE" : "SYNC_FAILED",
        message,
        hint: isCdpConnRefused
          ? "无法连接本地 Chrome 调试端口 (127.0.0.1:9222)。请确认 Chrome 已以 --remote-debugging-port=9222 启动，并已登录 Search Console。"
          : "GSC 抓取失败。请确认浏览器已登录 weslamic.com 的 Search Console 资源。",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    );
  }
}
