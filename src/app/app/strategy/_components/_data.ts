/**
 * 主题与页面规划 · PLEXUS · PAGINAE
 * ──────────────────────────────────────────────────────────────────────────
 * 设计阶段的派生数据集（视觉演示用，不接真实计算逻辑）。
 *
 * 来源真实：176 条关键词来自 PG `keywords` 表（layer_level / page_planning_intent /
 * behavior_intent / search_volume / market 均为真实值）；页面 URL / 排名 / 点击来自
 * 最近一次 GSC 同步（`gsc_pages`）。这里做的只是"人工把散落关键词聚合成主题、再把主题
 * 拆成支柱页 + 集群页、并映射到已有 URL 或标记为待新建"——也就是这张 tab 将来要自动做的事。
 *
 * 派生规则（与 UI 上展示的"规划逻辑"一致）：
 *   · 聚主题   → 语义相关的关键词归入一个主题，对齐站点已有 cluster（无则为新主题）
 *   · 定支柱   → 主题内 layer=一级核心 且 page_planning_intent∈{品类聚合页,品牌主页,工具生态页}
 *               的词作支柱页(hub)
 *   · 定集群   → layer=二级独立/三级变体 按 page_planning_intent 各自成集群页(spoke)；
 *               四级兜底折进最近集群的长尾/FAQ
 *   · 映射URL  → 用 cluster+page_type 去 GSC 页匹配：命中且排名好=已上线(live)，
 *               命中但 pos>10=需优化(optimize)，未命中=内容缺口(gap)
 */

// ── 维度类型（取值与 keywords 表 / _utils 配色表严格对齐）─────────────────────
export type Market =
  | "us" | "uk" | "sa" | "id" | "my" | "ae" | "de" | "tr" | "fr" | "au";

export type LayerLevel = "一级核心" | "二级独立" | "三级变体" | "四级兜底";

export type PagePlanningIntent =
  | "知识深度页" | "品类聚合页" | "工具生态页" | "场景使用页"
  | "品牌主页" | "产品详情页" | "门店页";

export type BehaviorIntent =
  | "了解型" | "行动型" | "混合型" | "官网导航" | "对比型" | "线下到访";

/** 页面在主题里的角色：支柱(hub) / 子支柱(sub-hub) / 集群(spoke) */
export type PageRole = "pillar" | "cluster" | "sub-pillar";

/** 页面映射状态：已上线 / 需优化 / 待新建 */
export type PlanStatus = "live" | "optimize" | "gap";

// ── 关键词（落到某个页面节点上的"原料"）──────────────────────────────────────
export type PlanKeyword = {
  keyword: string;
  market: Market | null;
  sv: number | null;
  kd: number | null;
  intent: string | null;
  behaviorIntent: BehaviorIntent | null;
  pagePlanningIntent: PagePlanningIntent;
  layer: LayerLevel;
  questionType: string | null;
  /** 该页的主词（target keyword），其余为支撑词 */
  primary?: boolean;
};

// ── 页面节点（支柱 or 集群）──────────────────────────────────────────────────
export type PageNode = {
  id: string;
  role: PageRole;
  /** 人类可读的页面标题 */
  title: string;
  /** 该页面类型（= page_planning_intent） */
  pageType: PagePlanningIntent;
  status: PlanStatus;
  /** 已上线/需优化 → 真实 URL；待新建 → 建议 slug */
  url: string | null;
  /** 主市场（locale 主体）；其余 locale 变体见 markets */
  market: Market;
  markets: Market[];
  /** 已上线/需优化时的 GSC 现状（待新建为 null） */
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  /** 落在该页上的关键词 */
  keywords: PlanKeyword[];
  /** 备注：规划理由 / 提醒 */
  note?: string;
  /** 直接上级 id；爸爸指向爷爷、孙子指向爸爸；缺省 = 直接挂爷爷 */
  parentId?: string;
  /** 子支柱所属的场景列 id；决定它落进哪一格。缺省=不进矩阵格子，只在行头树里出现 */
  scenarioId?: string;
};

export type Theme = {
  id: string;
  /** 中文主题名 */
  name: string;
  /** 拉丁副标 */
  latin: string;
  /** 对齐的站点 cluster key（CLUSTER_LABELS 里的键）；纯新主题为 "new" */
  clusterKey: string;
  /** 一句话主题说明 */
  summary: string;
  pillar: PageNode;
  clusters: PageNode[];
};

// 便捷构造器：少写样板
const kw = (
  keyword: string,
  market: Market | null,
  sv: number | null,
  kd: number | null,
  layer: LayerLevel,
  ppi: PagePlanningIntent,
  bi: BehaviorIntent | null,
  opts: { intent?: string | null; q?: string | null; primary?: boolean } = {},
): PlanKeyword => ({
  keyword,
  market,
  sv,
  kd,
  layer,
  pagePlanningIntent: ppi,
  behaviorIntent: bi,
  intent: opts.intent ?? null,
  questionType: opts.q ?? null,
  primary: opts.primary,
});

// ════════════════════════════════════════════════════════════════════════════
// 白板骨架（demo 已清空，待重搭）
// 4 个品类行（islamic-jewelry / name-necklace / tasbih / zikr-ring）各一张光杆 pillar，
// 仅 zikr-ring 下挂一张 WESLAMIC 品牌子支柱作为起点内容。
// ════════════════════════════════════════════════════════════════════════════

const THEMES: Theme[] = [
  // ── Islamic Jewelry ───────────────────────────────────────────────────────
  {
    id: "islamic-jewelry",
    name: "伊斯兰饰品",
    latin: "ORNAMENTUM",
    clusterKey: "islamic-jewelry",
    summary: "品类聚合页骨架，待填充。",
    pillar: {
      id: "ij-pillar",
      role: "pillar",
      title: "Islamic Jewelry",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/islamic-jewelry",
      market: "us",
      markets: ["us"],
      position: null,
      clicks: null,
      impressions: null,
      keywords: [],
    },
    clusters: [],
  },

  // ── Name Necklace ─────────────────────────────────────────────────────────
  {
    id: "name-necklace",
    name: "定制项链",
    latin: "NOMEN",
    clusterKey: "name-necklace",
    summary: "品类聚合页骨架，待填充。",
    pillar: {
      id: "nn-pillar",
      role: "pillar",
      title: "Name Necklace",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/name-necklace",
      market: "us",
      markets: ["us"],
      position: null,
      clicks: null,
      impressions: null,
      keywords: [],
    },
    clusters: [],
  },

  // ── Tasbih ────────────────────────────────────────────────────────────────
  {
    id: "tasbih",
    name: "念珠",
    latin: "TASBIH",
    clusterKey: "tasbih",
    summary: "品类聚合页骨架，待填充。",
    pillar: {
      id: "tb-pillar",
      role: "pillar",
      title: "Tasbih",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/tasbih",
      market: "us",
      markets: ["us"],
      position: null,
      clicks: null,
      impressions: null,
      keywords: [],
    },
    clusters: [],
  },

  // ── Zikr Ring ─────────────────────────────────────────────────────────────
  {
    id: "zikr-ring",
    name: "智能念珠戒指",
    latin: "ANNULUS",
    clusterKey: "zikr-ring",
    summary: "品类聚合页骨架 + WESLAMIC 品牌起点。",
    pillar: {
      id: "zr-pillar",
      role: "pillar",
      title: "Zikr Ring",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/zikr-ring",
      market: "us",
      markets: ["us"],
      position: null,
      clicks: null,
      impressions: null,
      keywords: [],
    },
    clusters: [
      {
        id: "zr-sp-brand",
        role: "sub-pillar",
        title: "WESLAMIC 品牌主页",
        pageType: "品牌主页",
        status: "live",
        url: "/collections/all",
        market: "us",
        markets: ["us"],
        position: null,
        clicks: null,
        impressions: null,
        parentId: "zr-pillar",
        scenarioId: "brand",
        keywords: [
          kw("weslamic", null, null, null, "一级核心", "品牌主页", "官网导航", { primary: true }),
          kw("weslamic.com", null, null, null, "一级核心", "品牌主页", "官网导航"),
          kw("weslamic official", null, null, null, "一级核心", "品牌主页", "官网导航"),
        ],
      },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 待规划关键词（尚未归入任何主题 —— 收件箱原料）
// 每条带一个"建议主题"，演示自动归类的方向。
// ════════════════════════════════════════════════════════════════════════════
export type InboxKeyword = PlanKeyword & { suggestedTheme: string | null };

const ix = (k: PlanKeyword, suggestedTheme: string | null): InboxKeyword => ({
  ...k,
  suggestedTheme,
});

const UNASSIGNED: InboxKeyword[] = [];

// ════════════════════════════════════════════════════════════════════════════
// 噪声 / 站外词（与品牌无关，建议剔除 —— 演示规划器能识别偏题词）
// نقل عفش = 搬家具，明显是数据污染，不该进任何页面。
// ════════════════════════════════════════════════════════════════════════════
const EXCLUDED: InboxKeyword[] = [
  ix(kw("نقل عفش بالرياض باكستاني", "sa", 1300, 14, "二级独立", "门店页", "线下到访"), "❌ 搬家服务·偏题"),
  ix(kw("نقل عفش باكستاني", "sa", 390, 14, "二级独立", "产品详情页", "行动型"), "❌ 搬家服务·偏题"),
  ix(kw("افضل شركة نقل عفش بتبوك", "sa", 320, 12, "二级独立", "品类聚合页", "对比型"), "❌ 搬家服务·偏题"),
  ix(kw("does lively wallpaper slow down pc", "us", 140, 29, "二级独立", "知识深度页", "了解型", { q: "does" }), "❌ ‘slow’误聚·偏题"),
];

// ════════════════════════════════════════════════════════════════════════════
// 派生与汇总
// ════════════════════════════════════════════════════════════════════════════

export type PageNodeWithRollup = PageNode & {
  sv: number;
  avgKd: number;
  kwCount: number;
};

export type ThemeWithRollup = Omit<Theme, "pillar" | "clusters"> & {
  pillar: PageNodeWithRollup;
  clusters: PageNodeWithRollup[];
  /** 主题级汇总 */
  sv: number;
  pageCount: number;
  kwCount: number;
  coverage: number; // 0..1，已上线页 / 总页
  liveCount: number;
  optimizeCount: number;
  gapCount: number;
};

function rollupNode(n: PageNode): PageNodeWithRollup {
  const sv = n.keywords.reduce((s, k) => s + (k.sv ?? 0), 0);
  const kds = n.keywords.map((k) => k.kd).filter((v): v is number => v != null);
  const avgKd = kds.length ? Math.round((kds.reduce((s, v) => s + v, 0) / kds.length) * 10) / 10 : 0;
  return { ...n, sv, avgKd, kwCount: n.keywords.length };
}

function rollupTheme(t: Theme): ThemeWithRollup {
  const pillar = rollupNode(t.pillar);
  const clusters = t.clusters.map(rollupNode);
  const pages = [pillar, ...clusters];
  const liveCount = pages.filter((p) => p.status === "live").length;
  const optimizeCount = pages.filter((p) => p.status === "optimize").length;
  const gapCount = pages.filter((p) => p.status === "gap").length;
  return {
    ...t,
    pillar,
    clusters,
    sv: pages.reduce((s, p) => s + p.sv, 0),
    pageCount: pages.length,
    kwCount: pages.reduce((s, p) => s + p.kwCount, 0),
    coverage: pages.length ? liveCount / pages.length : 0,
    liveCount,
    optimizeCount,
    gapCount,
  };
}

export type Blueprint = {
  themes: ThemeWithRollup[];
  unassigned: InboxKeyword[];
  excluded: InboxKeyword[];
};

export function getBlueprint(): Blueprint {
  return {
    themes: THEMES.map(rollupTheme),
    unassigned: UNASSIGNED,
    excluded: EXCLUDED,
  };
}

export type BlueprintStats = {
  themes: number;
  pillars: number;
  clusters: number;
  livePages: number;
  optimizePages: number;
  gapPages: number;
  // 支柱页本身的覆盖状况（每个主题 1 张支柱 → 与主题数不同维度：看"中枢是否已存在"）
  pillarsLive: number;
  pillarsOptimize: number;
  pillarsGap: number;
  coverage: number; // 0..1
  totalSv: number;
  unassigned: number;
  excluded: number;
};

export function getBlueprintStats(): BlueprintStats {
  const b = getBlueprint();
  const allPages = b.themes.flatMap((t) => [t.pillar, ...t.clusters]);
  const livePages = allPages.filter((p) => p.status === "live").length;
  const optimizePages = allPages.filter((p) => p.status === "optimize").length;
  const gapPages = allPages.filter((p) => p.status === "gap").length;
  const pillars = b.themes.map((t) => t.pillar);
  return {
    themes: b.themes.length,
    pillars: b.themes.length,
    clusters: b.themes.reduce((s, t) => s + t.clusters.length, 0),
    livePages,
    optimizePages,
    gapPages,
    pillarsLive: pillars.filter((p) => p.status === "live").length,
    pillarsOptimize: pillars.filter((p) => p.status === "optimize").length,
    pillarsGap: pillars.filter((p) => p.status === "gap").length,
    coverage: allPages.length ? livePages / allPages.length : 0,
    totalSv: allPages.reduce((s, p) => s + p.sv, 0),
    unassigned: b.unassigned.length,
    excluded: b.excluded.length,
  };
}
