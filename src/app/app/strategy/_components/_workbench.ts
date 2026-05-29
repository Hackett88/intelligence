/**
 * 选题工作台 · 数据底座 + 专业信号
 * ──────────────────────────────────────────────────────────────────────────
 * 工作台范式：扁平的「关键词宇宙」（真实 176 词）+ 扁平的「页面节点」（支柱/集群），
 * 关键词通过 binding 绑到页面上。初始给一份「半成品地图」（部分词已预绑进几根支柱），
 * 其余真实词留在源池里供运营者手动绑定 —— 演示完整的"捞词→指派→建图"流程。
 *
 * 这里只提供数据与**信号算法的形状**；视觉版里：
 *   · 意图匹配 / 蚕食 / 机会分  → 用库里真实字段真算
 *   · SERP 重合度 / 覆盖缺口    → 演示值（无真实 SERP 抓取，用确定性近似，UI 标"示例"）
 */
import { getBlueprint } from "./_data";
import { ALL_KEYWORDS } from "./_all-keywords";
import type {
  Market, LayerLevel, PagePlanningIntent, BehaviorIntent, PageRole, PlanStatus,
} from "./_data";

export type { Market, LayerLevel, PagePlanningIntent, BehaviorIntent, PageRole, PlanStatus };

// ── 关键词宇宙（源料）────────────────────────────────────────────────────────
export type RawKeyword = {
  id: string;
  keyword: string;
  market: Market | null;
  sv: number | null;
  kd: number | null;
  intent: string | null;
  behaviorIntent: BehaviorIntent | null;
  pagePlanningIntent: PagePlanningIntent;
  layer: LayerLevel;
  questionType: string | null;
};

// ── 每市场 GSC 排名（来自收录与索引同一数据源；按 basePath→market 查得）─────────
export type MarketRank = { position: number; clicks: number; impressions: number };
/** basePath（去掉 locale 前缀的路径）→ market → 排名；有则有，无则查不到 */
export type MarketRankings = Record<string, Partial<Record<Market, MarketRank>>>;

// ── 领域（仅作分组标签，不是嵌套层级）──────────────────────────────────────
export type Territory = "产品" | "知识" | "工具" | "场景" | "品牌";

export const TERRITORY_BY_THEME: Record<string, Territory> = {
  "zikr-ring": "产品",
  "islamic-jewelry": "产品",
  "knowledge-dhikr": "知识",
  "slow-living": "知识",
  "itasbih-tools": "工具",
  "qibla-finder": "工具",
  "muslim-gifts": "场景",
  "brand": "品牌",
};

// ── 工作台页面节点（扁平；集群用 pillarId 指向支柱）────────────────────────
export type WbPage = {
  id: string;
  role: PageRole;
  pillarId: string | null; // 支柱为 null；集群指向其支柱
  title: string;
  primaryKeyword: string;
  pageType: PagePlanningIntent;
  status: PlanStatus;
  url: string | null;
  market: Market;
  markets: Market[];
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  note?: string;
  themeId: string;
  themeName: string;
  themeLatin: string;
  territory: Territory;
};

// keyword + market 的稳定键（用来把 blueprint 的预绑词对到真实 176 词上）
export const keyOf = (keyword: string, market: string | null | undefined) =>
  `${keyword.trim().toLowerCase()}__${market ?? "_"}`;

// ════════════════════════════════════════════════════════════════════════════
// 由 _data.ts 的策划主题派生：页面节点 + 初始绑定（哪些真实词预绑到哪个页）
// ════════════════════════════════════════════════════════════════════════════
export type WorkbenchSeed = {
  pages: WbPage[];
  /** keyword.id → pageId（初始已绑定） */
  bindings: Record<string, string>;
  /** 源池：未绑定的真实词 */
  pool: RawKeyword[];
  /** 噪声/建议剔除 */
  excluded: RawKeyword[];
  territories: Territory[];
};

/** 持久化往返载荷：工作台当前状态（页面 + 绑定 + 暂存）。前后端共用此形状。 */
export type PlanPayload = {
  pages: WbPage[];
  bindings: Record<string, string>; // kwId -> pageId
  parked: string[];                 // kwId[]
};

let _seed: WorkbenchSeed | null = null;

export function getWorkbenchSeed(): WorkbenchSeed {
  if (_seed) return _seed;

  const bp = getBlueprint();
  const pages: WbPage[] = [];
  // keyOf → pageId（预绑映射）
  const keyToPage = new Map<string, string>();

  for (const t of bp.themes) {
    const territory = TERRITORY_BY_THEME[t.id] ?? "产品";
    const pushPage = (p: typeof t.pillar, role: PageRole, pillarId: string | null) => {
      pages.push({
        id: p.id, role, pillarId,
        title: p.title, primaryKeyword: p.keywords.find((k) => k.primary)?.keyword ?? p.keywords[0]?.keyword ?? p.title,
        pageType: p.pageType, status: p.status, url: p.url,
        market: p.market, markets: p.markets,
        position: p.position, clicks: p.clicks, impressions: p.impressions,
        note: p.note,
        themeId: t.id, themeName: t.name, themeLatin: t.latin, territory,
      });
      for (const k of p.keywords) {
        const kk = keyOf(k.keyword, k.market);
        if (!keyToPage.has(kk)) keyToPage.set(kk, p.id);
      }
    };
    pushPage(t.pillar, "pillar", null);
    for (const c of t.clusters) pushPage(c, "cluster", t.pillar.id);
  }

  // 噪声键
  const excludedKeys = new Set(bp.excluded.map((e) => keyOf(e.keyword, e.market)));

  const bindings: Record<string, string> = {};
  const pool: RawKeyword[] = [];
  const excluded: RawKeyword[] = [];

  for (const k of ALL_KEYWORDS) {
    const kk = keyOf(k.keyword, k.market);
    if (excludedKeys.has(kk)) { excluded.push(k); continue; }
    const pid = keyToPage.get(kk);
    if (pid) bindings[k.id] = pid;
    else pool.push(k);
  }

  _seed = {
    pages,
    bindings,
    pool,
    excluded,
    territories: ["产品", "知识", "工具", "场景", "品牌"],
  };
  return _seed;
}

// ════════════════════════════════════════════════════════════════════════════
// 专业信号（演示用确定性近似；真实化时在此处替换为真算法/真数据）
// ════════════════════════════════════════════════════════════════════════════

const tokenize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);

// 停用词：功能词 + 疑问词。匹配只看实义词，避免"what is a hijab"靠"what/is"误配到"what is dhikr"。
const STOPWORDS = new Set([
  "the", "an", "of", "for", "to", "in", "on", "at", "by", "is", "are", "was", "be", "do",
  "does", "did", "what", "how", "why", "where", "when", "which", "who", "and", "or", "with",
  "my", "your", "you", "vs", "from", "as", "it", "its",
]);
const meaningfulTokens = (s: string) => tokenize(s).filter((w) => !STOPWORDS.has(w));

/**
 * SERP 重合度（演示值）：用两词的 token Jaccard 近似"Google 是否会用同一页满足两者"。
 * 真实化时替换为：抓两词 top10 URL 求交集 / |共享 URL|。返回 0..100。
 */
export function serpOverlapPct(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  return Math.round((inter / union) * 100);
}

export type MergeAdvice = { verdict: "merge" | "consider" | "split"; label: string };
export function mergeAdvice(pct: number): MergeAdvice {
  if (pct >= 40) return { verdict: "merge", label: "建议合为一页" };
  if (pct >= 20) return { verdict: "consider", label: "可考虑合并" };
  return { verdict: "split", label: "应各自独立成页" };
}

/** 意图 → 页面类型 是否匹配（真：用 page_planning_intent） */
export function intentMatches(kw: RawKeyword, page: WbPage): boolean {
  return kw.pagePlanningIntent === page.pageType;
}

/** 机会分（真：量 × 可赢度 / 难度；缺口/优化加权） */
export function opportunityScore(sv: number | null, kd: number | null, status: PlanStatus): number {
  const v = sv ?? 0;
  const k = kd ?? 30;
  const statusBoost = status === "gap" ? 1.6 : status === "optimize" ? 1.3 : 0.8;
  const kdFactor = 1 - Math.min(k, 60) / 100;
  return Math.round((v + 1) * statusBoost * (0.5 + kdFactor));
}
export function opportunityTier(score: number): { label: string; cls: string } {
  if (score >= 20000) return { label: "极高", cls: "text-manor-brassHi" };
  if (score >= 6000) return { label: "高", cls: "text-manor-sageHi" };
  if (score >= 1500) return { label: "中", cls: "text-manor-brassDim" };
  return { label: "低", cls: "text-manor-inkDim" };
}

/**
 * 助攻：为一个待绑定词推荐最可能的归处（页面）。
 *
 * 专业取向：归处由「语义共线」决定，不靠页面类型空猜。
 *   1. 拿待绑词的实义词，去和每个页面的「已绑词集 + 主词」的实义词求交集（这正是
 *      话题簇工具的做法——匹配整簇术语集，而非只匹配头词）。
 *   2. 必须真有共线词才会被推荐；页面类型只在已有语义信号时 +1 加固，绝不凭空造推荐。
 *   3. 全场没有任何共线 → 返回 null（诚实地说"无明确推荐"，让人手动指派），
 *      绝不输出"abaya → 智能念珠戒指"这种看着自信实则瞎猜的归处。
 *
 * @param boundByPage pageId → 已绑到该页的真实词（让推荐能命中整簇术语，而不只是主词）
 */
// 阈值：词与某页术语的最高单条 Jaccard 相似度低于此值，视为"无语义信号"——不推荐。
// 0.3 滤掉"2 词查询 × 3 词短语只蹭一个泛词(prayer/women)"那一档(=0.25)的偶然共现，
// 同时保留"共用核心名词"的真匹配(2词×2词单共=0.33、短词被整条命中=0.5~1.0)。
const MIN_PLACEMENT_JACCARD = 0.3;

export function suggestPlacement(
  kw: RawKeyword,
  pages: WbPage[],
  boundByPage?: Map<string, RawKeyword[]>,
): { pageId: string; score: number; reason: string; matchedKeyword: string } | null {
  const kwTokens = new Set(meaningfulTokens(kw.keyword));
  if (kwTokens.size === 0) return null;

  let best:
    | { pageId: string; score: number; reason: string; matchedKeyword: string }
    | null = null;
  let bestScore = -1; // 原始浮点分（与候选同量纲比较；best.score 是 ×100 取整后的展示值）

  for (const p of pages) {
    // 该页的术语集：主词 + 已绑词（匹配整簇术语，而非只匹配头词）
    const corpus = [p.primaryKeyword, ...(boundByPage?.get(p.id)?.map((k) => k.keyword) ?? [])];

    // 以"与本页任一术语的最高 Jaccard 相似度"为主信号——奖励"短词被整条命中"
    // （如 "tasbih" 命中 "tasbih" / "what is tasbih"），而非靠长句蹭一个泛词。
    let bestPhrase = "";
    let bestJac = 0;
    const sharedTokens = new Set<string>(); // 跨整个术语集累计的共线实义词（仅用于理由展示）
    for (const phrase of corpus) {
      const toks = new Set(meaningfulTokens(phrase));
      if (toks.size === 0) continue;
      let inter = 0;
      for (const w of toks) if (kwTokens.has(w)) { inter++; sharedTokens.add(w); }
      if (inter === 0) continue;
      const jac = inter / (kwTokens.size + toks.size - inter);
      if (jac > bestJac) { bestJac = jac; bestPhrase = phrase; }
    }

    if (bestJac < MIN_PLACEMENT_JACCARD) continue; // 无足够语义信号 → 不推荐

    // 主信号 Jaccard；页型匹配仅作小幅加固；共线词数量作极轻微的破平手项。
    const intentBonus = kw.pagePlanningIntent === p.pageType ? 0.15 : 0;
    const score = bestJac + intentBonus + sharedTokens.size * 0.001;

    if (score > bestScore) {
      bestScore = score;
      const reasons = [
        `与本页「${bestPhrase}」高度共线（${Array.from(sharedTokens).slice(0, 3).join("、")}）`,
      ];
      if (intentBonus) reasons.push("页型匹配");
      best = {
        pageId: p.id,
        score: Math.round(score * 100),
        reason: reasons.join(" · "),
        matchedKeyword: bestPhrase,
      };
    }
  }
  return best;
}

/**
 * 蚕食检测（真：基于绑定关系）：找出"不同页面却争夺高度重合关键词"的冲突对。
 * 这里以页面 primaryKeyword 的 token 重合 >=50% 且分属不同页为信号。
 */
/**
 * 去重：同一关键词文本（跨市场的多条）默认合并成一条展示。
 * 保留每条的 id（移出时整组一起解绑），并汇总搜索量、记录涉及的市场。
 * 代表词取搜索量最高的那条（展示主市场用）。
 */
export type DedupedKeyword = {
  key: string;                 // 归一化后的关键词文本
  keyword: string;             // 展示文本
  ids: string[];               // 该文本对应的全部真实词 id
  markets: (Market | null)[];  // 涉及的市场（按出现顺序，可能含重复/ null）
  totalSv: number;             // 跨市场搜索量合计
  reprMarket: Market | null;   // 代表市场（最高 SV 那条）
  count: number;               // 合并了几条
};
export function dedupeKeywords(kws: RawKeyword[]): DedupedKeyword[] {
  const map = new Map<string, DedupedKeyword & { _bestSv: number }>();
  for (const k of kws) {
    const key = k.keyword.trim().toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, keyword: k.keyword, ids: [], markets: [], totalSv: 0, reprMarket: k.market, count: 0, _bestSv: -1 };
      map.set(key, g);
    }
    g.ids.push(k.id);
    g.markets.push(k.market);
    g.totalSv += k.sv ?? 0;
    g.count += 1;
    if ((k.sv ?? 0) > g._bestSv) { g._bestSv = k.sv ?? 0; g.reprMarket = k.market; g.keyword = k.keyword; }
  }
  return Array.from(map.values()).map(({ _bestSv, ...rest }) => rest);
}

export type CannibalConflict = { aId: string; bId: string; overlap: number };
export function detectCannibalization(pages: WbPage[]): CannibalConflict[] {
  const out: CannibalConflict[] = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const ov = serpOverlapPct(pages[i].primaryKeyword, pages[j].primaryKeyword);
      if (ov >= 50) out.push({ aId: pages[i].id, bId: pages[j].id, overlap: ov });
    }
  }
  return out;
}
