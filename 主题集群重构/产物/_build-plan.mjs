// 组装官: 把 pillars.json + topics/*.json + topics.json + validation.json
// 拼成 plan-payload.json（落库就绪）与 蓝图-blueprint.md（人读版）。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("主题集群重构/产物");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const pillarsDoc = read("pillars.json");
const topicsDoc = read("topics.json");
const validationDoc = read("validation.json");

const TOPIC_FILES = [
  "dhikr-adhkar", "salatul-tasbih", "qibla", "slow-living",
  "zikr-ring", "digital-counter", "tasbih-beads",
  "islamic-jewelry", "name-necklace", "gifts", "brand",
];
const topicPages = {};
for (const t of TOPIC_FILES) topicPages[t] = read(`topics/${t}.json`);

// ---- 行：5 个域 ----
const THEME_META = {
  "dhikr-knowledge": { name: "念诵知识", latin: "DHIKR" },
  "zikr-ring":       { name: "智能念珠戒指", latin: "ANNULUS" },
  "tasbih":          { name: "念珠", latin: "TASBIH" },
  "islamic-jewelry": { name: "伊斯兰饰品", latin: "ORNAMENTUM" },
  "name-necklace":   { name: "定制项链", latin: "NOMEN" },
};
const ROW_ORDER = ["dhikr-knowledge", "zikr-ring", "tasbih", "islamic-jewelry", "name-necklace"];

const rows = ROW_ORDER.map((themeId) => ({
  themeId,
  name: THEME_META[themeId].name,
  latin: THEME_META[themeId].latin,
}));

// ---- 列(主题) 元数据：scenarioId / en / zh / band 归属 ----
// band 6 类：知识 / 产品 / 工具 / 商业 / 生活 / 品牌
const TOPIC_META = {
  "dhikr-adhkar":   { en: "Dhikr & Adhkar",            zh: "念诵与功修", band: "知识" },
  "salatul-tasbih": { en: "Salatul Tasbih",            zh: "赞念拜",     band: "知识" },
  "tasbih-beads":   { en: "Tasbih / Prayer Beads",     zh: "念珠/拜珠",  band: "产品" },
  "zikr-ring":      { en: "Zikr Ring",                 zh: "念珠戒指",   band: "产品" },
  "islamic-jewelry":{ en: "Islamic Jewelry",           zh: "伊斯兰饰品", band: "产品" },
  "name-necklace":  { en: "Name Necklace",             zh: "定制项链",   band: "产品" },
  "qibla":          { en: "Qibla & Prayer Direction",  zh: "朝向/找麦加", band: "工具" },
  "digital-counter":{ en: "Digital Tasbih Counters",   zh: "电子计数器", band: "工具" },
  "gifts":          { en: "Islamic Gifts",             zh: "伊斯兰礼品", band: "商业" },
  "slow-living":    { en: "Slow Living & Mindful Dhikr", zh: "慢生活/正念", band: "生活" },
  "brand":          { en: "Weslamic Brand",            zh: "品牌",       band: "品牌" },
};
const BAND_ORDER = ["知识", "产品", "工具", "商业", "生活", "品牌"];
// 每个 band 内列的顺序（按主题在该 band 的语义优先级）
const COLUMN_ORDER = {
  "知识": ["dhikr-adhkar", "salatul-tasbih"],
  "产品": ["zikr-ring", "tasbih-beads", "islamic-jewelry", "name-necklace"],
  "工具": ["qibla", "digital-counter"],
  "商业": ["gifts"],
  "生活": ["slow-living"],
  "品牌": ["brand"],
};

const bands = BAND_ORDER.map((band) => ({
  band,
  columns: COLUMN_ORDER[band].map((scenarioId) => ({
    scenarioId,
    en: TOPIC_META[scenarioId].en,
    zh: TOPIC_META[scenarioId].zh,
  })),
}));

// ---- 主题名/拉丁名映射（用于 page 上挂 themeName/themeLatin）----
const themeNameOf = (themeId) => THEME_META[themeId].name;
const themeLatinOf = (themeId) => THEME_META[themeId].latin;

// ---- 处理 id/url 撞车：sub-pillar 与 pillar 同 id+url ----
// 规则：pillars.json 的 pillar 是品类页本体（保留 collections URL）。
// 与之撞车的 sub-pillar（zikr-ring / islamic-jewelry）给它一个去重 id 和 内容枢纽 URL，
// 这样落库不会互相覆盖。其它 sub-pillar 本身 id 唯一(tc-<topic>-pillar)，原样保留。
const PILLAR_IDS = new Set(pillarsDoc.pillars.map((p) => p.id));

const pages = [];
const bindings = [];

// 自然键：keyword + market（market 为 null 用 "*" 占位，品牌词全球）
const bindKey = (kw, market) => `${kw}__${market ?? "*"}`;
const boundSeen = new Map(); // bindKey -> pageId（每词只绑一页）
const pushBindings = (pageId, boundKeywords) => {
  if (!Array.isArray(boundKeywords)) return;
  for (const b of boundKeywords) {
    const market = b.market ?? null;
    const k = bindKey(b.keyword, market);
    if (boundSeen.has(k)) continue; // 去重：每词只绑一页，先到先得
    boundSeen.set(k, pageId);
    bindings.push({ keyword: b.keyword, market, pageId });
  }
};

// 1) 5 个 pillar（来自 pillars.json）
for (const p of pillarsDoc.pillars) {
  const page = {
    id: p.id,
    role: "pillar",
    pillarId: null,
    themeId: p.themeId,
    themeName: themeNameOf(p.themeId),
    themeLatin: themeLatinOf(p.themeId),
    territory: p.territory ?? null,
    scenarioId: null,
    title: p.title,
    subtitle: p.subtitle,
    geoOverview: p.geoOverview,
    primaryKeyword: p.primaryKeyword,
    pageType: p.pageType,
    status: p.status ?? "gap",
    url: p.url,
    market: p.market ?? null,
    markets: p.markets ?? [],
    auxKeywords: p.auxKeywords ?? [],
  };
  pages.push(page);
  // pillar 的 auxKeywords 不是真实关键词绑定（无 market 维度），不进 bindings。
  // 但 pillar.boundKeywords（真实 keyword+market）要摊平进 bindings —— "每个页面(含 pillar)"。
  pushBindings(p.id, p.boundKeywords);
}

// 2) sub-pillar + clusters（来自 topics/*.json）
const collisionRemap = {}; // 原 id -> 新 id
for (const t of TOPIC_FILES) {
  const doc = topicPages[t];
  const sp = doc.subPillar;

  // 撞车检测：sub-pillar id 与某 pillar id 相同 → 去重
  let spId = sp.id;
  let spUrl = sp.url;
  let collided = false;
  if (PILLAR_IDS.has(sp.id)) {
    collided = true;
    spId = sp.id.replace(/-pillar$/, "-subpillar");
    // 内容枢纽 URL：把 /collections/x 改成 /blogs/x 内容枢纽，避免与品类页 URL 撞车
    spUrl = `/blogs/${sp.scenarioId}`;
    collisionRemap[sp.id] = spId;
  }

  const spPage = {
    id: spId,
    role: "sub-pillar",
    pillarId: sp.pillarId,
    themeId: sp.themeId,
    themeName: themeNameOf(sp.themeId),
    themeLatin: themeLatinOf(sp.themeId),
    territory: sp.territory ?? null,
    scenarioId: sp.scenarioId,
    title: sp.title,
    subtitle: sp.subtitle,
    geoOverview: sp.geoOverview,
    primaryKeyword: sp.primaryKeyword,
    pageType: sp.pageType,
    status: sp.status ?? "gap",
    url: spUrl,
    market: sp.market ?? null,
    markets: sp.markets ?? [],
    auxKeywords: sp.auxKeywords ?? [],
  };
  pages.push(spPage);
  pushBindings(spId, sp.boundKeywords);

  for (const c of doc.clusters) {
    // cluster.pillarId 指向 sub-pillar；若 sub-pillar 被 remap，跟着改
    const parentId = collisionRemap[c.pillarId] ?? c.pillarId;
    const cPage = {
      id: c.id,
      role: "cluster",
      pillarId: parentId,
      themeId: c.themeId,
      themeName: themeNameOf(c.themeId),
      themeLatin: themeLatinOf(c.themeId),
      territory: c.territory ?? null,
      scenarioId: c.scenarioId,
      title: c.title,
      subtitle: c.subtitle,
      geoOverview: c.geoOverview,
      primaryKeyword: c.primaryKeyword,
      pageType: c.pageType,
      status: c.status ?? "gap",
      url: c.url,
      market: c.market ?? null,
      markets: c.markets ?? [],
      auxKeywords: c.auxKeywords ?? [],
    };
    pages.push(cPage);
    pushBindings(c.id, c.boundKeywords);
  }
}

// ---- deferred（来自 topics.json）----
const deferred = topicsDoc.deferred.map((d) => ({
  keyword: d.keyword,
  sv: d.sv,
  reason: d.reason,
}));

// ---- dangling bindings：binding.pageId 不在 pages 内的，应为 0 ----
const pageIdSet = new Set(pages.map((p) => p.id));
const danglingBindings = bindings.filter((b) => !pageIdSet.has(b.pageId)).length;

// ---- stats ----
const stats = {
  pillars: pages.filter((p) => p.role === "pillar").length,
  subPillars: pages.filter((p) => p.role === "sub-pillar").length,
  clusters: pages.filter((p) => p.role === "cluster").length,
  pagesTotal: pages.length,
  boundKeywords: bindings.length,
  bindingsTotal: bindings.length,
  danglingBindings,
  deferred: deferred.length,
  deferredTotal: deferred.length,
};

const payload = {
  grid: { rows, bands },
  pages,
  bindings,
  deferred,
  stats,
};

fs.writeFileSync(
  path.join(ROOT, "plan-payload.json"),
  JSON.stringify(payload, null, 2),
  "utf8"
);

// 输出关键诊断
console.log("pages total:", pages.length);
console.log("  pillars:", stats.pillars, "subPillars:", stats.subPillars, "clusters:", stats.clusters);
console.log("bindings:", bindings.length);
console.log("danglingBindings:", danglingBindings);
console.log("deferred:", deferred.length);
console.log("collisionRemap:", JSON.stringify(collisionRemap));

// 校验：bindings 是否有重复自然键
const seen = new Set(); let dupe = 0;
for (const b of bindings) {
  const k = bindKey(b.keyword, b.market);
  if (seen.has(k)) dupe++;
  seen.add(k);
}
console.log("duplicate binding keys:", dupe);

// 校验：cluster.pillarId 是否都能在 pages 找到
const pageIds = new Set(pages.map((p) => p.id));
const orphan = pages.filter((p) => p.role !== "pillar" && p.pillarId && !pageIds.has(p.pillarId));
console.log("orphan pages (pillarId not found):", orphan.length, orphan.map((o) => `${o.id}->${o.pillarId}`));
