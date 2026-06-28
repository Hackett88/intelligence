/**
 * 收录状态验证脚本 —— 用 GSC「网址检查」逐页取新站前 5 个 sitemap URL 的真实收录判定。
 *
 * 数据流：
 *   fetchSitemapPages()  → 新站 sitemap 全部页面（权威"允许收录"名单，零浏览器成本）
 *   inspectUrls(前5个)   → CDP 接管本地已登录 Chrome，逐个走 URL Inspection UI 取真实状态
 *
 * 打印：每个 {url, indexed, coverageText, pageIndexingText, lastCrawled} + 总耗时 + captchaBlocked。
 * 只取前 5 个（不全 57）以省时验证。
 *
 * 前提：Chrome 已以 --remote-debugging-port=9222 启动并登录 GSC(sc-domain:weslamic.com)。
 * 运行：  npx tsx scripts/verify-index-inspection.ts
 */
import { fetchSitemapPages } from "../src/lib/gsc/sitemap";
import { inspectUrls } from "../src/lib/gsc/index-inspection-fetcher";

(async () => {
  console.log("\n=== 收录状态验证（GSC 网址检查 × 新站 sitemap 前 5）===\n");

  console.log("拉取新站 sitemap …");
  const sitemap = await fetchSitemapPages();
  const sample = sitemap.slice(0, 5).map((p) => p.fullUrl);
  console.log(`  sitemap 总页数: ${sitemap.length}，本次验证前 ${sample.length} 个：`);
  sample.forEach((u, i) => console.log(`    ${i + 1}. ${u}`));

  console.log("\nCDP 接管你已登录的 Chrome，逐页走 URL Inspection …（每页约 20-50s）\n");
  const t0 = Date.now();
  const { results, captchaBlocked } = await inspectUrls(sample, {
    onProgress: (done, total, last) => {
      console.log(
        `  [${done}/${total}] ${last.url}\n` +
          `        indexed=${last.indexed} | ${last.coverageText}` +
          (last.lastCrawled ? ` | 上次抓取:${last.lastCrawled}` : "")
      );
    },
  });
  const elapsedMs = Date.now() - t0;

  console.log(`\n--- 结果 ---`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.url}`);
    console.log(`     indexed        : ${r.indexed}`);
    console.log(`     coverageText   : ${r.coverageText}`);
    console.log(`     pageIndexing   : ${r.pageIndexingText || "(空)"}`);
    console.log(`     lastCrawled    : ${r.lastCrawled ?? "(未取到)"}`);
  });

  const ok = results.filter((r) => r.indexed === true).length;
  const no = results.filter((r) => r.indexed === false).length;
  const unknown = results.filter((r) => r.indexed === null).length;

  console.log(`\n--- 汇总 ---`);
  console.log(`已收录(true)   : ${ok}`);
  console.log(`未收录(false)  : ${no}`);
  console.log(`未取到(null)   : ${unknown}`);
  console.log(`captchaBlocked : ${captchaBlocked}`);
  console.log(`总耗时         : ${(elapsedMs / 1000).toFixed(1)}s`);
  if (results.length > 0) {
    console.log(
      `单页平均       : ${(elapsedMs / 1000 / results.length).toFixed(1)}s` +
        `  → 推算全 ${sitemap.length} 页 ≈ ${Math.round((elapsedMs / results.length) * sitemap.length / 1000 / 60)} 分钟`
    );
  }

  console.log(`\n=== 验证结束 ===\n`);
})().catch((err) => {
  console.error(
    "\n[verify-index-inspection] 失败:",
    err instanceof Error ? err.message : err
  );
  process.exitCode = 1;
});
