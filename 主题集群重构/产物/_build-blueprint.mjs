// 从 plan-payload.json + topics.json 生成人读版蓝图 蓝图-blueprint.md
// 结构：域 → 主题(sub-pillar) → 卫星页(cluster)；每页显示
// 主标题/副标题/主词/次词群(词+SV)/GEO概述/pageType/意图。附 deferred + 统计。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("主题集群重构/产物");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const payload = read("plan-payload.json");
const topicsDoc = read("topics.json");

// --- 建立 keyword+market -> sv 查表（来自 topics.json 的全部主题词）---
const svMap = new Map();
for (const topic of topicsDoc.topics) {
  for (const kw of topic.keywords) {
    const k = `${kw.keyword}__${kw.market ?? "*"}`;
    // 同词多 sv 取最大（不同 id 同词通常 sv 一致）
    const prev = svMap.get(k);
    if (prev == null || (kw.sv != null && kw.sv > prev)) svMap.set(k, kw.sv ?? 0);
  }
}
const svOf = (kw, market) => {
  const v = svMap.get(`${kw}__${market ?? "*"}`);
  return v == null ? null : v;
};

// --- 把 bindings 按 pageId 聚合，便于在每页下列出次词群 ---
const bindingsByPage = new Map();
for (const b of payload.bindings) {
  if (!bindingsByPage.has(b.pageId)) bindingsByPage.set(b.pageId, []);
  bindingsByPage.get(b.pageId).push(b);
}

const pages = payload.pages;
const byId = new Map(pages.map((p) => [p.id, p]));

// --- 行/域 顺序 ---
const ROW_ORDER = payload.grid.rows.map((r) => r.themeId);
const rowMeta = new Map(payload.grid.rows.map((r) => [r.themeId, r]));

// --- 主题(列)归属：scenarioId -> {en, zh, band} ---
const colMeta = new Map();
for (const band of payload.grid.bands) {
  for (const col of band.columns) {
    colMeta.set(col.scenarioId, { en: col.en, zh: col.zh, band: band.band });
  }
}

// --- 把页面按 themeId(域) → scenarioId(主题) 分组 ---
// 每个主题在其所属 themeId 行下出现。sub-pillar 的 themeId 即归属行。
const subPillars = pages.filter((p) => p.role === "sub-pillar");
const clusters = pages.filter((p) => p.role === "cluster");
const pillars = pages.filter((p) => p.role === "pillar");

// scenarioId -> sub-pillar
const spByScenario = new Map(subPillars.map((sp) => [sp.scenarioId, sp]));
// scenarioId -> clusters[]
const clByScenario = new Map();
for (const c of clusters) {
  if (!clByScenario.has(c.scenarioId)) clByScenario.set(c.scenarioId, []);
  clByScenario.get(c.scenarioId).push(c);
}

// themeId -> [scenarioId...]（域下的主题，按 band 顺序）
const scenariosByTheme = new Map(ROW_ORDER.map((t) => [t, []]));
for (const sp of subPillars) {
  // sub-pillar 的 themeId 决定它落在哪一行
  if (!scenariosByTheme.has(sp.themeId)) scenariosByTheme.set(sp.themeId, []);
  scenariosByTheme.get(sp.themeId).push(sp.scenarioId);
}
// band 顺序排序每行内主题
const BAND_RANK = { "知识": 0, "产品": 1, "工具": 2, "商业": 3, "生活": 4, "品牌": 5 };
for (const [theme, list] of scenariosByTheme) {
  list.sort((a, b) => (BAND_RANK[colMeta.get(a)?.band] ?? 9) - (BAND_RANK[colMeta.get(b)?.band] ?? 9));
}

// themeId -> pillar
const pillarByTheme = new Map(pillars.map((p) => [p.themeId, p]));

// ---------- 渲染 ----------
const esc = (s) => (s == null ? "" : String(s));
const lines = [];

const now = "2026-06-02 16:30";
lines.push("---");
lines.push("description: WESLAMIC 主题集群落库蓝图（人读版）—— 5 域 / 11 主题 / 39 卫星页，按 域→主题→卫星页 展开，含主词、次词群(SV)、GEO 概述、deferred 与统计。");
lines.push("created: 2026-06-02 16:30");
lines.push("updated: " + now);
lines.push("---");
lines.push("");
lines.push("# WESLAMIC 主题集群蓝图");
lines.push("");
lines.push("> 落库就绪蓝图的人读对照版。结构：**域(行) → 主题(sub-pillar) → 卫星页(cluster)**。每页列出主标题 / 副标题 / 主词 / 次词群(词+月搜索量) / GEO 概述 / 页型 / 意图。机器版见 `plan-payload.json`。");
lines.push("");

// 统计速览
const s = payload.stats;
lines.push("## 速览");
lines.push("");
lines.push(`- 5 个 Pillar（域主页）· ${s.subPillars} 个 Sub-pillar（主题枢纽）· ${s.clusters} 个 Cluster（卫星页）= **${pages.length} 页**`);
lines.push(`- 绑定关键词 **${s.boundKeywords}** 条（自然键 keyword+market，每词只绑一页）`);
lines.push(`- 暂缓(deferred) **${s.deferred}** 词`);
lines.push("");

// 词群渲染辅助：把一页的次词按 SV 降序，主词单列
function renderKeywords(page) {
  const out = [];
  const pk = page.primaryKeyword;
  const pkMkt = page.market;
  const pkSv = svOf(pk, pkMkt);
  out.push(`  - **主词**: \`${esc(pk)}\`${pkMkt ? ` (${pkMkt})` : ""}${pkSv != null ? ` · SV ${pkSv}` : ""}`);

  const binds = (bindingsByPage.get(page.id) || []).slice();
  // 主词本身若也在 bindings 里，过滤掉避免重复显示
  const aux = binds.filter((b) => !(b.keyword === pk && (b.market ?? null) === (pkMkt ?? null)));
  aux.sort((a, b) => (svOf(b.keyword, b.market) ?? -1) - (svOf(a.keyword, a.market) ?? -1));
  if (aux.length) {
    const parts = aux.map((b) => {
      const sv = svOf(b.keyword, b.market);
      return `\`${esc(b.keyword)}\`${b.market ? `(${b.market})` : ""}${sv != null ? ` SV ${sv}` : ""}`;
    });
    out.push(`  - **次词群** (${aux.length}): ${parts.join("　·　")}`);
  } else {
    out.push(`  - **次词群**: —（仅主词绑定）`);
  }
  return out;
}

function renderPage(page, kind) {
  const tag = kind === "sub" ? "Sub-pillar 枢纽" : "卫星页";
  const block = [];
  block.push(`#### ${page.title}`);
  block.push("");
  block.push(`- *${esc(page.subtitle)}*`);
  block.push(`  - **角色/页型/意图**: ${tag} · ${esc(page.pageType)} · ${esc(page.intent ?? page.territory ?? "")}`.replace(/ · $/, ""));
  // page 对象里没有 intent 字段（payload 未带）→ 用 territory + pageType 表达；意图取自源 cluster 的 intent。
  block.push(`  - **URL**: \`${esc(page.url)}\` · 市场: ${page.markets && page.markets.length ? page.markets.join("/") : (page.market ?? "—")}`);
  block.push(...renderKeywords(page));
  block.push(`  - **GEO 概述**: ${esc(page.geoOverview)}`);
  block.push("");
  return block;
}

// 我们需要 intent —— payload 没存 intent，从 topics 源补一张表
const intentMap = new Map();
const TOPIC_FILES = ["dhikr-adhkar","salatul-tasbih","qibla","slow-living","zikr-ring","digital-counter","tasbih-beads","islamic-jewelry","name-necklace","gifts","brand"];
for (const t of TOPIC_FILES) {
  const d = read(`topics/${t}.json`);
  const reg = (o) => { if (o && o.id) intentMap.set(o.id, o.intent ?? ""); };
  reg(d.subPillar);
  // sub-pillar 可能被 remap 了 id，用 scenarioId 兜底
  if (d.subPillar) intentMap.set("scenario:" + d.subPillar.scenarioId, d.subPillar.intent ?? "");
  for (const c of d.clusters) reg(c);
}
const intentOf = (page) => {
  if (intentMap.has(page.id)) return intentMap.get(page.id);
  if (page.role === "sub-pillar") return intentMap.get("scenario:" + page.scenarioId) ?? "";
  return "";
};

// 重写 renderPage 的意图行使用 intentOf
function renderPage2(page, kind) {
  const tag = kind === "sub" ? "Sub-pillar 枢纽" : "卫星页";
  const intent = intentOf(page);
  const block = [];
  block.push(`#### ${page.title}`);
  block.push("");
  block.push(`- *${esc(page.subtitle)}*`);
  block.push(`  - **角色/页型/意图**: ${tag} · ${esc(page.pageType)}${intent ? ` · ${intent}` : ""} · 领域:${esc(page.territory ?? "")}`);
  block.push(`  - **URL**: \`${esc(page.url)}\` · 市场: ${page.markets && page.markets.length ? page.markets.join("/") : (page.market ?? "—")}`);
  block.push(...renderKeywords(page));
  block.push(`  - **GEO 概述**: ${esc(page.geoOverview)}`);
  block.push("");
  return block;
}

// ---- 主体：按域 ----
for (const themeId of ROW_ORDER) {
  const rm = rowMeta.get(themeId);
  const pillar = pillarByTheme.get(themeId);
  lines.push("---");
  lines.push("");
  lines.push(`## 域：${rm.name} / ${rm.latin}  \`${themeId}\``);
  lines.push("");
  if (pillar) {
    lines.push(`### Pillar（域主页）— ${pillar.title}`);
    lines.push("");
    lines.push(`- *${esc(pillar.subtitle)}*`);
    lines.push(`  - **页型**: ${esc(pillar.pageType)} · 领域:${esc(pillar.territory ?? "")}`);
    lines.push(`  - **URL**: \`${esc(pillar.url)}\` · 市场: ${pillar.markets.join("/")}`);
    lines.push(`  - **主词**: \`${esc(pillar.primaryKeyword)}\` (${esc(pillar.market)})`);
    lines.push(`  - **辅词**: ${(pillar.auxKeywords||[]).map((k)=>`\`${k}\``).join("、")}`);
    lines.push(`  - **GEO 概述**: ${esc(pillar.geoOverview)}`);
    lines.push("");
  }

  const scenarios = scenariosByTheme.get(themeId) || [];
  for (const scenarioId of scenarios) {
    const sp = spByScenario.get(scenarioId);
    const cm = colMeta.get(scenarioId);
    lines.push(`### 主题：${cm.en} / ${cm.zh}  \`${scenarioId}\`  〔band: ${cm.band}〕`);
    lines.push("");
    if (sp) lines.push(...renderPage2(sp, "sub"));
    const cls = (clByScenario.get(scenarioId) || []);
    if (cls.length) {
      lines.push(`> 卫星页 ${cls.length} 张：`);
      lines.push("");
      for (const c of cls) lines.push(...renderPage2(c, "cluster"));
    }
  }
}

// ---- Deferred ----
lines.push("---");
lines.push("");
lines.push(`## Deferred（暂缓词）— ${payload.deferred.length} 词`);
lines.push("");
lines.push("> 不在本期 11 主题范围内、按既定缘由暂缓的高量词，留待后续扩主题时再消化。按 SV 降序。");
lines.push("");
const def = payload.deferred.slice().sort((a, b) => (b.sv ?? 0) - (a.sv ?? 0));
lines.push("| # | 关键词 | SV | 缘由 |");
lines.push("|---|---|---|---|");
def.forEach((d, i) => {
  lines.push(`| ${i + 1} | ${esc(d.keyword)} | ${d.sv ?? "—"} | ${esc(d.reason)} |`);
});
lines.push("");

// ---- 统计 ----
lines.push("---");
lines.push("");
lines.push("## 统计");
lines.push("");
lines.push("| 维度 | 数量 |");
lines.push("|---|---|");
lines.push(`| Pillar（域主页） | ${s.pillars} |`);
lines.push(`| Sub-pillar（主题枢纽） | ${s.subPillars} |`);
lines.push(`| Cluster（卫星页） | ${s.clusters} |`);
lines.push(`| 页面合计 | ${pages.length} |`);
lines.push(`| 绑定关键词（unique keyword+market） | ${s.boundKeywords} |`);
lines.push(`| Deferred | ${s.deferred} |`);
lines.push("");

// 域 x band 网格摘要
lines.push("### 网格：域(行) × band(列)");
lines.push("");
const BAND_ORDER = payload.grid.bands.map((b) => b.band);
lines.push("| 域＼band | " + BAND_ORDER.join(" | ") + " |");
lines.push("|" + "---|".repeat(BAND_ORDER.length + 1));
for (const themeId of ROW_ORDER) {
  const rm = rowMeta.get(themeId);
  const cellByBand = Object.fromEntries(BAND_ORDER.map((b) => [b, []]));
  for (const sc of (scenariosByTheme.get(themeId) || [])) {
    const cm = colMeta.get(sc);
    cellByBand[cm.band].push(cm.zh);
  }
  const cells = BAND_ORDER.map((b) => cellByBand[b].join("、") || "—");
  lines.push(`| ${rm.name}(${rm.latin}) | ` + cells.join(" | ") + " |");
}
lines.push("");

// 落库注记
lines.push("---");
lines.push("");
lines.push("## 落库注记");
lines.push("");
lines.push("- **id/url 撞车已处理**：`zikr-ring`、`islamic-jewelry`、`name-necklace` 三个主题的 sub-pillar 原本与同名 Pillar 共用 id 且 URL 撞车（validation DUP-ID-1/2）。落库时 sub-pillar 改用 `tc-<topic>-subpillar` 独立 id、URL 迁到 `/blogs/<topic>` 内容枢纽，Pillar 保留 `/collections/<topic>` 品类页，互不覆盖。");
lines.push("- **head term `tasbih`(sa) 归属**：该词同时出现在 `tc-tasbih-beads-pillar` 与卫星页 `tc-tasbih-beads-c1`，绑定层按「枢纽优先」只绑到 sub-pillar，卫星页不再争抢（缓解 CANN-1）。");
lines.push("- **GEO 概述超长**：validation 标出 30 页 geoOverview 超 60 词上限（多为结尾 `Entities:` 清单）。本蓝图原样保留文案，落库前建议按 GEO-LEN-1/2 逐页精简，不影响结构与绑定。");
lines.push("");

fs.writeFileSync(path.join(ROOT, "蓝图-blueprint.md"), lines.join("\n"), "utf8");
console.log("blueprint written. lines:", lines.length);
