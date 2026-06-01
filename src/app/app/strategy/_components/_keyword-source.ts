/**
 * 选题工作台 · 关键词进料源（服务端）
 * ──────────────────────────────────────────────────────────────────────────
 * 进料**实时读数据库 keywords 表**（经 getKeywordsCached），与「关键词库」页面同源同步：
 * 库一变、进料就变，永不停在某个静态快照上。
 *
 * 取代旧的静态快照 `_all-keywords.ts`（5/29 一次性烤进代码的 176 词，已过期）。
 * 旧文件仍保留供 regression 脚本 import，但运行时不再引用。
 *
 *   · id 由 DB serial 主键派生 `k${row.id}`：稳定、唯一，加/删词不影响其他词的 id；
 *   · market 保留 DB 原值（不做 union 收窄），保证与 strategy_bindings 表的自然键一致
 *     —— 自然键 = keyword(小写trim) + market(null→空串)，kwId↔自然键往返靠这点对齐；
 *   · 排序沿用 getKeywordsCached 的 createdAt 升序（关键词创建顺序）。
 *
 * 仅供服务端 import（page.tsx / _plan-store）—— 内部依赖 getKeywordsCached（读 DB），
 * 与本仓库其它 server 模块（_plan-store / keywords-cache）一致：靠约定而非 "server-only" 包。
 */
import { getKeywordsCached } from "@/lib/keywords-cache";
import type { RawKeyword, Market, BehaviorIntent, PagePlanningIntent, LayerLevel } from "./_workbench";

/** DB keywords 全表 → RawKeyword[]（实时，经 60s 缓存层）。 */
export async function getKeywordSource(): Promise<RawKeyword[]> {
  const rows = await getKeywordsCached();
  return rows.map((row) => ({
    id: `k${row.id}`,
    keyword: row.keyword,
    market: row.market as Market | null, // 保留 DB 原值，不做 union 收窄（与 binding 自然键对齐）
    sv: row.searchVolume,
    kd: row.keywordDifficulty,
    intent: row.intent,
    behaviorIntent: row.behaviorIntent as BehaviorIntent | null,
    // 兜底：DB 实测空值占比为 0%，兜底仅作防御，保证非空联合类型不被破坏。
    pagePlanningIntent: (row.pagePlanningIntent ?? "品类聚合页") as PagePlanningIntent,
    layer: (row.layerLevel ?? "四级兜底") as LayerLevel,
    questionType: row.questionType,
  }));
}
