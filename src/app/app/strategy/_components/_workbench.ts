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
  "name-necklace": "产品", // 原 islamic-jewelry 子集群，提升为独立经线行
  "tasbih": "产品", // demo · 品类经线中段
  "knowledge-dhikr": "知识",
  "slow-living": "场景", // v2.1: 老板明确 Slow Living 属于场景
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
  /** 子支柱所属的场景列 id；决定它落进哪一格。缺省=不进矩阵格子，只在行头树里出现 */
  scenarioId?: string;
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
        ...(p.scenarioId ? { scenarioId: p.scenarioId } : {}),
      });
      for (const k of p.keywords) {
        const kk = keyOf(k.keyword, k.market);
        if (!keyToPage.has(kk)) keyToPage.set(kk, p.id);
      }
    };
    pushPage(t.pillar, "pillar", null);
    for (const c of t.clusters) pushPage(c, c.role ?? "cluster", c.parentId ?? t.pillar.id);
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

// 极轻量英文单复数归一（仅长度>3 的 token 去尾 s/es；中文/阿拉伯语等不以 s 结尾不受影响）。
// 修电商品类词 bracelet/bracelets、gift/gifts 因单复数被当作不同 token 的硬伤。
function foldPlural(t: string): string {
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}
const meaningfulFolded = (s: string) => meaningfulTokens(s).map(foldPlural);

/**
 * 蚕食检测专用重合度：去停用词 + 单复数归一后的实义词 Jaccard（0..100）。
 * 与 serpOverlapPct（展示用，保持原状）分开 —— 不改后者，避免波及 KeywordModal 的归处推荐显示。
 */
export function meaningfulOverlapPct(a: string, b: string): number {
  const ta = new Set(meaningfulFolded(a));
  const tb = new Set(meaningfulFolded(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  return Math.round((inter / union) * 100);
}

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

// ════════════════════════════════════════════════════════════════════════════
// 漏斗层 + 意图族：蚕食检测的两个新维度，同时供 UI 显式展示「页面类型 / 搜索意图」。
// 两者都运行时派生（URL 推断 + 绑定词投票），不入库、不加 WbPage 字段 —— DB/旧草稿零迁移。
// ════════════════════════════════════════════════════════════════════════════

/** Shopify 漏斗层：从 URL 前缀实时推断（product 前缀优先于 collection）。 */
export type FunnelLayer = "collection" | "product" | "blog" | "page" | null;
export function urlFunnelLayer(url: string | null): FunnelLayer {
  if (!url) return null;
  if (url.includes("/products/")) return "product";   // /collections/x/products/y 也归 product
  if (url.includes("/collections/")) return "collection";
  if (url.includes("/blogs/")) return "blog";          // /id/blogs/... 含 locale 子路径仍命中
  if (url.includes("/pages/")) return "page";
  return null;
}

/**
 * 工作台轨道 —— 内容/商品分轨重做的地基（运行时按 URL 派生，不入库、零迁移）。
 *   · 博客(/blogs/)        → 内容轨 content（Topic Cluster：支柱/集群文章）
 *   · 品类页/产品页          → 商品轨 catalog（Collection → Product）
 *   · 工具页(/pages/) / 未设 URL → other（待归置）
 * 这是把"博客内容"与"商品页"从同一个主题框里分开的判据。
 */
export type WorkTrack = "content" | "catalog" | "other";
export function pageTrack(url: string | null): WorkTrack {
  const layer = urlFunnelLayer(url);
  if (layer === "blog") return "content";
  if (layer === "collection" || layer === "product") return "catalog";
  return "other";
}

/** 搜索意图族：6 种 behaviorIntent 收敛成三族（既用于漏斗判定，也用于 UI 搜索意图展示）。 */
export type IntentFamily = "commercial" | "informational" | "navigational";
export const INTENT_FAMILY: Record<BehaviorIntent, IntentFamily> = {
  "了解型": "informational",
  "行动型": "commercial",
  "混合型": "commercial",
  "对比型": "commercial",
  "官网导航": "navigational",
  "线下到访": "navigational",
};

/**
 * 页意图族信号：对该页全部绑定词的意图族做多数投票。
 * mixed 仅在「无绝对多数族」（平局 / 主导族未过半）时为真 —— 这类才是真正势均力敌、需人工核。
 * 只要主导族绝对过半（如 commercial 2 : informational 1），就用主导族判定，不因偶有少数异族词
 * （跨 10 市场常见）而把真蚕食误降级为黄色待核。
 */
export type PageIntentSignal = { family: IntentFamily | null; mixed: boolean };
export function resolvePageIntent(boundKws: RawKeyword[]): PageIntentSignal {
  const counts: Record<IntentFamily, number> = { commercial: 0, informational: 0, navigational: 0 };
  let total = 0;
  for (const k of boundKws) {
    const f = k.behaviorIntent ? INTENT_FAMILY[k.behaviorIntent] : null;
    if (f) { counts[f]++; total++; }
  }
  const entries = (Object.entries(counts) as [IntentFamily, number][]).filter(([, n]) => n > 0);
  if (entries.length === 0) return { family: null, mixed: false };
  entries.sort((a, b) => b[1] - a[1]);
  const mixed = entries.length > 1 && entries[0][1] * 2 <= total; // 主导族未严格过半 → 势均力敌
  return { family: entries[0][0], mixed };
}

// ════════════════════════════════════════════════════════════════════════════
// 蚕食检测：三维 AND（词面重合 ∧ 同漏斗层 ∧ 同意图族）→ 真蚕食；跨层/跨族 = 漏斗协作。
// ════════════════════════════════════════════════════════════════════════════

/** 两页关系：红=真蚕食 / 绿=漏斗协作 / 黄=待人工核对 / 灰=跨主题低优。 */
export type RelationType =
  | "true_cannibalization"
  | "funnel_division"
  | "intent_overlap"
  | "cross_theme_low";

/** CannibalConflict 的超集：保留 aId/bId/overlap，旧消费端（Dock/Inspector）零改即运行。 */
export type CannibalConflict = { aId: string; bId: string; overlap: number };
export type PageRelation = CannibalConflict & {
  relationType: RelationType;
  advice: string;
};

/** 红色谓词：Dock 真蚕食计数 / Inspector 红块 / Worklist 作战清单 三处共用，杜绝口径分裂。 */
export function isHardCannibalization(r: PageRelation): boolean {
  return (r.relationType ?? "true_cannibalization") === "true_cannibalization";
}

// 词面重合阈值。去停用词+单复数归一后短词 Jaccard 会系统性升高，已用 176 词回归核过（见执行日志）。
const CANNIBAL_THRESHOLD = 50;

/**
 * 检测页面间关系。getIntent 为可选注入式 resolver（从该页绑定词投票得意图族）：
 * 缺省时降级为「漏斗层 + 词面 + 页型」判定，不引入意图族（安全降级，DB/旧草稿零依赖）。
 */
export function detectCannibalization(
  pages: WbPage[],
  getIntent?: (pageId: string) => PageIntentSignal,
): PageRelation[] {
  const out: PageRelation[] = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i], b = pages[j];

      // 维度1：词面实义词重合（去停用词 + 单复数归一）
      const ov = meaningfulOverlapPct(a.primaryKeyword, b.primaryKeyword);
      if (ov < CANNIBAL_THRESHOLD) continue;

      // 跨主题：不静默放过，降为低优灰提示。themeId 对用户新建页可能等于自身 id，
      // 这种「孤立新建支柱」不靠 themeId 分组，继续走门控。
      const aIso = a.themeId === a.id, bIso = b.themeId === b.id;
      if (a.themeId !== b.themeId && !(aIso && bIso)) {
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "cross_theme_low",
          advice: "跨主题同根词，核对是否两个主题在抢同一词，优先级低" });
        continue;
      }

      // 维度2：Shopify 漏斗层 —— 跨层 = 漏斗协作（collection 导购 / product 成交 / blog 科普）
      const la = urlFunnelLayer(a.url), lb = urlFunnelLayer(b.url);
      if (la && lb && la !== lb) {
        const samePageType = a.pageType === b.pageType;
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "funnel_division",
          advice: samePageType
            ? "不同 Shopify 页型，当前为漏斗协作；注意两页页面类型相同，若某页漏斗层调整（如 blog 升级为 collection）需复检蚕食"
            : "不同 Shopify 页型，漏斗协作。核对内链：collection 用购买锚指 product、blog 用学习锚指 collection" });
        continue;
      }

      // 维度3：搜索意图族 —— 跨族 = 漏斗协作
      const sa = getIntent?.(a.id), sb = getIntent?.(b.id);
      if (sa?.family && sb?.family && sa.family !== sb.family) {
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "funnel_division",
          advice: "不同搜索意图族，漏斗协作，正常" });
        continue;
      }

      // 维度4：意图混杂的页 → 不强判真蚕食，降为待核
      if (sa?.mixed || sb?.mixed) {
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "intent_overlap",
          advice: "存在跨市场意图分歧，核对真实 SERP 再决定是否合并" });
        continue;
      }

      // 维度5：同层（或层未知）+ 同族 —— 看页型决定红/黄
      if (a.pageType === b.pageType) {
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "true_cannibalization",
          advice: "疑似真蚕食：先查证两页真实 Google SERP 是否重合（当前重合%为词面演示值，非真实 SERP），确认后再做 301 合并或主词重分配" });
      } else {
        out.push({ aId: a.id, bId: b.id, overlap: ov, relationType: "intent_overlap",
          advice: "同意图不同页型，核对真实 SERP 是否共现，再决定是否改绑" });
      }
    }
  }
  return out;
}
