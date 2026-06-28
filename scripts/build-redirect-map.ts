/**
 * 构建旧站 → 新站重定向映射，并落盘 data/gsc-redirect-map.json。
 *
 * 数据流：
 *   loadLatestSnapshot() → 旧真实页（filter(!isSynthetic)，含真实 GSC 指标）的 fullUrl
 *   buildRedirectMap()   → 全局 fetch 顺着 301/308 解析每个旧 URL 的新址（normalizeForMatch）
 *   saveRedirectMap()    → 写 data/gsc-redirect-map.json
 *
 * 末尾 smoke：调 loadCoveragePages() 打印"新页总点击/总曝光 + 按点击 Top 10 新页"，
 * 与旧快照总点击对照，确认旧址流量已按重定向归并到新页（数据守恒、不再全 0）。
 *
 * 运行：  npx tsx scripts/build-redirect-map.ts
 * 前提：  能联网（解析重定向 + 抓 sitemap）；旧快照可读（PG 或 data/gsc-snapshot.json）。
 */
import { loadLatestSnapshot } from "../src/lib/gsc/loader";
import { buildRedirectMap, saveRedirectMap } from "../src/lib/gsc/redirect-map";
import { loadCoveragePages } from "../src/lib/gsc/coverage-loader";
import { normalizeForMatch } from "../src/lib/gsc/url-normalize";

(async () => {
  console.log("\n=== 构建旧站→新站重定向映射 ===\n");

  // 1) 取旧真实页 fullUrl
  const snap = await loadLatestSnapshot();
  if (!snap) {
    console.error("loadLatestSnapshot 返回 null（PG/JSON 都没有），无法构建映射。");
    process.exit(1);
  }
  const oldReal = snap.pages.filter((p) => !p.isSynthetic);
  const oldUrls = oldReal.map((p) => p.fullUrl);
  console.log(`快照来源: ${snap.source}`);
  console.log(`旧 URL 总数: ${oldUrls.length}`);

  // 2) 解析重定向（并发 8）
  console.log("解析重定向中（HEAD/GET，redirect:manual，最多 3 跳，并发 8）…");
  const t0 = Date.now();
  const map = await buildRedirectMap(oldUrls, { concurrency: 8 });
  console.log(`解析耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 3) 落盘
  const file = await saveRedirectMap(map);

  const entries = Object.entries(map);
  const mapped = entries.filter(([, v]) => v != null);
  const nulls = entries.filter(([, v]) => v == null);
  console.log(`\n--- 映射统计 ---`);
  console.log(`旧 URL 总数  : ${entries.length}`);
  console.log(`成功映射数   : ${mapped.length}`);
  console.log(`null 数      : ${nulls.length}`);
  console.log(`已写入       : data/gsc-redirect-map.json（builtAt=${file.builtAt}）`);

  // 4) 样例：优先展示有代表性的形态变换
  console.log(`\n--- 映射样例（旧 norm → 新 norm）---`);
  const patterns: Array<[string, (k: string) => boolean]> = [
    ["/products/ → /product/", (k) => k.includes("/products/")],
    ["/collections/ → /collection/", (k) => k.includes("/collections/")],
    ["/blogs/muslim/ → /blogs/", (k) => k.includes("/blogs/muslim/") && !k.includes("/ar/") && !k.includes("/fr/")],
    ["/ar|fr/blogs/ → -ar|-fr", (k) => /\/(ar|fr|de|id)\//.test(k)],
    ["/pages/ → /tools|.../", (k) => k.includes("/pages/")],
  ];
  for (const [label, pred] of patterns) {
    const sample = mapped.find(([k]) => pred(k));
    if (sample) console.log(`  [${label}]  ${sample[0]}  →  ${sample[1]}`);
    else console.log(`  [${label}]  （无样例）`);
  }
  console.log(`  其余前若干条：`);
  mapped.slice(0, 6).forEach(([k, v]) => console.log(`    ${k}  →  ${v}`));

  if (nulls.length > 0) {
    console.log(`\n--- null（未映射到本站新页，孤儿流量）样例前 8 条 ---`);
    nulls.slice(0, 8).forEach(([k]) => console.log(`    ${k}  →  null`));
  }

  // 5) SMOKE：归并后新页流量
  console.log(`\n=== SMOKE: loadCoveragePages（归并后）===`);
  const cov = await loadCoveragePages();
  if (!cov) {
    console.error("loadCoveragePages 返回 null（sitemap 抓取失败？）。");
    process.exit(1);
  }
  const real = cov.pages.filter((p) => !p.isSynthetic);
  console.log(`新页总点击 : ${cov.stats.totalClicks}   （旧快照总点击 ${snap.stats.totalClicks}）`);
  console.log(`新页总曝光 : ${cov.stats.totalImpressions}   （旧快照总曝光 ${snap.stats.totalImpressions}）`);
  console.log(`新页 avgCtr: ${(cov.stats.avgCtr * 100).toFixed(2)}%   avgPosition: ${cov.stats.avgPosition}   top10Pages: ${cov.stats.top10Pages}`);

  const nonZero = real.filter((p) => p.clicks > 0 || p.impressions > 0).length;
  console.log(`有流量的新页数（clicks>0 或 impr>0）: ${nonZero} / ${real.length}`);

  const top10 = [...real].sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  console.log(`\n按点击 Top 10 新页：`);
  top10.forEach((p, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)}. ${p.url}  clicks=${p.clicks} impr=${p.impressions} ctr=${(p.ctr * 100).toFixed(1)}% pos=${p.position.toFixed(1)}`
    )
  );

  // 6) 数据守恒核对：用 raw 总量（从 pages 逐页求和），不用四舍五入的 stats.totalClicks
  const byOldUrl = map;
  const rawTotalClicks = oldReal.reduce((s, p) => s + p.clicks, 0);
  let mergedExpectClicks = 0;
  for (const op of oldReal) {
    const newNorm = byOldUrl[normalizeForMatch(op.fullUrl)];
    if (newNorm) mergedExpectClicks += op.clicks;
  }
  console.log(`\n--- 数据守恒核对 ---`);
  console.log(`旧址 raw 总点击        : ${rawTotalClicks}  (stats.totalClicks=${snap.stats.totalClicks} 为四舍五入值，不用于守恒)`);
  console.log(`旧址(映射成功)点击之和 : ${mergedExpectClicks}`);
  console.log(`新页归并后点击之和     : ${cov.stats.totalClicks}  (含 loader 对资产/系统页的硬性剔除)`);
  console.log(`孤儿(null)点击 = raw 总点击 - 映射成功点击 = ${rawTotalClicks - mergedExpectClicks}`);

  console.log(`\n=== 完成 ===\n`);
})().catch((err) => {
  console.error("\n[build-redirect-map] 失败:", err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
