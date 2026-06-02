// 只读导出：关键词进料全表 + 指定 owner 的已落库规划/绑定（给主题集群重构 workflow 当输入 + 回滚快照）。
// 用法: node scripts/export-keyword-pool.mjs            // 导出全部 owner 概览 + 全量关键词
//       node scripts/export-keyword-pool.mjs <owner>    // 额外导出该 owner 的 pages/bindings 明细
// 纯 SELECT，绝不写库。
import postgres from "postgres";
import * as fs from "node:fs";

const envText = fs.readFileSync(".env.local", "utf8");
const DATABASE_URL = envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!DATABASE_URL) { console.error("缺 DATABASE_URL"); process.exit(1); }

const sql = postgres(DATABASE_URL, { ssl: false, max: 2, connect_timeout: 30 });

try {
  const keywords = await sql`
    select id, keyword, market, search_volume as sv, keyword_difficulty as kd, intent,
           behavior_intent as "behaviorIntent", page_planning_intent as "pagePlanningIntent",
           layer_level as "layer", cluster_id as "clusterId", question_type as "questionType", cpc
    from keywords order by created_at asc`;

  // 哪些 owner 有落库规划
  const owners = await sql`
    select owner, count(*) as pages from strategy_pages group by owner order by count(*) desc`;
  const bindingOwners = await sql`
    select owner, count(*) as bindings from strategy_bindings group by owner order by count(*) desc`;

  const owner = process.argv[2] || null;
  let pages = [], bindings = [];
  if (owner) {
    pages = await sql`select * from strategy_pages where owner = ${owner} order by sort_order asc`;
    bindings = await sql`select * from strategy_bindings where owner = ${owner}`;
  }

  // 关键词维度分布（给规划用）
  const dist = (key) => {
    const m = {};
    for (const k of keywords) { const v = k[key] ?? "(空)"; m[v] = (m[v] ?? 0) + 1; }
    return m;
  };
  const summary = {
    totalKeywords: keywords.length,
    byMarket: dist("market"),
    byLayer: dist("layer"),
    byPagePlanningIntent: dist("pagePlanningIntent"),
    byBehaviorIntent: dist("behaviorIntent"),
    withClusterId: keywords.filter((k) => k.clusterId).length,
    distinctClusterIds: [...new Set(keywords.map((k) => k.clusterId).filter(Boolean))].length,
    svTotal: keywords.reduce((s, k) => s + (k.sv ?? 0), 0),
    planOwners: owners,
    bindingOwners,
  };

  fs.mkdirSync("主题集群重构/data", { recursive: true });
  fs.writeFileSync("主题集群重构/data/keywords-all.json", JSON.stringify(keywords, null, 2));
  fs.writeFileSync("主题集群重构/data/summary.json", JSON.stringify(summary, null, 2));
  if (owner) {
    fs.writeFileSync("主题集群重构/data/snapshot-pages.json", JSON.stringify(pages, null, 2));
    fs.writeFileSync("主题集群重构/data/snapshot-bindings.json", JSON.stringify(bindings, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n已写: 主题集群重构/data/keywords-all.json, summary.json" + (owner ? ", snapshot-pages.json, snapshot-bindings.json" : ""));
} catch (e) {
  console.error("查询失败:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
