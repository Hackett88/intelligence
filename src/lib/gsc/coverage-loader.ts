// 收录覆盖加载器 —— 以新站 sitemap 为行集 + 收录状态 JSON 为数据源。
//
// 产出与 LoadedSnapshot 同形的结构，供 page.tsx 直接替换 loadLatestSnapshot()。
// 行集 = sitemap 57 页（权威名单）；收录态 = gsc-index-status.json（种子 + 逐步补查）。
// 性能数据（clicks/impr/ctr/position）：迁站后旧址真实 GSC 流量按 301/308 重定向归并到
// 对应新页 —— 取旧真实页（loadLatestSnapshot）+ 重定向映射（loadRedirectMap），按曝光加权
// 还原 ctr/position（数据量守恒）。命不中重定向、或旧快照缺失时该页保持 0（诚实空态）。

import type { PageRow, IndexingStats, IndexState, QueryRow } from "@/app/app/indexing/_components/_mock";
import { fetchSitemapPages } from "./sitemap";
import { loadIndexStatus } from "./index-status-store";
import { normalizeForMatch } from "./url-normalize";
import {
  inferMarket,
  inferPageType,
  inferCluster,
  inferIsPillar,
  synthesizeDirNodes,
  buildParentMap,
} from "./transform";
import { loadLatestSnapshot, type LoadedSnapshot } from "./loader";
import { loadRedirectMap } from "./redirect-map";
import { isHardNonContent } from "./classify";
import { loadSnapshot } from "./store";
import { loadDailyAggregates, type DailyAggregate } from "./page-daily-store";

// ── 桥排除名单（全新板块不继承旧流量）────────────────────────────────────────
// 迁站后【全新建】的板块：它们不是任何旧页的继承者，旧址 308 兜底到这里属"清理式重定向"，
// 不该把旧内容的流量/关键词算到这些新页头上（否则虚增）。桥遇到目标命中这些前缀时跳过归并。
// 口径：newNorm 形如 "weslamic.com/islamic-gifts/..."；精确前缀匹配（不误伤同前缀的别的页）。
// 增减板块只改这一处。
const BRIDGE_EXCLUDE_PREFIXES = [
  "weslamic.com/islamic-gifts", // 全新礼物板块（含子页）
  "weslamic.com/guides",        // 全新指南板块（含子页）
];
function isBridgeExcluded(newNorm: string): boolean {
  return BRIDGE_EXCLUDE_PREFIXES.some((p) => newNorm === p || newNorm.startsWith(p + "/"));
}

/** 旧址按重定向归并到新页的指标累加器（曝光加权 ctr/position）。 */
interface MergedMetric {
  clicks: number;
  impressions: number;
  ctrSum: number; // Σ ctr * impressions
  posSum: number; // Σ position * impressions
}

/**
 * 取旧址流量 + 重定向映射，构建「纯归并」Map<newNorm, MergedMetric>（按窗口 windowDays 天）。
 *
 * T4：本函数只算**旧址按 308 归并继承来的流量（bridged）**——循环里跳过自映射
 * （urlNorm === newNorm），因为自映射是新页**自身**的流量（own），由 loadCoveragePages 直接
 * 从 dailyAgg 取，不该混入归并口径。
 *
 * 优先读 gsc_page_daily 的「按窗口求和」（loadDailyAggregates）。调用方可把已取的 dailyAgg 传进
 * preloadedDaily 避免重复查。每日表为空 / 不可用（null）→ 回退 loadLatestSnapshot 批次路径，
 * 批次路径**不做 own/bridged 拆分**（含自映射，返回的就是 total），故返回 splitAvailable=false，
 * 让调用方退化为"只填 total、不带 trafficSplit"，**保证现状不被破坏**。
 *
 * 返回：{ merged, splitAvailable }
 *   · splitAvailable=true（daily 路径）→ merged 是纯 bridged，调用方 own 另取、total=own+bridged。
 *   · splitAvailable=false（批次回退）→ merged 是含自映射的 total，调用方直接当 total 用、不拆分。
 */
async function buildMergedMetrics(
  windowDays = 60,
  preloadedDaily?: Map<string, DailyAggregate> | null,
): Promise<{ merged: Map<string, MergedMetric>; splitAvailable: boolean }> {
  // ── 优先路径：每日明细按窗口求和（纯归并：排除自映射）──
  try {
    const daily =
      preloadedDaily !== undefined ? preloadedDaily : await loadDailyAggregates(windowDays, 1);
    if (daily && daily.size > 0) {
      const redirectFile = await loadRedirectMap();
      const byOldUrl = redirectFile.byOldUrl;
      const merged = new Map<string, MergedMetric>();
      for (const [urlNorm, agg] of daily) {
        // 资产/系统页：本就该 noindex，其流量不算任何内容页的迁移流量（url_norm 即可判，
        // SYSTEM_PAGE_RE / ASSET_URL_RE 都是路径级、大小写无关）。
        if (isHardNonContent({ url: urlNorm })) continue;
        const newNorm = byOldUrl[urlNorm]; // url_norm 即 byOldUrl 的 key 格式
        if (!newNorm) continue; // null / 无映射 → 孤儿流量，丢弃
        if (urlNorm === newNorm) continue; // 自映射 = 新页自身流量(own)，不算归并(bridged)
        if (isBridgeExcluded(newNorm)) continue; // 全新板块：不继承旧址流量
        let acc = merged.get(newNorm);
        if (!acc) {
          acc = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0 };
          merged.set(newNorm, acc);
        }
        acc.clicks += agg.clicks;
        acc.impressions += agg.impressions;
        // 原口径 ctr=clicks/impr，故 Σ(ctr*impr) == Σclicks == clicks；每日表未存 ctr，
        // 用 clicks 等价累加，最终 ctr=ctrSum/impr 与批次路径完全一致。
        acc.ctrSum += agg.clicks;
        // 每日表 sum_position 已是 Σ(position*impressions) 当天，跨天直接累加即窗口加权分子。
        acc.posSum += agg.sumPos;
      }
      return { merged, splitAvailable: true };
    }
  } catch (e) {
    console.warn("[coverage-loader] 每日聚合路径失败，回退批次:", (e as Error).message);
  }

  // ── 回退路径：原 loadLatestSnapshot 批次聚合（含自映射=total，不拆分，保持现状）──
  return { merged: await buildMergedMetricsFromBatch(), splitAvailable: false };
}

/**
 * 回退：从最新批次（loadLatestSnapshot 的 per-page 聚合）+ 重定向映射构建归并指标。
 * 每日表空/不可用时走这里——即 T2 之前的原始逻辑，原样保留。
 */
async function buildMergedMetricsFromBatch(): Promise<Map<string, MergedMetric>> {
  const merged = new Map<string, MergedMetric>();
  try {
    const [oldSnapshot, redirectFile] = await Promise.all([
      loadLatestSnapshot(),
      loadRedirectMap(),
    ]);
    if (!oldSnapshot) return merged; // 旧快照不可用 → 退化全 0
    const byOldUrl = redirectFile.byOldUrl;
    for (const op of oldSnapshot.pages) {
      if (op.isSynthetic) continue; // 只归并旧"真实页"
      // 资产(/cdn、图片等)/系统页(/cart、/search、/checkout、认证…)本就该 noindex，
      // 其旧址流量不算任何内容页(尤其首页)的迁移流量，剔除避免内容页虚胖。
      if (isHardNonContent({ url: op.fullUrl })) continue;
      const newNorm = byOldUrl[normalizeForMatch(op.fullUrl)];
      if (!newNorm) continue; // null / 无映射 → 孤儿流量，丢弃
      if (isBridgeExcluded(newNorm)) continue; // 全新板块：不继承旧址流量
      let acc = merged.get(newNorm);
      if (!acc) {
        acc = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0 };
        merged.set(newNorm, acc);
      }
      acc.clicks += op.clicks;
      acc.impressions += op.impressions;
      acc.ctrSum += op.ctr * op.impressions;
      acc.posSum += op.position * op.impressions;
    }
  } catch (e) {
    console.warn("[coverage-loader] 旧址流量归并跳过:", (e as Error).message);
  }
  return merged;
}

/**
 * 取旧真实页的关键词（queries），按 301/308 重定向归并到新页，构建 Map<newNorm, QueryRow[]>。
 * 与 buildMergedMetrics 同源同口径（跳过 isSynthetic / isHardNonContent / null 映射）。
 * query 按字符串聚合（同词的多旧址流量相加），曝光加权还原 ctr/position，按 clicks 降序取 Top 50。
 *
 * queries 源：优先用快照自带（loadLatestSnapshot 的 PG/JSON 路径都带 queries）；
 * 若整体取不到（防御：某天 PG 路径丢了 queries），从 JSON 快照按 fullUrl 兜底取。
 */
async function buildMergedQueries(): Promise<Map<string, QueryRow[]>> {
  const out = new Map<string, QueryRow[]>();
  try {
    const [oldSnapshot, redirectFile] = await Promise.all([
      loadLatestSnapshot(),
      loadRedirectMap(),
    ]);
    if (!oldSnapshot) return out; // 旧快照不可用 → 空（下游每页 queries:[]）
    const byOldUrl = redirectFile.byOldUrl;
    const oldReal = oldSnapshot.pages.filter((p) => !p.isSynthetic);

    // 防御：快照若整体不带 queries，回退 JSON 快照按 fullUrl 取（JSON pages[].queries 必有）
    let queriesByFullUrl: Map<string, QueryRow[]> | null = null;
    if (!oldReal.some((p) => (p.queries?.length ?? 0) > 0)) {
      const jsonSnap = await loadSnapshot();
      if (jsonSnap) {
        queriesByFullUrl = new Map(jsonSnap.pages.map((p) => [p.fullUrl, p.queries ?? []]));
      }
    }

    // newNorm → (queryString → 聚合)
    const acc = new Map<string, Map<string, { clicks: number; impressions: number; posSum: number }>>();
    for (const op of oldReal) {
      if (isHardNonContent({ url: op.fullUrl })) continue; // 与点击归并一致：资产/系统页不归并
      const newNorm = byOldUrl[normalizeForMatch(op.fullUrl)];
      if (!newNorm) continue; // 孤儿映射，跳过
      if (isBridgeExcluded(newNorm)) continue; // 全新板块：不继承旧址关键词
      const qs = queriesByFullUrl ? queriesByFullUrl.get(op.fullUrl) ?? [] : op.queries ?? [];
      if (qs.length === 0) continue;
      let qmap = acc.get(newNorm);
      if (!qmap) {
        qmap = new Map();
        acc.set(newNorm, qmap);
      }
      for (const q of qs) {
        if (!q?.query) continue;
        let e = qmap.get(q.query);
        if (!e) {
          e = { clicks: 0, impressions: 0, posSum: 0 };
          qmap.set(q.query, e);
        }
        e.clicks += q.clicks;
        e.impressions += q.impressions;
        e.posSum += q.position * q.impressions; // 曝光加权
      }
    }

    // 收口：每 newNorm → QueryRow[]，曝光加权 ctr/position，clicks 降序，Top 50
    for (const [newNorm, qmap] of acc) {
      const rows: QueryRow[] = Array.from(qmap.entries()).map(([query, e]) => ({
        query,
        clicks: e.clicks,
        impressions: e.impressions,
        ctr: e.impressions > 0 ? e.clicks / e.impressions : 0,
        position: e.impressions > 0 ? e.posSum / e.impressions : 0,
      }));
      rows.sort((a, b) => b.clicks - a.clicks);
      out.set(newNorm, rows.slice(0, 50));
    }
  } catch (e) {
    console.warn("[coverage-loader] 关键词归并跳过:", (e as Error).message);
  }
  return out;
}

function emptyTrend(): number[] {
  return new Array(12).fill(0);
}

/**
 * 由 coverageText（Google 原话）派生中文短标，供 UI 显示。小写 includes 模糊匹配（官方
 * coverageState 是自由文案，绝不全等）。两个数据源：① 官方 API 的英文 coverageState
 * （如 "Discovered - currently not indexed"）；② 会话法的中文裁决（如 "网址已收录到 Google"，
 * 见 index-inspection-fetcher 的 VERDICT_PHRASES）—— 故先认中文裁决再认英文文案。
 * 命不中任何已知模式但非空 → 原样返回 coverageText；空/未定义 → undefined。
 */
function coverageLabelFromText(t?: string): string | undefined {
  if (!t || !t.trim()) return undefined;
  const s = t.toLowerCase();

  // ── 会话法中文裁决（无英文 coverageState，只有 indexed/not 的整句）──
  // 先判"未收录"：中文"未收录"亦含"收录"二字，必须先于"已收录"判，避免误命中。
  if (t.includes("网址未收录") || t.includes("网址不在 Google")) return "未收录";
  if (t.includes("网址已收录") || t.includes("已显示在 Google 搜索结果中")) return "已收录";

  // ── 官方 API 英文 coverageState（按下表模糊匹配）──
  if (s.includes("submitted and indexed") || (s.includes("indexed") && !s.includes("not indexed")))
    return "已收录";
  if (s.includes("crawled - currently not indexed")) return "已抓取·未收录";
  if (s.includes("discovered - currently not indexed")) return "已发现·未收录";
  if (s.includes("unknown to google")) return "Google 未发现";
  if (s.includes("server error") || s.includes("5xx")) return "服务器错误(5xx)";
  if (s.includes("redirect")) return "重定向页";
  if (s.includes("not found") || s.includes("404")) return "404 未找到";
  if (s.includes("blocked") || s.includes("robots")) return "被 robots 拦截";
  if (s.includes("noindex")) return "noindex 标记";
  if (s.includes("duplicate")) return "重复页";
  if (s.includes("alternate")) return "备用页(canonical 在别处)";

  return t; // 其它非空 → 原样返回
}

/**
 * 从 sitemap + index-status 构建完整 PageRow[] + stats。
 * 返回与 LoadedSnapshot 同形（pages/stats/source/...），额外带 indexedCount。
 */
export async function loadCoveragePages(windowDays = 90): Promise<
  (LoadedSnapshot & { indexedCount: number }) | null
> {
  // 并行加载 sitemap 和收录状态
  let sitemapPages: Awaited<ReturnType<typeof fetchSitemapPages>>;
  try {
    sitemapPages = await fetchSitemapPages();
  } catch (e) {
    console.error("[coverage-loader] fetchSitemapPages failed:", (e as Error).message);
    return null;
  }

  const indexStatus = await loadIndexStatus();
  const statusByNorm = indexStatus.byUrl; // key 已是 normalizeForMatch(url)

  // 每页自身流量（own）：当窗口 gsc_page_daily 按 url_norm 求和（最权威）。先取一次，既用于
  // own，也传给 buildMergedMetrics 复用，避免重复查（57 页量级其实无所谓，省一次是一次）。
  const dailyAgg = await loadDailyAggregates(windowDays, 1);

  // 旧址真实流量（bridged）+ 关键词按 301/308 重定向归并到新页（key = newNorm = normalizeForMatch(新 fullUrl)）
  // mergedMetrics = 纯归并（排除自映射）；own 另从 dailyAgg 取；total = own + bridged。
  // splitAvailable=false（daily 不可用、走批次回退）时 mergedMetrics 即 total，不做拆分。
  const [{ merged: mergedMetrics, splitAvailable }, mergedQueries] = await Promise.all([
    buildMergedMetrics(windowDays, dailyAgg),
    buildMergedQueries(),
  ]);

  // 真实页 pathnames（sitemap 每个 <loc>）
  const realPathnames = sitemapPages.map((p) => p.path);

  // 合成虚拟目录节点
  const synthPaths = synthesizeDirNodes(realPathnames).sort();

  // 统一 id 分配
  const allPaths = [...realPathnames, ...synthPaths];
  const idByPath = new Map<string, string>();
  allPaths.forEach((path, i) => {
    idByPath.set(path, `cv_${String(i + 1).padStart(4, "0")}`);
  });

  // parent 链
  const parentByPath = buildParentMap(allPaths);

  const origin = "https://www.weslamic.com";
  const lastSync = indexStatus.updatedAt || new Date().toISOString();

  const pages: PageRow[] = [];
  let indexedCount = 0;

  // 真实页（sitemap）
  for (let i = 0; i < sitemapPages.length; i++) {
    const sp = sitemapPages[i];
    const normKey = normalizeForMatch(sp.fullUrl);
    const status = statusByNorm[normKey];

    // 收录状态映射：indexed===true→"indexed"；===false→"excluded"；null/无记录→"discovered"（待检查）
    let indexState: IndexState;
    if (status?.indexed === true) {
      indexState = "indexed";
      indexedCount++;
    } else if (status?.indexed === false) {
      indexState = "excluded";
    } else {
      indexState = "discovered"; // 语义=待检查
    }

    const parentPath = parentByPath.get(sp.path);

    // ── 流量：own（自身）+ bridged（归并）拆分；PageRow 的 clicks/… 仍填 total（聚合口径不变）──
    let clicks: number;
    let impressions: number;
    let ctr: number;
    let position: number;
    let trafficSplit: PageRow["trafficSplit"] | undefined;

    if (splitAvailable) {
      // own = 本页自身 url_norm 当窗口流量（始终算，不受 isBridgeExcluded 影响——自身永远是自己的）
      const own = dailyAgg?.get(normKey);
      const ownClicks = own?.clicks ?? 0;
      const ownImpr = own?.impressions ?? 0;
      const ownPosSum = own?.sumPos ?? 0;
      // bridged = 纯归并（buildMergedMetrics 已排除自映射）
      const br = mergedMetrics.get(normKey);
      const brClicks = br?.clicks ?? 0;
      const brImpr = br?.impressions ?? 0;
      const brPosSum = br?.posSum ?? 0;
      // total = own + bridged
      const totalClicks = ownClicks + brClicks;
      const totalImpr = ownImpr + brImpr;
      clicks = totalClicks;
      impressions = totalImpr;
      ctr = totalImpr > 0 ? totalClicks / totalImpr : 0;
      position = totalImpr > 0 ? (ownPosSum + brPosSum) / totalImpr : 0;
      trafficSplit = {
        own: {
          clicks: ownClicks,
          impressions: ownImpr,
          ctr: ownImpr > 0 ? ownClicks / ownImpr : 0,
          position: ownImpr > 0 ? ownPosSum / ownImpr : 0,
        },
        bridged: {
          clicks: brClicks,
          impressions: brImpr,
          ctr: brImpr > 0 ? brClicks / brImpr : 0,
          position: brImpr > 0 ? brPosSum / brImpr : 0,
        },
      };
    } else {
      // 批次回退：mergedMetrics 即 total（含自映射），不做拆分（trafficSplit 留 undefined）
      const acc = mergedMetrics.get(normKey);
      clicks = acc?.clicks ?? 0;
      impressions = acc?.impressions ?? 0;
      ctr = acc && acc.impressions > 0 ? acc.ctrSum / acc.impressions : 0;
      position = acc && acc.impressions > 0 ? acc.posSum / acc.impressions : 0;
    }

    // 归并旧址关键词：按 normKey 查；topQuery = 点击最高词；命不中 → []/"—"
    const queries = mergedQueries.get(normKey) ?? [];
    const topQuery = queries[0]?.query ?? "—";

    // 收录覆盖详情：coverageText 直传 Google 原话；coverageLabel 派生中文短标。
    // 无记录 / 空文案 → 两者皆 undefined（不写脏字段）。
    const coverageText = status?.coverageText?.trim() ? status.coverageText : undefined;
    const coverageLabel = coverageLabelFromText(status?.coverageText);

    pages.push({
      id: idByPath.get(sp.path)!,
      url: sp.path,
      fullUrl: sp.fullUrl,
      market: inferMarket(sp.path),
      pageType: inferPageType(sp.path),
      cluster: inferCluster(sp.path),
      topQuery,
      clicks,
      impressions,
      ctr,
      position,
      indexState,
      coverageText,
      coverageLabel,
      trafficSplit,
      trend12m: emptyTrend(),
      queries,
      lastSync,
      parentId: parentPath ? idByPath.get(parentPath) : undefined,
      isPillar: inferIsPillar(sp.path) || undefined,
      sortOrder: i,
    });
  }

  // 合成目录节点
  for (let i = 0; i < synthPaths.length; i++) {
    const sp = synthPaths[i];
    const parentPath = parentByPath.get(sp);

    pages.push({
      id: idByPath.get(sp)!,
      url: sp,
      fullUrl: origin + sp,
      market: inferMarket(sp),
      pageType: inferPageType(sp),
      cluster: inferCluster(sp),
      topQuery: "—",
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      indexState: "discovered" as IndexState,
      trend12m: emptyTrend(),
      lastSync,
      parentId: parentPath ? idByPath.get(parentPath) : undefined,
      isPillar: inferIsPillar(sp) || undefined,
      sortOrder: sitemapPages.length + i,
      isSynthetic: true,
    });
  }

  // stats：totalPages = 真实页数（不含合成），indexedCount = 已收录数。
  // 性能聚合口径：归并后的新页（不含合成节点）求和；ctr=总点击/总曝光；
  // avgPosition=有曝光新页的简单均值（保留 1 位）；top10=position 1-10 的新页数。
  const realOnly = pages.filter((p) => !p.isSynthetic);
  const totalClicks = realOnly.reduce((s, p) => s + p.clicks, 0);
  const totalImpressions = realOnly.reduce((s, p) => s + p.impressions, 0);
  const withImpr = realOnly.filter((p) => p.impressions > 0);
  const stats: IndexingStats & { indexedCount: number } = {
    totalPages: realOnly.length,
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgPosition:
      withImpr.length > 0
        ? parseFloat(
            (withImpr.reduce((s, p) => s + p.position, 0) / withImpr.length).toFixed(1)
          )
        : 0,
    top10Pages: realOnly.filter((p) => p.position > 0 && p.position <= 10).length,
    lastSync,
    indexedCount,
  };

  return {
    pages,
    stats,
    source: "json",
    fetchedAt: lastSync,
    property: "sc-domain:weslamic.com",
    freshnessText: undefined,
    indexedCount,
  };
}
