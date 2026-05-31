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

/** 页面在主题里的角色：支柱(hub) / 集群(spoke) */
export type PageRole = "pillar" | "cluster";

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
// 主题数据集（9 个真实主题 + 待规划词 + 噪声）
// ════════════════════════════════════════════════════════════════════════════

const THEMES: Theme[] = [
  // ── 1. 智能指环（支柱已上线，覆盖最好的旗舰主题）──────────────────────────
  {
    id: "zikr-ring",
    name: "智能指环",
    latin: "ANNULUS",
    clusterKey: "zikr-ring",
    summary: "品牌核心品类。支柱已稳居首页前列，缺一篇科普支撑页吃掉‘what/halal’长尾。",
    pillar: {
      id: "zr-pillar",
      role: "pillar",
      title: "Zikr Ring 智能念珠戒指 · 品类页",
      pageType: "品类聚合页",
      status: "live",
      url: "/collections/zikr-ring",
      market: "us",
      markets: ["us", "uk", "id", "my", "tr", "de", "fr", "ae"],
      position: 5.3,
      clicks: 632,
      impressions: 9210,
      note: "支柱已上线且 8 个 locale 变体齐全，重点是内链承接下方集群。",
      keywords: [
        kw("zikr ring", "us", 320, 11, "一级核心", "品类聚合页", "行动型", { primary: true }),
        kw("zikr ring", "uk", 480, 16, "一级核心", "品类聚合页", "混合型"),
        kw("zikr ring", "id", 480, 16, "一级核心", "品类聚合页", "行动型"),
        kw("zikr ring", "my", 480, 16, "一级核心", "品类聚合页", "行动型"),
        kw("zikr ring", "de", 260, 14, "一级核心", "品类聚合页", "行动型"),
        kw("zikr ring", "tr", 260, 25, "一级核心", "品类聚合页", "行动型"),
        kw("zikr ring counter", "us", 820, 38, "一级核心", "品类聚合页", "行动型"),
        kw("خاتم ذكي", "sa", 720, 22, "一级核心", "品类聚合页", "了解型"),
        kw("zikr ring gift", "uk", 170, 8, "二级独立", "场景使用页", "行动型"), // demo
      ],
    },
    clusters: [
      {
        id: "zr-c-know",
        role: "cluster",
        title: "What Is a Zikr Ring? 科普与合规答疑",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/zikr-ring/what-is-a-zikr-ring",
        market: "us",
        markets: ["us"],
        position: null,
        clicks: null,
        impressions: null,
        note: "高商业关联(BP3)的问答长尾全无承接页，是当前最值得补的缺口。",
        keywords: [
          kw("what is zikr ring", "us", 320, 11, "一级核心", "知识深度页", "了解型", { q: "what", primary: true }),
          kw("are zikr rings halal", "us", 30, 8, "一级核心", "知识深度页", "了解型", { q: "are" }),
          kw("does zikr ring vibrate", "us", 40, 9, "一级核心", "知识深度页", "了解型", { q: "does" }),
          kw("how to use zikr ring", "us", 90, 14, "一级核心", "知识深度页", "了解型", { q: "how" }),
        ],
      },
      {
        id: "zr-c-pdp",
        role: "cluster",
        title: "Zikr Ring 产品详情页",
        pageType: "产品详情页",
        status: "live",
        url: "/products/zikr-ring-itasbih-salam",
        market: "us",
        markets: ["us"],
        position: 5.1,
        clicks: 288,
        impressions: 7952,
        keywords: [
          kw("zikr ring price", "us", 90, 15, "一级核心", "产品详情页", "行动型", { intent: "Commercial", primary: true }),
          kw("black zikr ring", "us", 50, 9, "一级核心", "产品详情页", "行动型"),
        ],
      },
    ],
  },

  // ── 2. Dhikr 与念诵知识（集群内容多、支柱缺失的最大知识洼地）────────────────
  {
    id: "knowledge-dhikr",
    name: "Dhikr 念诵知识",
    latin: "DHIKR",
    clusterKey: "knowledge-dhikr",
    summary: "流量最大的知识簇（dzikir 单词 SV 40,500），博客零散却无支柱页归拢权重。",
    pillar: {
      id: "kd-pillar",
      role: "pillar",
      title: "What Is Dhikr? 念诵终极指南（支柱）",
      pageType: "知识深度页",
      status: "gap",
      url: "/blogs/dhikr/what-is-dhikr",
      market: "id",
      markets: ["id", "us", "uk", "my", "sa"],
      position: null,
      clicks: null,
      impressions: null,
      note: "knowledge-dhikr 簇有 79 个博客在跑但无 hub，新建支柱归拢内链是 30%→提升的关键。",
      keywords: [
        kw("dzikir", "id", 40500, 32, "二级独立", "知识深度页", "了解型", { intent: "Informational", primary: true }),
        kw("what is dhikr", "uk", 320, 20, "二级独立", "知识深度页", "了解型", { q: "what" }),
        kw("what is dhikr", "us", 320, 11, "二级独立", "知识深度页", "了解型", { q: "what" }),
        kw("what is dhikr in islam", "us", 110, 14, "二级独立", "知识深度页", "了解型", { q: "what" }),
        kw("zikr", "my", 210, 24, "二级独立", "知识深度页", "了解型"),
        kw("how to do dhikr", "uk", 170, 27, "二级独立", "知识深度页", "了解型", { q: "how" }),
        kw("how to do dhikr", "us", 140, 23, "二级独立", "知识深度页", "了解型", { q: "how" }),
      ],
    },
    clusters: [
      {
        id: "kd-c-salatul",
        role: "cluster",
        title: "How to Pray Salatul Tasbih 跨市场指南",
        pageType: "知识深度页",
        status: "optimize",
        url: "/blogs/muslim/how-to-pray-salatul-tasbih",
        market: "uk",
        markets: ["uk", "us", "sa", "ae"],
        position: 11.4,
        clicks: 41,
        impressions: 5120,
        note: "同一意图被 10+ 个 locale 长尾切碎，合并到一篇可解决自我蚕食。",
        keywords: [
          kw("how to pray salatul tasbih", "uk", 320, 5, "二级独立", "知识深度页", "了解型", { q: "how", primary: true }),
          kw("how to pray salatul tasbih", "us", 260, 21, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to pray salatul tasbih", "sa", 210, 14, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to pray salatul tasbih", "ae", 140, 12, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to pray salatul tasbih prayer", "us", 210, 2, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to do salatul tasbih", "uk", 590, 8, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to do salatul tasbih", "us", 210, 16, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to perform salatul tasbih", "uk", 320, 9, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to perform salatul tasbih", "us", 140, 6, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to read salatul tasbih", "us", 210, 7, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("how to read salatul tasbih", "uk", 110, 6, "二级独立", "知识深度页", "了解型", { q: "how" }),
          kw("salatul tasbih padhne ka tarika", "sa", 260, 23, "二级独立", "知识深度页", "了解型"),
        ],
      },
      {
        id: "kd-c-after",
        role: "cluster",
        title: "Dhikr / Zikr After Prayer 念诵时机",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/dhikr/dhikr-after-salah",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("dhikr after salah", "uk", 390, 11, "二级独立", "知识深度页", "了解型", { primary: true }),
          kw("dhikr after namaz", "uk", 480, 12, "二级独立", "知识深度页", "了解型"),
          kw("zikr after namaz", "uk", 590, 11, "二级独立", "知识深度页", "了解型"),
          kw("zikr after prayer", "uk", 480, 15, "二级独立", "知识深度页", "了解型"),
        ],
      },
      {
        id: "kd-c-apaitu",
        role: "cluster",
        title: "Apa Itu Tasbih 印尼语/马来语科普",
        pageType: "知识深度页",
        status: "optimize",
        url: "/id/blogs/muslim/apa-itu-tasbih",
        market: "id",
        markets: ["id", "my", "uk", "ae"],
        position: 13.2,
        clicks: 18,
        impressions: 2240,
        keywords: [
          kw("apa itu tasbih", "id", 720, 22, "二级独立", "知识深度页", "了解型", { q: "other", primary: true }),
          kw("apa itu tasbih", "my", 720, 22, "二级独立", "知识深度页", "了解型", { q: "other" }),
          kw("apa itu sholat tasbih", "id", 590, 30, "二级独立", "知识深度页", "了解型", { q: "other" }),
          kw("apa itu sholat tasbih", "my", 590, 30, "二级独立", "知识深度页", "了解型", { q: "other" }),
          kw("tata cara sholat tasbih", "sa", 320, 25, "二级独立", "知识深度页", "了解型"),
          kw("berapa rakaat shalat tasbih", "id", 390, 30, "二级独立", "知识深度页", "了解型", { q: "other" }),
        ],
      },
      {
        id: "kd-c-whatis",
        role: "cluster",
        title: "What Is Tasbih? 英语科普",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/dhikr/what-is-tasbih",
        market: "us",
        markets: ["us", "uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("what is tasbih", "us", 210, 0, "二级独立", "知识深度页", "了解型", { q: "what", primary: true }),
          kw("what is a tasbih", "us", 170, 0, "二级独立", "知识深度页", "了解型", { q: "what" }),
          kw("what is tasbih", "uk", 140, 6, "二级独立", "知识深度页", "了解型", { q: "what" }),
          kw("tasbih prayer", "sa", 390, 16, "二级独立", "知识深度页", "了解型"),
        ],
      },
    ],
  },

  // ── 3. 数字念珠工具（支柱为 landing，已上线）──────────────────────────────
  {
    id: "itasbih-tools",
    name: "数字念珠工具",
    latin: "INSTRUMENTUM",
    clusterKey: "itasbih-app",
    summary: "iTasbih 工具生态。落地页已上线，产品页承接转化，补一篇 misbaha 科普即闭环。",
    pillar: {
      id: "it-pillar",
      role: "pillar",
      title: "iTasbih 数字念珠计数器（落地页）",
      pageType: "工具生态页",
      status: "live",
      url: "/pages/itasbih-manual",
      market: "my",
      markets: ["my", "sa", "fr", "id", "ar", "tr"] as Market[],
      position: 5.0,
      clicks: 92,
      impressions: 1840,
      keywords: [
        kw("tasbeeh counter", "my", 2400, 25, "一级核心", "工具生态页", "行动型", { primary: true }),
        kw("tasbih digital counter", "my", 1300, 26, "一级核心", "工具生态页", "行动型"),
        kw("digital tasbeeh", "sa", 210, 26, "一级核心", "工具生态页", "行动型"),
        kw("digital tasbih", "sa", 210, 26, "一级核心", "工具生态页", "行动型"),
      ],
    },
    clusters: [
      {
        id: "it-c-pdp",
        role: "cluster",
        title: "iTasbih Fit 智能戒指（产品页）",
        pageType: "产品详情页",
        status: "live",
        url: "/products/weslamic-itasbih-fit-smart-dhikr-with-health-tracking",
        market: "us",
        markets: ["us"],
        position: 4.8,
        clicks: 66,
        impressions: 1370,
        keywords: [
          kw("itasbih fit", "us", 320, 18, "一级核心", "产品详情页", "行动型", { primary: true }),
        ],
      },
      {
        id: "it-c-online",
        role: "cluster",
        title: "Tasbih Counter Online 工具变体",
        pageType: "工具生态页",
        status: "optimize",
        url: "/pages/tasbih-counter",
        market: "sa",
        markets: ["sa", "ae"],
        position: 16.5,
        clicks: 7,
        impressions: 980,
        keywords: [
          kw("tasbeeh", "sa", 720, 24, "二级独立", "工具生态页", "混合型", { primary: true }),
          kw("tasbih", "sa", 1000, 27, "二级独立", "工具生态页", "行动型"),
          kw("tasbih", "ae", 880, 36, "二级独立", "工具生态页", "了解型"),
        ],
      },
      {
        id: "it-c-misbaha",
        role: "cluster",
        title: "Misbaha 念珠百科",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/tasbih/what-is-a-misbaha",
        market: "sa",
        markets: ["sa"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("misbaha", "sa", 170, 30, "三级变体", "知识深度页", "混合型", { primary: true }),
        ],
      },
    ],
  },

  // ── 4. 朝向与指南针工具（纯缺口，最大蓝海）────────────────────────────────
  {
    id: "qibla-finder",
    name: "朝向指南针工具",
    latin: "QIBLA",
    clusterKey: "new",
    summary: "全新主题、零覆盖：聚合 SV 近 1 万的高频工具词，建一个 Qibla Finder 工具即可起量。",
    pillar: {
      id: "qf-pillar",
      role: "pillar",
      title: "Qibla Finder 在线朝向工具（支柱）",
      pageType: "工具生态页",
      status: "gap",
      url: "/pages/qibla-finder",
      market: "my",
      markets: ["my", "ae", "id", "us", "uk"],
      position: null,
      clicks: null,
      impressions: null,
      note: "站内完全无朝向工具页，竞品全靠工具页吃这批词 —— 最高优先级新建。",
      keywords: [
        kw("qiblah finder", "my", 1900, 0, "二级独立", "工具生态页", "行动型", { primary: true }),
        kw("qibla compass", "my", 1900, 33, "二级独立", "工具生态页", "行动型"),
        kw("kaaba compass", "my", 1900, 27, "二级独立", "工具生态页", "行动型"),
        kw("qibla finder online", "my", 880, 37, "二级独立", "工具生态页", "行动型"),
        kw("qiblah", "my", 390, 40, "二级独立", "工具生态页", "了解型"),
        kw("qiblah fonder", "my", 720, 40, "二级独立", "工具生态页", "行动型"),
      ],
    },
    clusters: [
      {
        id: "qf-c-direction",
        role: "cluster",
        title: "Kaaba Direction 方位答疑",
        pageType: "工具生态页",
        status: "gap",
        url: "/pages/kaaba-direction",
        market: "us",
        markets: ["us", "uk", "ae", "id"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("kaaba direction", "ae", 1900, 29, "二级独立", "工具生态页", "行动型", { primary: true }),
          kw("kaba direction", "id", 480, 34, "二级独立", "工具生态页", "行动型"),
          kw("which way is mecca", "id", 590, 31, "二级独立", "工具生态页", "了解型"),
          kw("which direction is kaaba", "us", 170, 30, "二级独立", "工具生态页", "了解型", { q: "which" }),
          kw("which direction is kaaba", "uk", 110, 30, "二级独立", "工具生态页", "了解型", { q: "which" }),
          kw("what direction is the kaaba", "us", 110, 28, "二级独立", "工具生态页", "了解型", { q: "what" }),
          kw("what is the direction of kaaba", "uk", 260, 34, "二级独立", "工具生态页", "了解型", { q: "what" }),
          kw("how to locate kaaba direction", "uk", 170, 27, "二级独立", "工具生态页", "了解型", { q: "how" }),
        ],
      },
    ],
  },

  // ── 5. 礼赠场景（支柱是博客代偿，需优化为合集）────────────────────────────
  {
    id: "muslim-gifts",
    name: "礼赠场景",
    latin: "DONUM",
    clusterKey: "scene-gift",
    summary: "节日礼赠流量稳定。当前靠一篇博客代偿支柱(#4)，建议升级为礼物合集页吃转化。",
    pillar: {
      id: "mg-pillar",
      role: "pillar",
      title: "Islamic Gifts 穆斯林礼物合集（支柱）",
      pageType: "场景使用页",
      status: "optimize",
      url: "/blogs/muslim/what-is-an-appropriate-gift-to-give-a-muslim",
      market: "uk",
      markets: ["uk", "us", "de", "id", "ar", "tr"] as Market[],
      position: 4.3,
      clicks: 616,
      impressions: 77231,
      note: "博客在跑(#4,616 点击)但不带货，升级/旁建 /collections/islamic-gifts 承接行动型词。",
      keywords: [
        kw("islamic gifts", "uk", 1000, 36, "二级独立", "场景使用页", "行动型", { primary: true }),
        kw("islamic gift", "uk", 320, 35, "二级独立", "品类聚合页", "行动型"),
        kw("gifts islamic", "uk", 720, 32, "二级独立", "品类聚合页", "对比型", { intent: "Commercial" }),
        kw("islam present", "uk", 1300, 7, "二级独立", "品类聚合页", "行动型"),
        kw("gifts islam", "uk", 1300, 22, "四级兜底", "品类聚合页", "混合型"),
      ],
    },
    clusters: [
      {
        id: "mg-c-ramadan",
        role: "cluster",
        title: "Ramadan Gifts 斋月礼物",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/ramadan-gifts",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("ramadan gifts", "uk", 1600, 16, "二级独立", "场景使用页", "行动型", { primary: true }),
          kw("gifts of ramadan", "uk", 2400, 17, "四级兜底", "场景使用页", "混合型"),
          kw("ramadan gift ideas", "uk", 720, 25, "二级独立", "场景使用页", "对比型"),
          kw("gift ramadan", "uk", 590, 13, "二级独立", "场景使用页", "对比型"),
        ],
      },
      {
        id: "mg-c-eid",
        role: "cluster",
        title: "Eid Gifts 开斋节礼物",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/eid-gifts",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("eid gifts", "uk", 4400, 16, "二级独立", "场景使用页", "行动型", { primary: true }),
          kw("eid presents", "uk", 1300, 20, "四级兜底", "场景使用页", "混合型"),
        ],
      },
      {
        id: "mg-c-umrah",
        role: "cluster",
        title: "Umrah Gifts 朝觐礼物",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/umrah-gifts",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("umrah gifts", "uk", 1000, 12, "二级独立", "场景使用页", "行动型", { primary: true }),
          kw("umrah mubarak gifts", "uk", 2400, 5, "二级独立", "场景使用页", "行动型"),
        ],
      },
      {
        id: "mg-c-wedding",
        role: "cluster",
        title: "Islamic Wedding Gifts 婚礼礼物",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/islamic-wedding-gifts",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("islamic wedding gifts", "uk", 390, 17, "二级独立", "场景使用页", "行动型", { intent: "Commercial", primary: true }),
          kw("gift for islamic wedding", "uk", 260, 5, "二级独立", "场景使用页", "行动型"),
          kw("islamic gifts for wedding", "uk", 320, 4, "二级独立", "场景使用页", "对比型"),
          kw("islamic gifts for women", "uk", 320, 3, "二级独立", "场景使用页", "对比型"),
        ],
      },
    ],
  },

  // ── 6. 伊斯兰饰品（支柱缺失、现有页弱，分品类铺集群）──────────────────────
  {
    id: "islamic-jewelry",
    name: "伊斯兰饰品",
    latin: "ORNAMENTUM",
    clusterKey: "islamic-jewelry",
    summary: "品类词量大但站内仅零散弱页。需一个总合集支柱 + 按品类拆集群（项链/手链/耳饰/戒指）。",
    pillar: {
      id: "ij-pillar",
      role: "pillar",
      title: "Islamic Jewelry 伊斯兰饰品总合集（支柱）",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/islamic-jewelry",
      market: "uk",
      markets: ["uk", "my", "sa", "id"],
      position: null,
      clicks: null,
      impressions: null,
      note: "islamic-jewelry 簇 10 页全 0 点击 —— 缺一个真正的品类支柱统领。",
      keywords: [
        kw("islamic jewelry", "uk", 260, 11, "二级独立", "品类聚合页", "行动型", { intent: "Informational,Commercial", primary: true }),
        kw("muslim jewelry", "us", 480, 18, "二级独立", "品类聚合页", "行动型"), // demo
        kw("islamic jewelry gift", "uk", 390, 15, "二级独立", "场景使用页", "行动型"), // demo
        kw("islamic necklace", "us", 320, 14, "二级独立", "品类聚合页", "行动型"), // demo
      ],
    },
    clusters: [
      {
        id: "ij-c-bracelet",
        role: "cluster",
        title: "Bracelets 手链与手饰",
        pageType: "品类聚合页",
        status: "gap",
        url: "/collections/bracelets",
        market: "my",
        markets: ["my", "id", "sa"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("bracelet", "my", 8100, 21, "二级独立", "品类聚合页", "行动型", { primary: true }),
          kw("bracelets for women", "id", 2900, 23, "二级独立", "品类聚合页", "行动型"),
          kw("bracelet for women", "id", 1900, 16, "四级兜底", "品类聚合页", "混合型"),
          kw("hand chain", "my", 3600, 9, "二级独立", "品类聚合页", "行动型"),
          kw("hand chain", "sa", 590, 12, "二级独立", "品类聚合页", "行动型"),
          kw("bracelet for girls", "sa", 210, 19, "二级独立", "品类聚合页", "行动型"),
        ],
      },
      {
        id: "ij-c-earrings",
        role: "cluster",
        title: "Earrings 耳饰",
        pageType: "品类聚合页",
        status: "gap",
        url: "/collections/earrings",
        market: "my",
        markets: ["my"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("bow earrings", "my", 2900, 12, "二级独立", "品类聚合页", "行动型", { primary: true }),
          kw("hoop earrings", "my", 1600, 15, "二级独立", "品类聚合页", "行动型"),
          kw("ladies gold earrings", "my", 1900, 10, "二级独立", "品类聚合页", "行动型"),
        ],
      },
      {
        id: "ij-c-rings",
        role: "cluster",
        title: "Rings & Aqeeq 戒指与宝石",
        pageType: "品类聚合页",
        status: "gap",
        url: "/collections/rings",
        market: "sa",
        markets: ["sa"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("nose ring", "sa", 1600, 21, "二级独立", "品类聚合页", "行动型", { primary: true }),
          kw("aqeeq stone", "sa", 880, 17, "四级兜底", "品类聚合页", "混合型"),
          kw("aqeeq ring", "sa", 210, 14, "四级兜底", "品类聚合页", "混合型"),
          kw("anklet", "sa", 880, 14, "四级兜底", "品类聚合页", "混合型"),
        ],
      },
    ],
  },

  // ── 6a. Name Necklace 定制项链（原 islamic-jewelry 子集群，提升为独立经线行 · 转化最好的子品类）──
  {
    id: "name-necklace",
    name: "定制项链",
    latin: "NOMEN",
    clusterKey: "islamic-jewelry",
    summary: "刻字/名字定制项链——伊斯兰饰品下转化最好的子品类（gold name necklace 2.9K，已上线需优化）。独立成经线行，专注承接定制项链意图。",
    pillar: {
      id: "ij-c-necklace",
      role: "pillar",
      title: "Name Necklace 定制项链",
      pageType: "品类聚合页",
      status: "optimize",
      url: "/collections/name-necklace",
      market: "uk",
      markets: ["uk", "ae", "sa", "id", "my"],
      position: 18.4,
      clicks: 9,
      impressions: 1310,
      note: "已上线 position 18.4，gold name necklace 2.9K 是站内现成转化点，优化空间大。",
      keywords: [
        kw("gold name necklace", "uk", 2900, 11, "二级独立", "品类聚合页", "行动型", { intent: "Commercial", primary: true }),
        kw("gold name necklace", "ae", 480, 6, "二级独立", "品类聚合页", "行动型"),
        kw("gold name necklace", "sa", 210, 14, "二级独立", "品类聚合页", "行动型"),
        kw("arabic name necklace", "sa", 210, 17, "二级独立", "品类聚合页", "行动型"),
        kw("necklace", "my", 6600, 19, "四级兜底", "品类聚合页", "混合型"),
        kw("necklace for women", "id", 1300, 17, "四级兜底", "品类聚合页", "混合型"),
        kw("mens necklaces", "my", 1900, 13, "二级独立", "品类聚合页", "行动型"),
      ],
    },
    clusters: [],
  },

  // ── 6b. Tasbih 念珠（品类经线中段：Islamic Jewelry → Tasbih → Zikr Ring）── demo
  {
    id: "tasbih",
    name: "Tasbih 念珠",
    latin: "TASBIH",
    clusterKey: "tasbih",
    summary: "品类漏斗中段桥品类。承接 Islamic Jewelry 泛流量，桥接到 Zikr Ring 智能念珠成交。",
    pillar: {
      id: "tb-pillar", // demo
      role: "pillar",
      title: "Tasbih Prayer Beads 念珠品类页",
      pageType: "品类聚合页",
      status: "gap",
      url: "/collections/tasbih",
      market: "us",
      markets: ["us", "uk", "my", "sa", "id"],
      position: null,
      clicks: null,
      impressions: null,
      note: "demo · 品类漏斗中段，承接泛珠宝流量、桥接到 Zikr Ring",
      keywords: [
        kw("tasbih beads", "us", 1600, 20, "一级核心", "品类聚合页", "行动型", { primary: true }), // demo
        kw("prayer beads tasbih", "uk", 590, 18, "二级独立", "品类聚合页", "混合型"), // demo
        kw("tasbih necklace", "us", 320, 15, "二级独立", "品类聚合页", "行动型"), // demo
      ],
    },
    clusters: [
      {
        id: "tb-c-wood", // demo
        role: "cluster",
        title: "Wood Tasbih 木质念珠",
        pageType: "品类聚合页",
        status: "gap",
        url: "/collections/wood-tasbih",
        market: "us",
        markets: ["us", "uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("wood tasbih", "us", 480, 12, "二级独立", "品类聚合页", "行动型", { primary: true }), // demo
          kw("wooden prayer beads", "uk", 320, 14, "二级独立", "品类聚合页", "行动型"), // demo
        ],
      },
      {
        id: "tb-c-gemstone", // demo
        role: "cluster",
        title: "Gemstone Tasbih 宝石念珠",
        pageType: "品类聚合页",
        status: "gap",
        url: "/collections/gemstone-tasbih",
        market: "sa",
        markets: ["sa", "ae"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("gemstone tasbih", "sa", 390, 16, "二级独立", "品类聚合页", "行动型", { primary: true }), // demo
        ],
      },
      {
        id: "tb-c-gift", // demo
        role: "cluster",
        title: "Tasbih Gift Set 念珠礼盒",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/tasbih-gift",
        market: "uk",
        markets: ["uk", "us"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("tasbih gift", "uk", 480, 10, "二级独立", "场景使用页", "行动型", { primary: true }), // demo
          kw("tasbih gift set", "us", 260, 8, "二级独立", "场景使用页", "行动型"), // demo
        ],
      },
      {
        id: "tb-c-ramadan", // demo
        role: "cluster",
        title: "Ramadan Tasbih 斋月念珠",
        pageType: "场景使用页",
        status: "gap",
        url: "/collections/ramadan-tasbih",
        market: "uk",
        markets: ["uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("ramadan tasbih", "uk", 590, 12, "二级独立", "场景使用页", "行动型", { primary: true }), // demo
          kw("eid tasbih", "uk", 320, 10, "二级独立", "场景使用页", "行动型"), // demo
        ],
      },
      {
        id: "tb-c-digital", // demo
        role: "cluster",
        title: "Digital Tasbih Counter 数字念珠",
        pageType: "工具生态页",
        status: "optimize",
        url: "/pages/digital-tasbih",
        market: "my",
        markets: ["my", "sa"],
        position: 14.2,
        clicks: 12,
        impressions: 680,
        keywords: [
          kw("digital tasbih counter", "my", 720, 22, "二级独立", "工具生态页", "行动型", { primary: true }), // demo
          kw("electronic tasbih", "sa", 210, 18, "三级变体", "工具生态页", "行动型"), // demo
        ],
      },
      {
        id: "tb-c-dhikr", // demo
        role: "cluster",
        title: "Tasbih for Dhikr 念诵用念珠指南",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/tasbih/tasbih-for-dhikr",
        market: "us",
        markets: ["us", "uk"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("tasbih dhikr", "us", 210, 14, "二级独立", "知识深度页", "了解型", { primary: true }), // demo
          kw("how to use tasbih for dhikr", "uk", 170, 12, "三级变体", "知识深度页", "了解型", { q: "how" }), // demo
        ],
      },
    ],
  },

  // ── 7. 慢生活内容（纯缺口，高 SV 但偏核心外，战略取舍）──────────────────────
  {
    id: "slow-living",
    name: "慢生活内容",
    latin: "OTIUM",
    clusterKey: "scene-slow",
    summary: "slow living 单词 SV 22,200，但离品牌核心较远——属‘吸顶部流量、弱转化’的战略性内容主题。",
    pillar: {
      id: "sl-pillar",
      role: "pillar",
      title: "Slow Living 慢生活指南（支柱）",
      pageType: "知识深度页",
      status: "gap",
      url: "/blogs/slow-living/slow-living-guide",
      market: "id",
      markets: ["id", "uk", "us"],
      position: null,
      clicks: null,
      impressions: null,
      note: "高 SV 但 BP 低(产品关联弱)，建议作为‘品牌调性/拉新’内容，不强求转化。",
      keywords: [
        kw("slow living", "id", 22200, 28, "二级独立", "知识深度页", "了解型", { intent: "Informational", primary: true }),
        kw("slow living", "uk", 590, 28, "二级独立", "知识深度页", "了解型"),
        kw("what is slow living", "us", 260, 30, "二级独立", "知识深度页", "了解型", { q: "what" }),
        kw("how to embrace slow living", "us", 40, 12, "四级兜底", "知识深度页", "了解型", { q: "how" }),
      ],
    },
    clusters: [
      {
        id: "sl-c-night",
        role: "cluster",
        title: "Night Routine 夜间仪式",
        pageType: "知识深度页",
        status: "gap",
        url: "/blogs/slow-living/muslim-night-routine",
        market: "id",
        markets: ["id", "us"],
        position: null,
        clicks: null,
        impressions: null,
        keywords: [
          kw("night routine", "id", 720, 30, "二级独立", "知识深度页", "了解型", { primary: true }),
          kw("what should your night skincare routine be", "us", 40, 14, "四级兜底", "知识深度页", "了解型", { q: "what" }),
          kw("which serum is best for night routine", "us", 30, 17, "四级兜底", "场景使用页", "对比型", { q: "which" }),
        ],
      },
    ],
  },

  // ── 8. 品牌站点（基本已上线，导航/账户类）──────────────────────────────────
  {
    id: "brand",
    name: "品牌站点",
    latin: "INSIGNE",
    clusterKey: "brand",
    summary: "品牌词与账户/导航页基本已覆盖，维护即可；重点是首页与全站合集的内链中枢作用。",
    pillar: {
      id: "br-pillar",
      role: "pillar",
      title: "WESLAMIC 品牌主页 / 全站合集（支柱）",
      pageType: "品牌主页",
      status: "live",
      url: "/collections/all",
      market: "us",
      markets: ["us", "ar", "id", "tr", "de", "fr"] as Market[],
      position: 3.3,
      clicks: 1190,
      impressions: 13687,
      keywords: [
        kw("weslamic", null, null, null, "一级核心", "品牌主页", "官网导航", { primary: true }),
        kw("weslamic.com", null, null, null, "一级核心", "品牌主页", "官网导航"),
        kw("weslamic official", null, null, null, "一级核心", "品牌主页", "官网导航"),
        kw("salam occasions", "uk", 480, 16, "一级核心", "品牌主页", "官网导航", { intent: "Navigational" }),
      ],
    },
    clusters: [
      {
        id: "br-c-account",
        role: "cluster",
        title: "账户与订单（登录 / 物流 / 客服）",
        pageType: "工具生态页",
        status: "live",
        url: "/account",
        market: "us",
        markets: ["us"],
        position: 6.1,
        clicks: 34,
        impressions: 410,
        keywords: [
          kw("weslamic login", null, null, null, "一级核心", "品牌主页", "官网导航", { primary: true }),
          kw("weslamic order tracking", null, null, null, "一级核心", "工具生态页", "行动型"),
          kw("weslamic customer service", null, null, null, "一级核心", "品牌主页", "官网导航"),
        ],
      },
      {
        id: "br-c-aisha",
        role: "cluster",
        title: "Aisha's Charms 子品牌",
        pageType: "品牌主页",
        status: "optimize",
        url: "/collections/aishas-charms",
        market: "my",
        markets: ["my"],
        position: 12.8,
        clicks: 5,
        impressions: 340,
        keywords: [
          kw("aisha's charms", "my", 1600, 19, "二级独立", "品牌主页", "官网导航", { primary: true }),
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

const UNASSIGNED: InboxKeyword[] = [
  ix(kw("abaya", "us", 33100, 40, "四级兜底", "品类聚合页", "混合型"), "伊斯兰饰品 → 服饰新分支?"),
  ix(kw("prayer mat", "us", 5400, 21, "二级独立", "品类聚合页", "行动型", { intent: "Commercial" }), "新主题：礼拜用品"),
  ix(kw("prayer rug", "id", 880, 12, "二级独立", "品类聚合页", "了解型"), "新主题：礼拜用品"),
  ix(kw("prayer beads", "sa", 260, 14, "四级兜底", "品类聚合页", "混合型"), "数字念珠工具 / 礼拜用品"),
  ix(kw("prayer mat praying", "id", 1000, 5, "四级兜底", "品类聚合页", "混合型"), "新主题：礼拜用品"),
  ix(kw("prayer times", "us", 1200, 21, "二级独立", "工具生态页", "了解型", { intent: "Navigational" }), "朝向指南针工具?"),
  ix(kw("why do muslim women wear hijabs", "us", 2900, 30, "二级独立", "知识深度页", "了解型", { q: "why" }), "Dhikr 念诵知识 / 新知识主题"),
  ix(kw("what is a hijab", "us", 1900, 28, "二级独立", "知识深度页", "了解型", { q: "what" }), "新主题：头巾科普"),
  ix(kw("islamic toys", "uk", 390, 5, "二级独立", "品类聚合页", "行动型"), "礼赠场景 / 新品类"),
  ix(kw("smart watch for kids", "sa", 390, 19, "四级兜底", "品类聚合页", "混合型"), "数字念珠工具?(关联弱)"),
];

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
