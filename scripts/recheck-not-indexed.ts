/**
 * 未收录(false)页的【实时复核】脚本。
 *
 * 用途：取 data/gsc-index-status.json 里当前 indexed===false 的 URL，逐个【此刻】重查 GSC URL
 * Inspection API，证明数据是当前的、诚实的，并自动捕捉任何已翻成收录(false→true)的页。
 *
 * 为什么走 raw 调用而非 inspectUrlsViaApi：inspectUrlsViaApi 只返回映射后的结果，不含 Google 的原始
 * verdict。本脚本要把 verdict + coverageState 原话摆给人看，故单次 raw 调用同时拿到这两者；indexed 用
 * 模块【导出的同一个 mapIndexed】计算，保证落盘口径与 inspectUrlsViaApi 完全一致（单次快照，无双查不一致）。
 *
 * 运行：  npx tsx scripts/recheck-not-indexed.ts
 * 前提：  .env.local 已配 GSC_SA_KEY_FILE / GSC_SITE_URL；服务账号已是该属性 Full 用户。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { JWT } from "google-auth-library";
// index-status-store 间接 import @/db/client，而 db client 在【import 时】就固化
// process.env.DATABASE_URL —— 必须等 loadEnvLocal() 注入后再动态 import，否则 PG 连不上、
// 静默降级只写 JSON（面板读 PG，会造成 PG/JSON 分叉）。这里只保留 type-only import（运行时擦除）。
import type { IndexStatusFile } from "../src/lib/gsc/index-status-store";
import { mapIndexed } from "../src/lib/gsc/index-inspection-api-fetcher";

const ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const THROTTLE_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 把 .env.local 注入 process.env（仅 KEY=VALUE，忽略注释/空行；不覆盖已存在；不打印任何值）。
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

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}
async function loadKey(): Promise<ServiceAccountKey> {
  const inline = process.env.GSC_SA_KEY_JSON?.trim();
  const file = process.env.GSC_SA_KEY_FILE?.trim();
  let raw: string;
  if (inline) {
    raw = inline;
  } else if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    raw = await fs.readFile(abs, "utf-8");
  } else {
    throw new Error("未配置 GSC_SA_KEY_FILE / GSC_SA_KEY_JSON");
  }
  const k = JSON.parse(raw) as Partial<ServiceAccountKey>;
  if (!k.client_email || !k.private_key) {
    throw new Error("service account JSON 缺少 client_email / private_key");
  }
  return { client_email: k.client_email, private_key: k.private_key };
}

interface RawIndexStatus {
  verdict?: string;
  coverageState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
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

(async () => {
  console.log("\n=== 未收录页实时复核（GSC URL Inspection API）===\n");

  const injected = await loadEnvLocal();
  console.log(`已从 .env.local 注入 ${injected} 个环境变量（值不打印）`);
  console.log(`GSC_SA_KEY_FILE = ${process.env.GSC_SA_KEY_FILE ?? "(未设置)"}`);
  console.log(
    `GSC_SITE_URL    = ${process.env.GSC_SITE_URL ?? "(未设置, 用默认 sc-domain:weslamic.com)"}`
  );
  if (!process.env.GSC_SA_KEY_FILE && !process.env.GSC_SA_KEY_JSON) {
    console.error("\n[停止] GSC_SA_KEY_FILE / GSC_SA_KEY_JSON 没加载到 process.env。");
    process.exit(1);
  }

  // env 已注入 → 此刻才 import store（db client 在 import 时读 DATABASE_URL）
  const { loadIndexStatus, saveMergeIndexStatus } = await import(
    "../src/lib/gsc/index-status-store"
  );

  // 取当前 indexed===false 的 URL
  const before = await loadIndexStatus();
  const falseUrls = Object.values(before.byUrl)
    .filter((e) => e.indexed === false)
    .map((e) => e.url);
  console.log(`\n当前 indexed===false 的 URL: ${falseUrls.length} 个`);
  if (falseUrls.length === 0) {
    console.log("没有 false 记录，无需复核。\n");
    printCounts(before);
    return;
  }

  const siteUrl = process.env.GSC_SITE_URL?.trim() || "sc-domain:weslamic.com";
  const key = await loadKey();
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [SCOPE],
  });

  console.log(`\n── 逐个实时重查（串行 + ~120ms 节流）…\n`);
  const t0 = Date.now();
  const results: {
    url: string;
    indexed: boolean | null;
    coverageText: string;
    lastCrawled: string | null;
  }[] = [];
  let flippedTrue = 0;
  let stillFalse = 0;
  let nowNull = 0;

  for (let i = 0; i < falseUrls.length; i++) {
    const url = falseUrls[i];
    let verdict = "(无)";
    let coverageState = "";
    let indexingState = "";
    let lastCrawlTime: string | null = null;
    let indexed: boolean | null = null;
    let note = "";

    try {
      const res = await client.request<{
        inspectionResult?: { indexStatusResult?: RawIndexStatus };
      }>({
        url: ENDPOINT,
        method: "POST",
        data: { inspectionUrl: url, siteUrl, languageCode: "en-US" },
      });
      const isr = res.data?.inspectionResult?.indexStatusResult ?? {};
      verdict = isr.verdict ?? "(无)";
      coverageState = isr.coverageState ?? "";
      indexingState = isr.indexingState ?? "";
      lastCrawlTime = isr.lastCrawlTime ?? null;
      indexed = mapIndexed(isr.verdict, isr.coverageState);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      note = ` [API 错误: ${msg}]`;
      coverageState = `失败：${msg}`;
      indexed = null;
    }

    if (indexed === true) flippedTrue++;
    else if (indexed === false) stillFalse++;
    else nowNull++;

    results.push({
      url,
      indexed,
      coverageText: coverageState,
      lastCrawled: lastCrawlTime,
    });

    const flag =
      indexed === true
        ? "   <<< 已翻成收录 (false -> true)"
        : indexed === null
          ? "   <<< 本次无答复 (null)"
          : "";
    console.log(`${String(i + 1).padStart(2)}. ${url}`);
    console.log(
      `      verdict=${verdict} | coverageState="${coverageState}" | indexingState=${indexingState || "(无)"} | indexed=${indexed}${flag}${note}` +
        (lastCrawlTime ? `\n      上次抓取: ${lastCrawlTime}` : "")
    );

    if (i < falseUrls.length - 1) await sleep(THROTTLE_MS);
  }
  const elapsedMs = Date.now() - t0;

  // 落盘（false->true 会自动更新）
  await saveMergeIndexStatus(results);
  console.log(`\n已写入 data/gsc-index-status.json（合并 ${results.length} 条）`);

  console.log("\n--- 本次复核结果分布（这 " + falseUrls.length + " 个）---");
  console.log(`仍未收录(false): ${stillFalse} | 翻成已收录(true): ${flippedTrue} | 无答复(null): ${nowNull}`);
  console.log(`耗时          : ${(elapsedMs / 1000).toFixed(1)}s`);

  console.log("\n── 读回 loadIndexStatus() 全库计数 ──");
  printCounts(await loadIndexStatus());

  console.log("\n=== 复核结束 ===\n");
})().catch((err) => {
  console.error(
    "\n[recheck-not-indexed] 失败:",
    err instanceof Error ? err.stack || err.message : err
  );
  process.exitCode = 1;
});
