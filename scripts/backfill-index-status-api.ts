/**
 * 收录状态补查脚本（官方 GSC URL Inspection API）。
 *
 * 用途：用服务账号 API 一次性补查"未检查"的 sitemap 页收录状态，写入 data/gsc-index-status.json。
 * 不依赖本地浏览器 / 不重启 dev —— 直接写状态文件，页面刷新即读到。可保留复用（以后复查再跑）。
 *
 * 数据流：
 *   loadEnvLocal()        → 把 .env.local 注入 process.env（standalone tsx 不会自动加载 Next env）
 *   fetchSitemapPages()   → 新站 sitemap 全部页（权威"允许收录"名单）
 *   loadIndexStatus()     → 现有收录状态（用于筛"未检查"）
 *   inspectUrlsViaApi(1)  → 授权探针：先用 1 个 URL 验证 API 通不通（带 90s 重试，扛 GSC 权限传播延迟）
 *   inspectUrlsViaApi(全) → 探针通过后对全部未检查 URL 调一次 API
 *   saveMergeIndexStatus  → 合并落盘
 *
 * 运行：  npx tsx scripts/backfill-index-status-api.ts
 * 前提：  .env.local 已配 GSC_SA_KEY_FILE（指向 secrets/gsc-sa-key.json）、GSC_SITE_URL；
 *        服务账号已在 GSC 加为 Full 用户。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchSitemapPages } from "../src/lib/gsc/sitemap";
// index-status-store 间接 import @/db/client，而 db client 在【import 时】就固化
// process.env.DATABASE_URL —— 必须等 loadEnvLocal() 注入后再动态 import，否则 PG 连不上、
// 静默降级只写 JSON（面板读 PG，会造成 PG/JSON 分叉）。这里只保留 type-only import（运行时擦除）。
import type { IndexStatusFile } from "../src/lib/gsc/index-status-store";
import { normalizeForMatch } from "../src/lib/gsc/url-normalize";
import { inspectUrlsViaApi } from "../src/lib/gsc/index-inspection-api-fetcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 .env.local 注入 process.env（仅 KEY=VALUE，忽略注释/空行；已存在的同名 env 不覆盖）。
 * 安全：不打印任何值（含密钥）；返回被注入的 key 数量用于上层提示。
 */
async function loadEnvLocal(): Promise<number> {
  const file = path.join(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
      count++;
    }
  }
  return count;
}

type Probe = Awaited<ReturnType<typeof inspectUrlsViaApi>>;
type ProbeVerdict = { kind: "ok" } | { kind: "env" } | { kind: "error"; msg: string };

// 探针分类：configured:false=env 没加载；error 或单条"失败："=未通过；否则 ok。
function classifyProbe(p: Probe): ProbeVerdict {
  if (p.configured === false) return { kind: "env" };
  if (p.error) return { kind: "error", msg: p.error };
  const r = p.results[0];
  if (!r) return { kind: "error", msg: "探针无结果返回" };
  if (r.coverageText.startsWith("失败：")) return { kind: "error", msg: r.coverageText };
  return { kind: "ok" };
}

function printCounts(status: IndexStatusFile): void {
  const entries = Object.values(status.byUrl);
  const t = entries.filter((e) => e.indexed === true).length;
  const f = entries.filter((e) => e.indexed === false).length;
  const n = entries.filter((e) => e.indexed === null).length;
  console.log(
    `  byUrl 总记录: ${entries.length}  ->  true(已收录): ${t} | false(未收录): ${f} | null(未知): ${n}`
  );
  console.log(`  updatedAt: ${status.updatedAt || "(无)"}`);
}

function fmtIndexed(v: boolean | null): string {
  return v === true ? "[ true]" : v === false ? "[false]" : "[ null]";
}

(async () => {
  console.log("\n=== 收录状态补查（官方 URL Inspection API × 新站 sitemap）===\n");

  // ── 0) 加载 .env.local ──
  const injected = await loadEnvLocal();
  console.log(`已从 .env.local 注入 ${injected} 个环境变量（值不打印）`);
  console.log(`GSC_SA_KEY_FILE = ${process.env.GSC_SA_KEY_FILE ?? "(未设置)"}`);
  console.log(
    `GSC_SA_KEY_JSON = ${process.env.GSC_SA_KEY_JSON ? "(已设置, 隐藏)" : "(未设置)"}`
  );
  console.log(
    `GSC_SITE_URL    = ${process.env.GSC_SITE_URL ?? "(未设置, 用默认 sc-domain:weslamic.com)"}`
  );

  if (!process.env.GSC_SA_KEY_FILE && !process.env.GSC_SA_KEY_JSON) {
    console.error(
      "\n[停止] GSC_SA_KEY_FILE / GSC_SA_KEY_JSON 都没加载到 process.env。检查 .env.local 是否存在且含该键。"
    );
    process.exit(1);
  }

  // env 已注入 → 此刻才 import store（db client 在 import 时读 DATABASE_URL）
  const { loadIndexStatus, saveMergeIndexStatus } = await import(
    "../src/lib/gsc/index-status-store"
  );

  // ── 1) sitemap + 现有状态 → 筛未检查 ──
  console.log("\n拉取新站 sitemap + 读现有收录状态 …");
  const [sitemap, status] = await Promise.all([fetchSitemapPages(), loadIndexStatus()]);
  const unchecked = sitemap.filter((sp) => {
    const key = normalizeForMatch(sp.fullUrl);
    const entry = status.byUrl[key];
    return !entry || entry.indexed === null;
  });
  const uncheckedUrls = unchecked.map((sp) => sp.fullUrl);
  console.log(
    `  sitemap 总页数: ${sitemap.length} | 已检查记录: ${Object.keys(status.byUrl).length} | 未检查(待补): ${uncheckedUrls.length}`
  );

  if (uncheckedUrls.length === 0) {
    console.log("\n没有未检查的 URL（都已有 true/false 记录），无需补查。");
    console.log("\n── 读回 loadIndexStatus() 当前落盘计数 ──");
    printCounts(await loadIndexStatus());
    console.log("\n=== 结束 ===\n");
    return;
  }

  // ── 2) 授权探针（1 个 URL；403/权限传播延迟则等 90s 重试一次）──
  const probeUrl = uncheckedUrls[0];
  console.log(`\n── 授权探针：${probeUrl}`);
  let probe = await inspectUrlsViaApi([probeUrl]);
  let v = classifyProbe(probe);

  if (v.kind === "env") {
    console.error(
      "\n[停止] inspectUrlsViaApi 返回 configured:false —— env 没生效（GSC_SA_KEY_FILE/JSON 未读到）。"
    );
    process.exit(1);
  }
  if (v.kind === "error") {
    console.warn(`  探针未通过（多半是 GSC 刚加 SA 的权限传播延迟）：${v.msg}`);
    console.warn("  等 90s 后重试一次探针 …");
    await sleep(90_000);
    probe = await inspectUrlsViaApi([probeUrl]);
    v = classifyProbe(probe);
    if (v.kind === "env") {
      console.error("\n[停止] 重试后仍 configured:false —— env 问题。");
      process.exit(1);
    }
    if (v.kind === "error") {
      console.error(
        `\n[停止] 重试后探针仍失败。error 原文：\n  ${v.msg}\n` +
          "  → 若是 403/权限：GSC 权限传播可能需要更久（数分钟），稍后重跑本脚本即可；\n" +
          "    若持续失败：核对 SA 是否确为该属性的 Full 用户、GSC_SITE_URL 是否 sc-domain:weslamic.com。"
      );
      process.exit(1);
    }
  }

  const pr = probe.results[0];
  console.log(
    `  [OK] 探针通过：indexed=${pr.indexed} | coverageText="${pr.coverageText}" | ` +
      `pageIndexing="${pr.pageIndexingText || "(空)"}" | lastCrawled=${pr.lastCrawled ?? "(无)"}`
  );

  // ── 3) 全量补查（对全部未检查 URL，一次性）──
  console.log(
    `\n── 全量补查：对 ${uncheckedUrls.length} 个未检查 URL 调 API（串行 + ~120ms 节流）…`
  );
  const t0 = Date.now();
  const full = await inspectUrlsViaApi(uncheckedUrls);
  const elapsedMs = Date.now() - t0;

  if (full.configured === false) {
    console.error("\n[停止] 全量阶段 configured:false（异常：env 中途丢失？）");
    process.exit(1);
  }
  if (full.error) {
    console.error(
      `\n[警告] 全量批次返回 error：${full.error}（已得结果数：${full.results.length}）`
    );
  }

  // ── 4) 落盘 ──
  if (full.results.length > 0) {
    await saveMergeIndexStatus(
      full.results.map((r) => ({
        url: r.url,
        indexed: r.indexed,
        coverageText: r.coverageText,
        lastCrawled: r.lastCrawled,
      }))
    );
    console.log(`\n已写入 data/gsc-index-status.json（合并 ${full.results.length} 条）`);
  } else {
    console.warn("\n无结果可写（results 空），跳过落盘。");
  }

  // ── 5) 本次统计 + 样例 ──
  const ind = full.results.filter((r) => r.indexed === true).length;
  const noi = full.results.filter((r) => r.indexed === false).length;
  const nul = full.results.filter((r) => r.indexed === null).length;
  console.log("\n--- 本次全量统计 ---");
  console.log(`检查数        : ${full.results.length}`);
  console.log(`已收录(true)  : ${ind}`);
  console.log(`未收录(false) : ${noi}`);
  console.log(`未知(null)    : ${nul}`);
  console.log(`耗时          : ${(elapsedMs / 1000).toFixed(1)}s`);

  const sampleN = Math.min(15, full.results.length);
  console.log(`\n--- 样例（前 ${sampleN} 条 url -> indexed | coverageText）---`);
  full.results.slice(0, sampleN).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${fmtIndexed(r.indexed)} ${r.url}`);
    console.log(
      `      ${r.coverageText || "(空)"}${r.lastCrawled ? "  | 上次抓取: " + r.lastCrawled : ""}`
    );
  });

  // ── 6) 读回确认落盘 ──
  console.log("\n── 读回 loadIndexStatus() 确认落盘 ──");
  printCounts(await loadIndexStatus());

  console.log("\n=== 补查结束 ===\n");
})().catch((err) => {
  console.error(
    "\n[backfill-index-status-api] 失败:",
    err instanceof Error ? err.stack || err.message : err
  );
  process.exitCode = 1;
});
