/**
 * 选题工作台 · 每市场 GSC 排名（服务端）
 * ──────────────────────────────────────────────────────────────────────────
 * 与「收录与索引」同一数据源（loadLatestSnapshot：PG 优先 → JSON 兜底 → 套人工修正）。
 * 把扁平的 PageRow[] 归并成 basePath → market → 排名 的查找表：
 *   · basePath = 去掉 locale 前缀（/ar、/id…）后的路径，让各市场本地化 URL 归到同一页
 *   · market   = PageRow.market（已是 2 字母市场码）
 * 只收"真实有排名"的页（position > 0、非合成节点），从而实现"有就显示、没有就不显示"。
 *
 * 仅供服务端组件 import（依赖 @/lib/gsc/loader 的 Node 运行时）。
 */
import { loadLatestSnapshot } from "@/lib/gsc/loader";
import type { Market } from "./_data";
import type { MarketRankings } from "./_workbench";

// 与 transform.ts 的 LOCALE_TO_MARKET 键一致：URL 第一段若是这些 locale，则属本地化变体
const LOCALE_PREFIXES = new Set(["ar", "fr", "de", "tr", "es", "pt", "id", "ms", "ur", "ja", "zh"]);
const APP_MARKETS = new Set<Market>(["us", "uk", "sa", "id", "my", "ae", "de", "tr", "fr", "au"]);

/** 去掉 locale 前缀：/id/collections/zikr-ring → /collections/zikr-ring */
function basePath(url: string): string {
  const parts = url.split("/"); // ["", "id", "collections", "zikr-ring"]
  if (parts.length > 2 && LOCALE_PREFIXES.has(parts[1])) {
    return "/" + parts.slice(2).join("/");
  }
  return url;
}

export async function getMarketRankings(): Promise<MarketRankings> {
  const out: MarketRankings = {};
  let snap;
  try {
    snap = await loadLatestSnapshot();
  } catch {
    return out; // 数据源不可用 → 空表（UI 一律显示"暂无"）
  }
  if (!snap) return out;

  for (const p of snap.pages) {
    if (p.isSynthetic) continue;          // 合成目录节点无真实排名
    if (!(p.position > 0)) continue;      // 无排名 → 不收（保证"没有就不显示"）
    const m = p.market as Market;
    if (!APP_MARKETS.has(m)) continue;
    const bp = basePath(p.url);
    if (!out[bp]) out[bp] = {};
    const prev = out[bp][m];
    // 同 basePath+market 万一多条，留排名更优（数值更小）的
    if (!prev || p.position < prev.position) {
      out[bp][m] = { position: p.position, clicks: p.clicks, impressions: p.impressions };
    }
  }
  return out;
}
