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

/** 旧址按重定向归并到新页的指标累加器（曝光加权 ctr/position）。 */
interface MergedMetric {
  clicks: number;
  impressions: number;
  ctrSum: number; // Σ ctr * impressions
  posSum: number; // Σ position * impressions
}

/**
 * 取旧真实页 + 重定向映射，构建 Map<newNorm, MergedMetric>。
 * 旧快照缺失（PG/JSON 都没有）或映射文件缺失 → 返回空 Map（下游退化为全 0，不报错）。
 */
async function buildMergedMetrics(): Promise<Map<string, MergedMetric>> {
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
export async function loadCoveragePages(): Promise<
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

  // 旧址真实流量 + 关键词按 301/308 重定向归并到新页（key = newNorm = normalizeForMatch(新 fullUrl)）
  const [mergedMetrics, mergedQueries] = await Promise.all([
    buildMergedMetrics(),
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

    // 归并旧址流量：按 normKey 查累加器；曝光加权还原 ctr/position；命不中保持 0
    const acc = mergedMetrics.get(normKey);
    const clicks = acc?.clicks ?? 0;
    const impressions = acc?.impressions ?? 0;
    const ctr = acc && acc.impressions > 0 ? acc.ctrSum / acc.impressions : 0;
    const position = acc && acc.impressions > 0 ? acc.posSum / acc.impressions : 0;

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
