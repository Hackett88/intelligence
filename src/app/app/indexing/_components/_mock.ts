// 一期 indexing 模块的 mock 数据 — 仅用于 UI 风格定稿，真实数据接入后整个文件删除。
// 字段对齐 GSC Performance API 原生 4 指标 (Clicks / Impressions / CTR / Position)
// + 内部反查字段 (pageType / protected) + 状态字段 (indexState)。
//
// 站点骨架来源：
//   /系统升级/WESLAMIC/02_现状资源/04_技术现状快照/Framer网站/01_站点结构/
//   WESLAMIC 首批（11页）Framer 网站总架构说明.md
// WESLAMIC = 智能 dhikr 饰品品牌（zikr ring / tasbih / personalized necklace / iTASBIH App）
// 首批真实 11 页 + 适度扩展 PDP / 知识文章，让树纵深可达 3-4 层。

export type IndexState = "indexed" | "discovered" | "excluded" | "error";

export type PageRow = {
  id: string;
  url: string;          // 相对路径
  fullUrl: string;      // 完整 URL
  market: string;       // 小写国家码
  pageType: string;     // SEO 页面形态 — 12 类，详见 PAGE_TYPES
  cluster: string;      // 业务集群 key（与 keywords_pool.cluster_id 概念呼应）
  topQuery: string;     // GSC 该 URL 下 clicks 最高的 query
  clicks: number;
  impressions: number;
  ctr: number;          // 0.018 = 1.8%
  position: number;     // 平均排名
  indexState: IndexState;
  trend12m: number[];   // 12 月 clicks 趋势
  lastSync: string;     // ISO 8601 — 客户端 new Date() 解析
  parentId?: string;    // 显式所属：spoke → pillar / 子枢纽 → 上级枢纽
  isPillar?: boolean;   // 是否是 cluster 中心枢纽（PLP / 落地页 / 工具中心等）
  sortOrder: number;    // 业务逻辑排序权重 — 同 parent 内按它升序（不是按 clicks）
  // 该页的关键词排名（top N）。同步时批量抓取一并落库，抽屉/列表直接读，不再懒加载。
  // 合成节点 / 无数据页为空数组。
  queries?: QueryRow[];
  // 树视图聚合用的合成节点（如 /products /collections）：GSC 没返回过它，
  // 但 UI 需要它做 sub-page 的目录入口。这类节点 clicks/impressions 都是 0，
  // 列表视图、SummaryBar、Stats 都应过滤掉。
  isSynthetic?: boolean;
};

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PageDetail = PageRow & {
  queries: QueryRow[];
  poolMatches: number;  // 该 URL 下命中 keywords_pool 的 query 数
};

export type IndexingStats = {
  totalPages: number;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;       // 0.014 = 1.4%
  avgPosition: number;
  top10Pages: number;   // position <= 10 的页数
  lastSync: string;
};

// ───────────────────────────────────────────────────────────────────────────
// WESLAMIC 业务种子数据 — 真实 11 页 Framer 站 + 适度扩展
// ───────────────────────────────────────────────────────────────────────────

const PAGE_TYPES = [
  "首页",
  "产品详情页",
  "品类列表页",
  "博客文章",
  "博客目录",
  "资讯新闻",
  "指南教程",
  "对比页",
  "工具页",
  "落地页",
  "常见问题",
  "关于页",
] as const;

// WESLAMIC 主要市场：英美阿、马来印尼、中东核心、海湾穆斯林移民国
const MARKETS = ["us", "uk", "sa", "ae", "my", "id", "tr", "ca", "au", "de"];

const INDEX_STATES: { state: IndexState; weight: number }[] = [
  { state: "indexed",    weight: 82 },
  { state: "discovered", weight: 11 },
  { state: "excluded",   weight: 5 },
  { state: "error",      weight: 2 },
];

// 业务集群 key — WESLAMIC 商业 / 场景 / 知识三条主线下的细分
// 与 keywords_pool.cluster_id 概念呼应；真实接入后由 GSC topQuery 反查归集
export type ClusterKey =
  | "brand"              // 站点品牌元页（首页 / about / faq / blog 索引）
  | "zikr-ring"          // 智能指环硬件主线（PID-02 + 衍生 PDP）
  | "islamic-jewelry"    // 饰品大类 Hub（PID-05 + 子 PLP + PDP）
  | "tasbih"             // 念珠系列（PID-03 + PDP）
  | "necklace"           // 定制项链（PID-06 + PDP）
  | "itasbih-app"        // iTASBIH App 生态（PID-04 + 子页）
  | "tools"              // 工具页（PID-07 Kaaba Direction 等）
  | "scene-gift"         // 礼赠场景（PID-09）
  | "scene-night"        // 夜间仪式场景（PID-08）
  | "scene-slow"         // 慢生活场景（PID-11）
  | "knowledge-dhikr";   // Dhikr 知识与博客（PID-10 + 博客文章）

// PAGE_SEEDS — slug 为空串 = 首页 "/"；其余 = "/{slug}"。
//
// 「页面所属」字段：
//   parent  — 上级页面的 slug（指向同表中其他 seed）；undefined = 顶层
//   pillar  — true 表示这是某 cluster 的中心枢纽页
//
// 站点骨架（按 SEO Hub-and-Spoke 模型 + 真实信息架构混合）：
//   /                                        PID-01 品牌首页
//   ├─ /collections/zikr-ring                PID-02 [pillar: zikr-ring]
//   │   ├─ /products/zikr-ring-classic       PDP 经典款
//   │   ├─ /products/zikr-ring-gold          PDP 金色款
//   │   └─ /products/zikr-ring-rose-gold     PDP 玫瑰金款
//   ├─ /collections/islamic-jewelry          PID-05 [pillar: islamic-jewelry] 饰品大类
//   │   ├─ /collections/tasbih               PID-03 [sub-pillar: tasbih]
//   │   │   ├─ /products/wooden-tasbih-99    PDP 木质 99 颗
//   │   │   └─ /products/crystal-tasbih      PDP 水晶念珠
//   │   ├─ /collections/personalized-necklace PID-06 [sub-pillar: necklace]
//   │   │   ├─ /products/gold-name-necklace  PDP 金色姓名项链
//   │   │   └─ /products/arabic-script-pendant PDP 阿语吊坠
//   │   └─ /products/islamic-bracelet        PDP 伊斯兰手链
//   ├─ /itasbih                              PID-04 [pillar: itasbih-app]
//   │   ├─ /itasbih/features                 子页 — 功能介绍
//   │   └─ /kaaba-direction                  PID-07 [pillar: tools]
//   ├─ /islamic-gifts                        PID-09 礼赠
//   ├─ /night-routine                        PID-08 夜间场景
//   ├─ /slow-living                          PID-11 慢生活
//   ├─ /what-is-dhikr                        PID-10 知识主页
//   ├─ /blog                                 博客目录
//   │   ├─ /blog/dhikr-meaning-history       博客文章
//   │   ├─ /blog/best-tasbih-counting        博客文章
//   │   └─ /blog/zikr-ring-vs-tasbih         对比页
//   ├─ /faq                                  常见问题
//   └─ /about                                关于页

const PAGE_SEEDS: {
  slug: string;
  type: typeof PAGE_TYPES[number];
  cluster: ClusterKey;
  topic: string;
  queryRoot: string[];
  parent?: string;     // 上级页 slug；undefined = 顶层
  pillar?: boolean;    // 是否为该 cluster 的中心枢纽
}[] = [
  // ── 品牌入口 ──
  { slug: "",                                type: "首页",       cluster: "brand",            topic: "weslamic homepage",
    queryRoot: ["weslamic", "smart dhikr jewelry", "weslamic com", "smart tasbih ring", "weslamic official"] },

  // ── 智能指环硬件主线（PID-02 + 3 PDP） ──
  { slug: "collections/zikr-ring",           type: "落地页",     cluster: "zikr-ring",        topic: "smart dhikr ring",        pillar: true,
    queryRoot: ["smart dhikr ring", "smart tasbih ring", "zikr ring", "electronic tasbih ring", "dhikr counter ring"] },
  { slug: "products/zikr-ring-classic",      type: "产品详情页", cluster: "zikr-ring",        topic: "zikr ring classic",       parent: "collections/zikr-ring",
    queryRoot: ["zikr ring classic", "black dhikr ring", "matte tasbih ring", "minimalist zikr ring", "muslim counter ring"] },
  { slug: "products/zikr-ring-gold",         type: "产品详情页", cluster: "zikr-ring",        topic: "gold zikr ring",          parent: "collections/zikr-ring",
    queryRoot: ["gold zikr ring", "18k tasbih ring", "luxury dhikr ring", "gold smart ring muslim", "premium zikr ring"] },
  { slug: "products/zikr-ring-rose-gold",    type: "产品详情页", cluster: "zikr-ring",        topic: "rose gold zikr ring",     parent: "collections/zikr-ring",
    queryRoot: ["rose gold zikr ring", "zikr ring women", "feminine dhikr ring", "rose gold tasbih ring", "muslim ring women"] },

  // ── 饰品大类 Hub（PID-05） ──
  { slug: "collections/islamic-jewelry",     type: "品类列表页", cluster: "islamic-jewelry",  topic: "islamic jewelry",         pillar: true,
    queryRoot: ["islamic jewelry", "muslim jewelry online", "islamic accessories store", "halal jewelry brand", "modest islamic jewelry"] },

  // ── 念珠系列 (PID-03 + 2 PDP) — 挂在 islamic-jewelry 下 ──
  { slug: "collections/tasbih",              type: "品类列表页", cluster: "tasbih",           topic: "tasbih beads",            parent: "collections/islamic-jewelry", pillar: true,
    queryRoot: ["tasbih", "tasbih beads online", "muslim prayer beads", "99 beads tasbih", "buy tasbih uk"] },
  { slug: "products/wooden-tasbih-99",       type: "产品详情页", cluster: "tasbih",           topic: "wooden tasbih 99 beads",  parent: "collections/tasbih",
    queryRoot: ["wooden tasbih 99 beads", "olive wood tasbih", "natural wood prayer beads", "handmade tasbih", "traditional tasbih"] },
  { slug: "products/crystal-tasbih",         type: "产品详情页", cluster: "tasbih",           topic: "crystal tasbih",          parent: "collections/tasbih",
    queryRoot: ["crystal tasbih", "gemstone prayer beads", "amethyst tasbih", "agate tasbih", "luxury tasbih"] },

  // ── 定制项链 (PID-06 + 2 PDP) — 挂在 islamic-jewelry 下 ──
  { slug: "collections/personalized-necklace", type: "品类列表页", cluster: "necklace",       topic: "gold name necklace",      parent: "collections/islamic-jewelry", pillar: true,
    queryRoot: ["gold name necklace", "personalized arabic necklace", "custom name necklace muslim", "arabic name jewelry", "muslim name pendant"] },
  { slug: "products/gold-name-necklace",     type: "产品详情页", cluster: "necklace",         topic: "custom gold name necklace", parent: "collections/personalized-necklace",
    queryRoot: ["custom gold name necklace", "18k arabic name necklace", "name in arabic gold", "personalized gold pendant", "custom arabic jewelry"] },
  { slug: "products/arabic-script-pendant",  type: "产品详情页", cluster: "necklace",         topic: "arabic script pendant",   parent: "collections/personalized-necklace",
    queryRoot: ["arabic script pendant", "ayat al kursi necklace", "quran verse pendant", "islamic calligraphy necklace", "arabic word necklace"] },

  // ── 单独饰品 PDP（挂在 islamic-jewelry 下，未细分 cluster） ──
  { slug: "products/islamic-bracelet",       type: "产品详情页", cluster: "islamic-jewelry",  topic: "islamic bracelet",        parent: "collections/islamic-jewelry",
    queryRoot: ["islamic bracelet", "muslim men bracelet", "ayat bracelet", "islamic charm bracelet", "muslim wristband"] },

  // ── iTASBIH App 生态 Hub (PID-04 + 子页) ──
  { slug: "itasbih",                         type: "落地页",     cluster: "itasbih-app",      topic: "itasbih app",             pillar: true,
    queryRoot: ["itasbih", "itasbih app", "digital tasbih app", "smart tasbih app android", "tasbih counter app"] },
  { slug: "itasbih/features",                type: "落地页",     cluster: "itasbih-app",      topic: "itasbih features",        parent: "itasbih",
    queryRoot: ["itasbih features", "itasbih app review", "best dhikr app features", "itasbih vs other tasbih apps", "tasbih app sync"] },

  // ── 工具页 (PID-07，挂在 iTASBIH 下) ──
  { slug: "kaaba-direction",                 type: "工具页",     cluster: "tools",            topic: "kaaba direction",         parent: "itasbih", pillar: true,
    queryRoot: ["kaaba direction", "qibla finder", "qibla compass online", "find kaaba direction", "qibla direction app"] },

  // ── 场景页 ──
  { slug: "islamic-gifts",                   type: "落地页",     cluster: "scene-gift",       topic: "islamic gifts",           pillar: true,
    queryRoot: ["islamic gifts", "eid gifts ideas", "ramadan gift guide", "muslim wedding gifts", "halal gift shop"] },
  { slug: "night-routine",                   type: "落地页",     cluster: "scene-night",      topic: "night routine muslim",    pillar: true,
    queryRoot: ["night routine muslim", "muslim bedtime routine", "islamic night dhikr", "evening adhkar", "tahajjud night routine"] },
  { slug: "slow-living",                     type: "落地页",     cluster: "scene-slow",       topic: "slow living muslim",      pillar: true,
    queryRoot: ["slow living muslim", "mindful muslim lifestyle", "islamic mindfulness", "slow living islam", "intentional living muslim"] },

  // ── 知识页 + 博客 ──
  { slug: "what-is-dhikr",                   type: "指南教程",   cluster: "knowledge-dhikr",  topic: "what is dhikr",           pillar: true,
    queryRoot: ["what is dhikr", "meaning of dhikr", "dhikr in islam", "types of dhikr", "benefits of dhikr"] },
  { slug: "blog",                            type: "博客目录",   cluster: "knowledge-dhikr",  topic: "weslamic blog",
    queryRoot: ["weslamic blog", "dhikr blog", "muslim spirituality blog", "tasbih articles", "islamic jewelry blog"] },
  { slug: "blog/dhikr-meaning-history",      type: "博客文章",   cluster: "knowledge-dhikr",  topic: "dhikr meaning history",   parent: "blog",
    queryRoot: ["dhikr meaning history", "origin of dhikr", "dhikr in quran", "prophet dhikr practice", "dhikr sunnah"] },
  { slug: "blog/best-tasbih-counting",       type: "博客文章",   cluster: "knowledge-dhikr",  topic: "best tasbih counting method", parent: "blog",
    queryRoot: ["best tasbih counting method", "how to count tasbih", "33 vs 99 tasbih", "tasbih recitation guide", "dhikr counting rules"] },
  { slug: "blog/zikr-ring-vs-tasbih",        type: "对比页",     cluster: "knowledge-dhikr",  topic: "zikr ring vs traditional tasbih", parent: "blog",
    queryRoot: ["zikr ring vs traditional tasbih", "smart tasbih vs beads", "best dhikr counter", "electronic tasbih review", "ring or beads tasbih"] },

  // ── 站点元页 ──
  { slug: "faq",                             type: "常见问题",   cluster: "brand",            topic: "weslamic faq",
    queryRoot: ["weslamic faq", "weslamic shipping", "zikr ring battery life", "tasbih warranty", "weslamic return policy"] },
  { slug: "about",                           type: "关于页",     cluster: "brand",            topic: "about weslamic",
    queryRoot: ["about weslamic", "weslamic team", "weslamic mission", "weslamic story", "weslamic founder"] },
];

// ───────────────────────────────────────────────────────────────────────────
// 生成器
// ───────────────────────────────────────────────────────────────────────────

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pickIndexState(rnd: () => number): IndexState {
  const total = INDEX_STATES.reduce((sum, x) => sum + x.weight, 0);
  let roll = rnd() * total;
  for (const { state, weight } of INDEX_STATES) {
    if ((roll -= weight) <= 0) return state;
  }
  return "indexed";
}

function generateTrend(clicks: number, rnd: () => number): number[] {
  const base = clicks / 12;
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    const seasonal = m >= 9 ? 1.15 : m <= 2 ? 0.85 : 1;
    const noise = 0.7 + rnd() * 0.6;
    out.push(Math.max(0, Math.round(base * seasonal * noise)));
  }
  return out;
}

function generateQueries(seed: PageRow, queryRoots: string[], rnd: () => number): QueryRow[] {
  const n = 5 + Math.floor(rnd() * 8); // 5-12 条
  const queries: QueryRow[] = [];
  let remainingClicks = seed.clicks;
  let remainingImpr = seed.impressions;
  for (let i = 0; i < n; i++) {
    const root = queryRoots[i % queryRoots.length];
    const variant = i < queryRoots.length ? root : `${root} ${["near me", "uk", "best", "guide", "2026", "review"][i % 6]}`;
    const share = i === n - 1 ? 1 : Math.pow(0.6, i) * (0.3 + rnd() * 0.3);
    const clicks = i === n - 1 ? remainingClicks : Math.max(1, Math.round(seed.clicks * share));
    const impressions = i === n - 1 ? remainingImpr : Math.max(clicks * 8, Math.round(seed.impressions * share));
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const position = Math.max(1, seed.position + (rnd() - 0.5) * 4);
    queries.push({
      query: variant,
      clicks: Math.min(clicks, remainingClicks),
      impressions: Math.min(impressions, remainingImpr),
      ctr: Math.min(ctr, 1),
      position: parseFloat(position.toFixed(1)),
    });
    remainingClicks = Math.max(0, remainingClicks - clicks);
    remainingImpr = Math.max(0, remainingImpr - impressions);
  }
  return queries.sort((a, b) => b.clicks - a.clicks);
}

function generatePages(): PageRow[] {
  const rnd = seeded(20260523);
  // slug → id 映射（用于解析 parent 关系）
  const idBySlug = new Map<string, string>();
  PAGE_SEEDS.forEach((seed, idx) => {
    idBySlug.set(seed.slug, `pg_${String(idx + 1).padStart(4, "0")}`);
  });

  return PAGE_SEEDS.map((seed, idx) => {
    const id = `pg_${String(idx + 1).padStart(4, "0")}`;
    const parentId = seed.parent !== undefined ? idBySlug.get(seed.parent) : undefined;
    const market = MARKETS[Math.floor(rnd() * MARKETS.length)];
    const indexState = pickIndexState(rnd);
    const url = seed.slug === "" ? "/" : `/${seed.slug}`;
    const fullUrl = `https://weslamic.com${url === "/" ? "" : url}`;

    // 收录失败的页面没有 GSC 数据
    if (indexState === "excluded" || indexState === "error") {
      return {
        id, url, fullUrl, market,
        pageType: seed.type,
        cluster: seed.cluster,
        topQuery: "—",
        clicks: 0, impressions: 0, ctr: 0, position: 0,
        indexState,
        trend12m: Array(12).fill(0),
        lastSync: "2026-05-23T03:15:00Z",
        parentId, isPillar: seed.pillar, sortOrder: idx,
      };
    }
    // 正常页：clicks 服从对数尺度（明星页 800-1200，腰部 80-430，长尾 5-85）
    const tier = rnd();
    const clicks = tier < 0.18
      ? Math.round(600 + rnd() * 700)       // 头部 18%
      : tier < 0.55
        ? Math.round(80 + rnd() * 350)      // 腰部 37%
        : Math.round(5 + rnd() * 80);       // 长尾 45%
    const ctrBase = 0.008 + rnd() * 0.04;   // 0.8% - 4.8%
    const impressions = Math.round(clicks / ctrBase);
    const position = parseFloat((1.5 + rnd() * 18).toFixed(1));
    return {
      id, url, fullUrl, market,
      pageType: seed.type,
      cluster: seed.cluster,
      topQuery: seed.queryRoot[0],
      clicks, impressions, ctr: clicks / impressions, position,
      indexState,
      trend12m: generateTrend(clicks, rnd),
      lastSync: "2026-05-23T03:15:00Z",
      parentId, isPillar: seed.pillar, sortOrder: idx,
    };
  });
}

const PAGES = generatePages();

function buildPoolMatches(): Record<string, QueryRow[]> {
  const rnd = seeded(20260524);
  const map: Record<string, QueryRow[]> = {};
  PAGES.forEach((p, idx) => {
    const seed = PAGE_SEEDS[idx];
    if (p.indexState === "excluded" || p.indexState === "error") {
      map[p.id] = [];
      return;
    }
    map[p.id] = generateQueries(p, seed.queryRoot, rnd);
  });
  return map;
}

const QUERY_MAP = buildPoolMatches();

// ───────────────────────────────────────────────────────────────────────────
// 公开 API
// ───────────────────────────────────────────────────────────────────────────

export function getMockPages(): PageRow[] {
  return PAGES;
}

export function getMockStats(): IndexingStats {
  const valid = PAGES.filter((p) => p.indexState === "indexed" || p.indexState === "discovered");
  const totalClicks = valid.reduce((sum, p) => sum + p.clicks, 0);
  const totalImpr = valid.reduce((sum, p) => sum + p.impressions, 0);
  const ctrSum = valid.reduce((sum, p) => sum + p.ctr, 0);
  const posSum = valid.reduce((sum, p) => sum + p.position, 0);
  const top10 = valid.filter((p) => p.position > 0 && p.position <= 10).length;
  return {
    totalPages: PAGES.length,
    totalClicks,
    totalImpressions: totalImpr,
    avgCtr: valid.length ? ctrSum / valid.length : 0,
    avgPosition: valid.length ? parseFloat((posSum / valid.length).toFixed(1)) : 0,
    top10Pages: top10,
    lastSync: "2026-05-23T03:15:00Z",
  };
}

export function getMockPageDetail(id: string): PageDetail | null {
  const page = PAGES.find((p) => p.id === id);
  if (!page) return null;
  const queries = QUERY_MAP[id] ?? [];
  const poolMatches = Math.floor(queries.length * 0.3);
  return { ...page, queries, poolMatches };
}
