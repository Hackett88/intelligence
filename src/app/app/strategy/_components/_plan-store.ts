/**
 * 选题工作台 · 规划持久化（服务端）
 * ──────────────────────────────────────────────────────────────────────────
 * 把工作台状态（页面 + 词→页绑定 + 暂存）按 owner（登录邮箱）读/写到
 * strategy_pages / strategy_bindings 两张表（迁移 0014，0016 复活 + aux_keywords）。
 *
 *   · 绑定按「关键词文本 + 市场」自然键存（不引用静态词 id）；读回时用实时关键词进料源
 *     （getKeywordSource，与「关键词库」同源）反查回 kwId 交给前端（前端状态仍以 kwId 为键，
 *     UI/reducer 不变）。kwId 形如 k<dbid>，库变进料即变。
 *   · 保存采用「整组覆盖」：事务内先删该 owner 全部行再插当前完整状态 —— 天然无孤儿数据。
 *   · 页面落库含 aux_keywords（辅助词/实体数组，M6 新增）。
 *
 * 仅供服务端（page.tsx / Server Action）import。
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  strategyPages,
  strategyBindings,
  type NewStrategyPage,
  type NewStrategyBinding,
} from "@/db/schema";
import { getKeywordSource } from "./_keyword-source";
import type {
  WbPage, Market, PageRole, PlanStatus, PagePlanningIntent, Territory, PlanPayload,
} from "./_workbench";

export type { PlanPayload };

// 自然键：keyword（归一化）+ market（null → 空串，与 DB 存储一致）
const nk = (keyword: string, market: string | null | undefined) =>
  `${keyword.trim().toLowerCase()}|${market ?? ""}`;

/** 读取该 owner 的规划；无任何记录返回 null（前端则回退到蓝图/本地草稿）。 */
export async function loadPlan(owner: string): Promise<PlanPayload | null> {
  const pageRows = await db.select().from(strategyPages).where(eq(strategyPages.owner, owner));
  if (pageRows.length === 0) return null;

  const pages: WbPage[] = pageRows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      id: r.pageId,
      role: r.role as PageRole,
      pillarId: r.pillarId,
      title: r.title,
      primaryKeyword: r.primaryKeyword,
      pageType: r.pageType as PagePlanningIntent,
      status: r.status as PlanStatus,
      url: r.url,
      market: r.market as Market,
      markets: (Array.isArray(r.markets) ? r.markets : []) as Market[],
      position: null,
      clicks: null,
      impressions: null,
      note: r.note ?? undefined,
      auxKeywords: Array.isArray(r.auxKeywords) ? (r.auxKeywords as string[]) : [],
      auxEdited: r.auxEdited ?? false,
      themeId: r.themeId,
      themeName: r.themeName,
      themeLatin: r.themeLatin,
      territory: r.territory as Territory,
      // NULL → undefined（自建子支柱重载后落回原格子；蓝图页仍由 reconcile 用 seed 的 scenarioId）
      ...(r.scenarioId != null ? { scenarioId: r.scenarioId } : {}),
    }));

  // 自然键 → kwId 反查表：从实时关键词进料源就地构建（与「关键词库」同源）。
  const allKeywords = await getKeywordSource();
  const idByNk = new Map(allKeywords.map((k) => [nk(k.keyword, k.market), k.id]));

  const bindingRows = await db.select().from(strategyBindings).where(eq(strategyBindings.owner, owner));
  const bindings: Record<string, string> = {};
  const parked: string[] = [];
  for (const b of bindingRows) {
    const kwId = idByNk.get(nk(b.keyword, b.market === "" ? null : b.market));
    if (!kwId) continue; // 词库已变、对不回 → 跳过
    if (b.state === "parked" || !b.pageId) parked.push(kwId);
    else bindings[kwId] = b.pageId;
  }

  return { pages, bindings, parked };
}

/** 覆盖保存该 owner 的完整规划（事务内先删后插）。 */
export async function savePlan(owner: string, plan: PlanPayload): Promise<void> {
  const pageRows: NewStrategyPage[] = plan.pages.map((p, i) => ({
    owner,
    pageId: p.id,
    role: p.role,
    pillarId: p.pillarId,
    title: p.title,
    primaryKeyword: p.primaryKeyword,
    pageType: p.pageType,
    status: p.status,
    url: p.url,
    market: p.market,
    markets: p.markets,
    themeId: p.themeId,
    themeName: p.themeName,
    themeLatin: p.themeLatin,
    territory: p.territory,
    note: p.note ?? null,
    sortOrder: i,
    auxKeywords: p.auxKeywords ?? [],
    scenarioId: p.scenarioId ?? null,
    auxEdited: p.auxEdited ?? false,
  }));

  // kwId → 关键词：从实时关键词进料源就地构建（与「关键词库」同源）。
  const allKeywords = await getKeywordSource();
  const kwById = new Map(allKeywords.map((k) => [k.id, k]));

  // bindings + parked → 行；按自然键去重，满足 UNIQUE(owner,keyword,market)
  const seen = new Set<string>();
  const bindingRows: NewStrategyBinding[] = [];
  const push = (kwId: string, pageId: string | null, state: "bound" | "parked") => {
    const kw = kwById.get(kwId);
    if (!kw) return;
    const key = nk(kw.keyword, kw.market);
    if (seen.has(key)) return; // 同自然键只留首条（bound 先遍历 → 优先保留）
    seen.add(key);
    bindingRows.push({ owner, keyword: kw.keyword, market: kw.market ?? "", pageId, state });
  };
  for (const [kwId, pageId] of Object.entries(plan.bindings)) push(kwId, pageId, "bound");
  for (const kwId of plan.parked) push(kwId, null, "parked");

  await db.transaction(async (tx) => {
    await tx.delete(strategyBindings).where(eq(strategyBindings.owner, owner));
    await tx.delete(strategyPages).where(eq(strategyPages.owner, owner));
    if (pageRows.length) await tx.insert(strategyPages).values(pageRows);
    if (bindingRows.length) await tx.insert(strategyBindings).values(bindingRows);
  });
}
