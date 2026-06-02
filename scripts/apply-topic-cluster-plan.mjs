// 落库 apply：把主题集群重构蓝图 plan-payload.json 写入指定 owner 的 strategy_pages + strategy_bindings（整组覆盖）。
// 落库前自动即时备份当前 owner 的 pages/bindings 到带时间戳的文件（双保险，原始快照另在 data/snapshot-*.json）。
// 用法: node scripts/apply-topic-cluster-plan.mjs <owner> [--commit]
//   不带 --commit = 干跑(dry-run)：只打印将写入的统计，不动库。
//   带 --commit   = 真正写库（事务内先删后插）。
import postgres from "postgres";
import * as fs from "node:fs";

const owner = process.argv[2];
const commit = process.argv.includes("--commit");
if (!owner) { console.error("用法: node scripts/apply-topic-cluster-plan.mjs <owner> [--commit]"); process.exit(1); }

const envText = fs.readFileSync(".env.local", "utf8");
const DATABASE_URL = envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!DATABASE_URL) { console.error("缺 DATABASE_URL"); process.exit(1); }

const plan = JSON.parse(fs.readFileSync("主题集群重构/产物/plan-payload.json", "utf8"));
const pages = plan.pages || [];
const bindings = plan.bindings || [];

// ── 映射 strategy_pages 行 ──
const pageRows = pages.map((p, i) => ({
  owner, page_id: p.id, role: p.role, pillar_id: p.pillarId ?? null,
  title: p.title, primary_keyword: p.primaryKeyword, page_type: p.pageType,
  status: p.status ?? "gap", url: p.url ?? null, market: p.market,
  markets: JSON.stringify(p.markets ?? []),
  theme_id: p.themeId, theme_name: p.themeName, theme_latin: p.themeLatin, territory: p.territory,
  note: null, sort_order: i, aux_keywords: JSON.stringify(p.auxKeywords ?? []),
  scenario_id: p.role === "sub-pillar" ? (p.scenarioId ?? null) : null,
  aux_edited: false, subtitle: p.subtitle ?? null, geo_overview: p.geoOverview ?? null,
}));

// ── 映射 strategy_bindings 行（按自然键 owner+keyword+market 去重）──
const seen = new Set();
const bindRows = [];
for (const b of bindings) {
  const mkt = b.market == null ? "" : b.market;
  const key = `${b.keyword.trim().toLowerCase()}|${mkt}`;
  if (seen.has(key)) continue;
  seen.add(key);
  bindRows.push({ owner, keyword: b.keyword, market: mkt, page_id: b.pageId, state: "bound" });
}

// 校验：绑定 pageId 必须指向 pageRows 里存在的页
const pageIds = new Set(pageRows.map((r) => r.page_id));
const dangling = bindRows.filter((r) => !pageIds.has(r.page_id));

const sql = postgres(DATABASE_URL, { ssl: false, max: 2, connect_timeout: 30 });
try {
  // 即时备份当前 owner 状态
  const curPages = await sql`select * from strategy_pages where owner = ${owner}`;
  const curBinds = await sql`select * from strategy_bindings where owner = ${owner}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync("主题集群重构/data/backup", { recursive: true });
  fs.writeFileSync(`主题集群重构/data/backup/pre-apply-pages-${stamp}.json`, JSON.stringify(curPages, null, 2));
  fs.writeFileSync(`主题集群重构/data/backup/pre-apply-bindings-${stamp}.json`, JSON.stringify(curBinds, null, 2));

  console.log("=== APPLY 计划 ===");
  console.log(`owner: ${owner}`);
  console.log(`当前库内: ${curPages.length} pages / ${curBinds.length} bindings  → 即时备份已存 (stamp=${stamp})`);
  console.log(`将写入:   ${pageRows.length} pages / ${bindRows.length} bindings`);
  const byRole = {}; pageRows.forEach((r) => byRole[r.role] = (byRole[r.role] || 0) + 1);
  console.log(`页角色分布: ${JSON.stringify(byRole)}`);
  console.log(`悬空绑定(指向不存在页): ${dangling.length}${dangling.length ? " ⚠ " + dangling.slice(0, 5).map((d) => d.page_id).join(",") : ""}`);

  if (dangling.length) { console.error("\n⚠ 存在悬空绑定，中止。请检查 plan-payload。"); process.exitCode = 1; await sql.end(); process.exit(); }

  if (!commit) {
    console.log("\n[DRY-RUN] 未加 --commit，未写库。确认无误后加 --commit 重跑。");
    await sql.end(); process.exit(0);
  }

  // 真正写库：事务内先删后插
  await sql.begin(async (tx) => {
    await tx`delete from strategy_bindings where owner = ${owner}`;
    await tx`delete from strategy_pages where owner = ${owner}`;
    for (const r of pageRows) {
      await tx`insert into strategy_pages
        (owner, page_id, role, pillar_id, title, primary_keyword, page_type, status, url, market, markets, theme_id, theme_name, theme_latin, territory, note, sort_order, aux_keywords, scenario_id, aux_edited, subtitle, geo_overview)
        values (${r.owner}, ${r.page_id}, ${r.role}, ${r.pillar_id}, ${r.title}, ${r.primary_keyword}, ${r.page_type}, ${r.status}, ${r.url}, ${r.market}, ${r.markets}::jsonb, ${r.theme_id}, ${r.theme_name}, ${r.theme_latin}, ${r.territory}, ${r.note}, ${r.sort_order}, ${r.aux_keywords}::jsonb, ${r.scenario_id}, ${r.aux_edited}, ${r.subtitle}, ${r.geo_overview})`;
    }
    for (const r of bindRows) {
      await tx`insert into strategy_bindings (owner, keyword, market, page_id, state)
        values (${r.owner}, ${r.keyword}, ${r.market}, ${r.page_id}, ${r.state})`;
    }
  });

  // 验证
  const [{ count: pc }] = await sql`select count(*)::int as count from strategy_pages where owner = ${owner}`;
  const [{ count: bc }] = await sql`select count(*)::int as count from strategy_bindings where owner = ${owner}`;
  const [{ count: subc }] = await sql`select count(*)::int as count from strategy_pages where owner = ${owner} and subtitle is not null`;
  const [{ count: geoc }] = await sql`select count(*)::int as count from strategy_pages where owner = ${owner} and geo_overview is not null`;
  console.log("\n=== 写库完成·验证 ===");
  console.log(`strategy_pages: ${pc}  (期望 ${pageRows.length})`);
  console.log(`strategy_bindings: ${bc}  (期望 ${bindRows.length})`);
  console.log(`有 subtitle 的页: ${subc} / 有 geo_overview 的页: ${geoc}`);
} catch (e) {
  console.error("APPLY 失败:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
