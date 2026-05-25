// 把 GSC 抓回来的扁平 (URL + 4 指标) 数据，映射到收录与索引 UI 期望的
// PageRow[] + IndexingStats。
//
// 推断字段（GSC 自身不提供，但 UI 需要展示的）：
//   market / pageType / cluster / parentId / isPillar
//
// 这些都基于 URL 路径启发式推断，不依赖外部 LLM 调用 —— 速度优先 + 可复现。
// 真要更精准的归类，应放在后端管理后台手工 override 一份"URL → 元数据"映射表。

import type {
  PageRow,
  IndexingStats,
  IndexState,
} from "@/app/app/indexing/_components/_mock";
import type { GscSnapshot, GscPageRaw } from "./fetcher";
import { isAssetUrl, SYSTEM_PAGE_RE } from "./classify";

// URL → market（语言/地区子路径）
const LOCALE_TO_MARKET: Record<string, string> = {
  ar: "sa",  // 阿语 → 沙特（核心阿语市场）
  fr: "fr",  // 法语 → 法国（含北非法语）
  de: "de",  // 德语 → 德国
  tr: "tr",  // 土耳其
  es: "es",
  pt: "br",
  id: "id",
  ms: "my",
  ur: "pk",
  ja: "jp",
  zh: "cn",
};

export function inferMarket(pathname: string): string {
  const first = pathname.replace(/^\//, "").split("/")[0]?.toLowerCase() ?? "";
  return LOCALE_TO_MARKET[first] ?? "us";
}

// URL → pageType
export function inferPageType(pathname: string): string {
  const p = pathname.toLowerCase();
  // 最优先：本不该被当页面收录的两类（noindex 候选），从其它规则里截走
  if (isAssetUrl(p)) return "资源文件"; // 图片 / CSS / JS / CDN 等静态资源
  if (SYSTEM_PAGE_RE.test(p)) return "系统页"; // 购物车 / 结账 / 账户 / 认证 / 搜索等功能页
  if (p === "/" || /^\/(ar|fr|de|tr|es|pt|id|ms|ur|ja|zh)\/?$/.test(p))
    return "首页";
  if (/\/products\//.test(p)) return "产品详情页";
  if (/\/collections(\/|$)/.test(p)) return "品类列表页";
  if (/\/blogs?\/[^/]+\/[^/]+/.test(p)) return "博客文章";
  if (/\/blogs?\/?$/.test(p) || /\/blogs?\/[^/]+\/?$/.test(p)) return "博客目录";
  if (/\/(faq|frequently-asked-questions)/.test(p)) return "常见问题";
  if (/\/about/.test(p)) return "关于页";
  if (/\/(contact|support)/.test(p)) return "落地页";
  if (/\/(news|articles?)(\/|$)/.test(p)) return "资讯新闻";
  if (/\/(guide|tutorial|how-to)/.test(p)) return "指南教程";
  if (/\/(vs|compare)/.test(p)) return "对比页";
  // 工具页：通用工具关键词（紧跟 /）+ 本站连字符 slug 里的工具词（尺寸器 / 门店定位）
  if (/\/(tools?|calculator|finder|compass)/.test(p) || /(sizer|size-guide|store-locat)/.test(p))
    return "工具页";
  // 政策 / 法务页：隐私 / 条款 / 退款 / 运费 / 支付 / 各类 *-policy —— 月更 / 低优先
  if (/\/(privacy|terms|refund|shipping|payment|return|cookie|legal|disclaimer)([-/]|$)/.test(p) || /policy(\/|$)/.test(p))
    return "政策页";
  if (/\/pages?\//.test(p)) return "落地页";
  return "落地页";
}

// URL → cluster（与 mock _mock.ts 的 ClusterKey 对齐）
export function inferCluster(pathname: string): string {
  const p = pathname.toLowerCase();
  if (/zikr.?ring/.test(p) || /itasbih.?ring/.test(p)) return "zikr-ring";
  if (/tasbih/.test(p) && !/itasbih/.test(p)) return "tasbih";
  if (/necklace/.test(p)) return "necklace";
  if (/itasbih/.test(p)) return "itasbih-app";
  if (/(kaaba|qibla|prayer.?time)/.test(p)) return "tools";
  if (/(gift|eid|ramadan)/.test(p)) return "scene-gift";
  if (/(night|tahajjud|bedtime)/.test(p)) return "scene-night";
  if (/(slow.?living|mindful)/.test(p)) return "scene-slow";
  if (/(dhikr|zikr).*(meaning|history|guide|what)/.test(p))
    return "knowledge-dhikr";
  if (/\/(blogs?|articles?)\//.test(p)) return "knowledge-dhikr";
  if (/(jewelry|jewellery|bracelet|ring|pendant)/.test(p))
    return "islamic-jewelry";
  return "brand";
}

// URL → 是否为枢纽页（pillar）：品类列表页 / 工具中心 / 系列落地页
export function inferIsPillar(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (/\/collections\/[^/]+\/?$/.test(p)) return true;
  if (/^\/(kaaba-direction|qibla|itasbih)\/?$/.test(p)) return true;
  return false;
}

// 拆 URL：origin / pathname
function splitUrl(fullUrl: string): { origin: string; pathname: string } {
  try {
    const u = new URL(fullUrl);
    return { origin: u.origin, pathname: u.pathname || "/" };
  } catch {
    return { origin: "", pathname: fullUrl };
  }
}

// 基于"URL 路径深度"构造 parent 链：若 /a/b/c 的 parent /a/b 也在表里，建链
// locale-only 根（/ar、/fr、/de、/tr、/id 等）与 / 平级，都是一级页 —— 不设 parent。
export function isLocaleRoot(path: string): boolean {
  const trimmed = path.replace(/\/$/, "");
  const segs = trimmed.split("/").filter(Boolean);
  if (segs.length !== 1) return false;
  return Object.prototype.hasOwnProperty.call(LOCALE_TO_MARKET, segs[0].toLowerCase());
}

export function buildParentMap(pathnames: string[]): Map<string, string> {
  const set = new Set(pathnames);
  const out = new Map<string, string>();
  for (const path of pathnames) {
    if (path === "/" || !path) continue;
    // locale-only 根（/ar、/fr 等）与 / 平级，不挂在 / 下
    if (isLocaleRoot(path)) continue;
    const segs = path.replace(/\/$/, "").split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= 1; i--) {
      const candidate = "/" + segs.slice(0, i).join("/");
      if (set.has(candidate) && candidate !== path) {
        out.set(path, candidate);
        break;
      }
      // 兜底：父路径加尾斜杠
      const candidateSlash = candidate + "/";
      if (set.has(candidateSlash) && candidateSlash !== path) {
        out.set(path, candidateSlash);
        break;
      }
    }
    // 若没匹配到，且路径有 1 段以上，回落到根 "/"
    if (!out.has(path) && set.has("/")) {
      out.set(path, "/");
    }
  }
  return out;
}

// 12 个月趋势：GSC Performance 单次查询拿不到时间序列，先填空数组占位
// （UI 的 spark line 会画一条平的线，不会崩）
function emptyTrend(): number[] {
  return new Array(12).fill(0);
}

// 给所有真实 path 合成"目录入口"虚拟节点 —— 让树视图能按目录层次展开：
//   /products/zikr-ring  →  合成 /products
//   /ar/blogs/muslim/x   →  合成 /ar/blogs/muslim、/ar/blogs
// 已存在于真实 pages 中的 path 不重复合成。
// locale-only 根（/ar /fr 等）不合成（它们本身就是一级页，且已经在数据里）。
export function synthesizeDirNodes(realPathnames: string[]): string[] {
  const realSet = new Set(realPathnames);
  const synth = new Set<string>();
  for (const path of realPathnames) {
    if (path === "/" || !path) continue;
    const segs = path.replace(/\/$/, "").split("/").filter(Boolean);
    // 对每个 prefix 长度 i (1..segs.length-1) 检查
    for (let i = 1; i < segs.length; i++) {
      const prefix = "/" + segs.slice(0, i).join("/");
      if (realSet.has(prefix)) continue;
      if (isLocaleRoot(prefix)) continue; // /ar /fr 等已是一级页
      synth.add(prefix);
    }
  }
  return [...synth];
}

export function transformGscSnapshot(
  snapshot: GscSnapshot,
  options?: { topQueryByUrl?: Record<string, string> }
): { pages: PageRow[]; stats: IndexingStats } {
  // 1) GSC domain property 会同时返回 www / 非 www / http / https 多版本同 pathname
  //    的记录，UI 把它们视作"同一逻辑页"才合理。先按 pathname 合并：
  //    clicks / impressions 累加，CTR / position 按 impressions 加权重算。
  const groups = new Map<
    string,
    { pathname: string; fullUrl: string; clicks: number; impressions: number; ctrSum: number; posSum: number }
  >();
  for (const p of snapshot.pages) {
    const { pathname } = splitUrl(p.fullUrl);
    const prev = groups.get(pathname);
    if (!prev) {
      groups.set(pathname, {
        pathname,
        fullUrl: p.fullUrl,
        clicks: p.clicks,
        impressions: p.impressions,
        ctrSum: p.ctr * Math.max(p.impressions, 1),
        posSum: p.position * Math.max(p.impressions, 1),
      });
    } else {
      // 同 pathname 多版本 → 合并；fullUrl 取 clicks 大的那一版（更"正"的代表 URL）
      const useNew = p.clicks > prev.clicks;
      prev.clicks += p.clicks;
      prev.impressions += p.impressions;
      prev.ctrSum += p.ctr * Math.max(p.impressions, 1);
      prev.posSum += p.position * Math.max(p.impressions, 1);
      if (useNew) prev.fullUrl = p.fullUrl;
    }
  }

  // 2) 按 clicks 降序排列得到稳定顺序
  const sortedReal = [...groups.values()].sort((a, b) => b.clicks - a.clicks);
  const realPathnames = sortedReal.map((g) => g.pathname);

  // 3) 为每个目录前缀合成虚拟节点（让 STRATUM·1 是目录入口而不是直接的 SKU/文章）
  const synthPaths = synthesizeDirNodes(realPathnames);
  // 合成节点按 path 字典序排，方便稳定顺序
  synthPaths.sort();

  // 4) 真实 + 合成 → 统一 id 分配；id 顺序保持 "真实先 / 合成后"，避免 pg_xxxx 编号变化太大
  const allPaths = [...realPathnames, ...synthPaths];
  const idByPath = new Map<string, string>();
  allPaths.forEach((path, i) => idByPath.set(path, `pg_${String(i + 1).padStart(4, "0")}`));

  const parentByPath = buildParentMap(allPaths);

  // 真实 page
  const realPages: PageRow[] = sortedReal.map((g, i) => {
    const id = idByPath.get(g.pathname)!;
    const denom = Math.max(g.impressions, 1);
    const ctr = g.impressions > 0 ? g.ctrSum / denom : 0;
    const position = g.impressions > 0 ? parseFloat((g.posSum / denom).toFixed(1)) : 0;
    const market = inferMarket(g.pathname);
    const pageType = inferPageType(g.pathname);
    const cluster = inferCluster(g.pathname);
    const isPillar = inferIsPillar(g.pathname);
    const parentPath = parentByPath.get(g.pathname);
    const parentId = parentPath ? idByPath.get(parentPath) : undefined;
    const topQuery = options?.topQueryByUrl?.[g.fullUrl] ?? "—";
    const indexState: IndexState = "indexed";

    return {
      id,
      url: g.pathname,
      fullUrl: g.fullUrl,
      market,
      pageType,
      cluster,
      topQuery,
      clicks: g.clicks,
      impressions: g.impressions,
      ctr,
      position,
      indexState,
      trend12m: emptyTrend(),
      lastSync: snapshot.fetchedAt,
      parentId,
      isPillar: isPillar || undefined,
      sortOrder: i,
    };
  });

  // 合成 page —— clicks/impressions/ctr/position 都是 0；列表视图、stats 会按 isSynthetic 过滤
  const origin = realPages[0]?.fullUrl ? new URL(realPages[0].fullUrl).origin : "";
  const synthPages: PageRow[] = synthPaths.map((p, i) => {
    const id = idByPath.get(p)!;
    const market = inferMarket(p);
    const pageType = inferPageType(p);
    const cluster = inferCluster(p);
    const parentPath = parentByPath.get(p);
    const parentId = parentPath ? idByPath.get(parentPath) : undefined;
    return {
      id,
      url: p,
      fullUrl: origin + p,
      market,
      pageType,
      cluster,
      topQuery: "—",
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      indexState: "indexed" as IndexState,
      trend12m: emptyTrend(),
      lastSync: snapshot.fetchedAt,
      parentId,
      sortOrder: realPages.length + i,
      isSynthetic: true,
    };
  });

  const pages = [...realPages, ...synthPages];

  // 汇总：totalPages / top10 / avg 都只统计真实页（合成节点不算"被索引的页"）
  const realOnly = pages.filter((p) => !p.isSynthetic);
  const top10 = realOnly.filter((p) => p.position > 0 && p.position <= 10).length;
  const stats: IndexingStats = {
    totalPages: realOnly.length,
    totalClicks: snapshot.summary.totalClicks || realOnly.reduce((s, p) => s + p.clicks, 0),
    totalImpressions:
      snapshot.summary.totalImpressions || realOnly.reduce((s, p) => s + p.impressions, 0),
    avgCtr:
      snapshot.summary.avgCtr ||
      (realOnly.length ? realOnly.reduce((s, p) => s + p.ctr, 0) / realOnly.length : 0),
    avgPosition:
      snapshot.summary.avgPosition ||
      (realOnly.length
        ? parseFloat((realOnly.reduce((s, p) => s + p.position, 0) / realOnly.length).toFixed(1))
        : 0),
    top10Pages: top10,
    lastSync: snapshot.fetchedAt,
  };

  return { pages, stats };
}
