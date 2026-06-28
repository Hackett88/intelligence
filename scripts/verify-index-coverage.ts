/**
 * 收录覆盖验证脚本 —— 交叉比对"新站 sitemap 允许收录名单"与"GSC 已编入索引集"。
 *
 * 数据流：
 *   fetchSitemapPages()  → 新站 sitemap 的全部页面（权威"允许收录"名单，零浏览器成本）
 *   fetchIndexedUrls()   → CDP 接管本地已登录 Chrome，抓 GSC「已编入索引」drilldown 全表
 *   normalizeForMatch()  → 两侧统一归一化后按 host+path 全等比对
 *
 * 打印：sitemap 页数 / indexed 行数 / 命中(已收录)数+清单 / 未收录数+前 10 条。
 *
 * 前提：Chrome 已以 --remote-debugging-port=9222 启动并登录 GSC(sc-domain:weslamic.com)。
 * 运行：  npx tsx scripts/verify-index-coverage.ts
 */
import { fetchSitemapPages } from "../src/lib/gsc/sitemap";
import { fetchIndexedUrls } from "../src/lib/gsc/index-coverage-fetcher";
import { normalizeForMatch } from "../src/lib/gsc/url-normalize";

(async () => {
  console.log("\n=== 收录覆盖验证（新站 sitemap × GSC 已编入索引）===\n");

  // 1) sitemap（server fetch，零浏览器成本）
  console.log("拉取新站 sitemap …");
  const sitemap = await fetchSitemapPages();
  console.log(`  sitemap 页数: ${sitemap.length}`);

  // 2) GSC 已编入索引（CDP 接管本地 Chrome）
  console.log("\nCDP 抓取 GSC「已编入索引」drilldown …（会接管你已登录的 Chrome）");
  const indexed = await fetchIndexedUrls();
  console.log(`  indexed 行数: ${indexed.length}`);

  // 3) 归一化比对：indexed 全部入 Set，sitemap 逐页查命中
  const indexedSet = new Set(indexed.map((r) => normalizeForMatch(r.url)));
  const hits: string[] = [];
  const misses: string[] = [];
  for (const p of sitemap) {
    const key = normalizeForMatch(p.fullUrl);
    if (indexedSet.has(key)) hits.push(p.fullUrl);
    else misses.push(p.fullUrl);
  }

  console.log(`\n--- 结果 ---`);
  console.log(`sitemap 页数      : ${sitemap.length}`);
  console.log(`indexed 行数      : ${indexed.length}`);
  console.log(`命中（已收录）    : ${hits.length} / ${sitemap.length}`);
  console.log(`未收录            : ${misses.length}`);

  console.log(`\n命中清单（已收录）：`);
  if (hits.length === 0) {
    console.log(
      "  （无 —— 新站 sitemap 页面当前在 GSC 已编入索引集中 0 命中，符合迁站后新站尚未被收录的现状）"
    );
  } else {
    hits.forEach((u) => console.log(`  ✓ ${u}`));
  }

  console.log(`\n未收录前 10 条：`);
  misses.slice(0, 10).forEach((u) => console.log(`  ✗ ${u}`));
  if (misses.length > 10) console.log(`  …（其余 ${misses.length - 10} 条略）`);

  console.log(`\n=== 验证结束 ===\n`);
})().catch((err) => {
  console.error(
    "\n[verify-index-coverage] 失败:",
    err instanceof Error ? err.message : err
  );
  process.exitCode = 1;
});
