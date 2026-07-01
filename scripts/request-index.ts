/**
 * GSC「请求编入索引 / Request indexing」批量代驾脚本。
 *
 * 复用 src/lib/gsc/request-index-fetcher.ts 的 requestIndexing()——与 APP 详情抽屉里
 * 「请求 Google 索引」按钮完全同一个引擎。驱动本地已登录 GSC 的 Chrome（CDP 9222）逐个提交。
 *
 * 用法：
 *   npx tsx scripts/request-index.ts                    # 默认 6 个 smart-tasbih-ring 页
 *   npx tsx scripts/request-index.ts <url1> <url2> ...   # 指定任意 URL
 *
 * 前提：Chrome 以 --remote-debugging-port=9222 启动、且已登录 GSC（weslamic.com 属性）。
 * 无需 .env / 数据库——引擎只用 puppeteer-core + 本地 CDP。
 */
import { requestIndexing } from "../src/lib/gsc/request-index-fetcher";

// 默认目标：pillar 在先（当 canary），5 个子页在后。
const DEFAULT_URLS = [
  "https://www.weslamic.com/smart-tasbih-ring",
  "https://www.weslamic.com/smart-tasbih-ring/what-is-zikr-ring",
  "https://www.weslamic.com/smart-tasbih-ring/how-to-use-zikr-ring",
  "https://www.weslamic.com/smart-tasbih-ring/are-zikr-rings-halal",
  "https://www.weslamic.com/smart-tasbih-ring/can-men-wear-rings-in-islam",
  "https://www.weslamic.com/smart-tasbih-ring/faith-jewelry",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const argv = process.argv.slice(2);
  const urls = argv.length ? argv : DEFAULT_URLS;
  console.log(`\n=== GSC 请求编入索引（共 ${urls.length} 个）===\n`);

  const results: { url: string; status: string; message: string }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const t0 = Date.now();
    console.log(`[${i + 1}/${urls.length}] 提交：${url}`);
    const r = await requestIndexing(url);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    results.push(r);
    console.log(`   -> status=${r.status}  (${secs}s)  ${r.message}\n`);

    // 配额用尽 / 撞验证码 → 继续也没用，停下等人工。
    if (r.status === "quota_exceeded") {
      console.log("⚠ 今日 GSC 请求索引配额已用尽，停止后续提交。\n");
      break;
    }
    if (r.status === "captcha") {
      console.log("⚠ 撞到 reCAPTCHA 人机验证，停止后续提交——请到浏览器手动完成验证后重跑剩余 URL。\n");
      break;
    }
    if (r.status === "throttled") {
      console.log("⚠ GSC 短时限流（「请稍后重试」），停止后续提交——请过一会儿再重跑剩余 URL。\n");
      break;
    }
    if (i < urls.length - 1) await sleep(2500);
  }

  console.log("=== 汇总 ===");
  const by: Record<string, number> = {};
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
  console.log(
    Object.entries(by)
      .map(([k, v]) => `${k}: ${v}`)
      .join("  |  ")
  );
  for (const r of results) console.log(`  [${r.status}] ${r.url}`);
  console.log("\n=== 结束 ===\n");
})().catch((err) => {
  console.error(
    "\n[request-index] 失败:",
    err instanceof Error ? err.stack || err.message : err
  );
  process.exitCode = 1;
});
