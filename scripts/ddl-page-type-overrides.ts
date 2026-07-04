/**
 * 建表 gsc_page_type_overrides —— 页面类型"人工修正"落 PG（JSON → PG 迁移）。
 *
 * 为什么迁：生产容器文件系统随每次部署重置，data/page-type-overrides.json 里线上做的
 * 修正撑不过下一次发版。PG 为唯一权威源后修正跨部署持久；JSON 降级为镜像兜底
 * （与 gsc_index_status 2026-06-28 迁移同款方案）。
 *
 * 纯增量幂等 DDL。本地 PG == 生产 PG（共享同一库，SSH 隧道 127.0.0.1:5433），
 * 故禁用 drizzle-kit generate/push/migrate（snapshot 已漂移）；手写 CREATE TABLE IF NOT EXISTS 直接执行。
 *
 * 步骤：① SELECT 1 验隧道连通 ② CREATE TABLE IF NOT EXISTS ③ 验证列齐全。
 *
 * 运行：  npx tsx scripts/ddl-page-type-overrides.ts
 * 前提：  .env.local 已配 DATABASE_URL（指向隧道 127.0.0.1:5433）；SSH 隧道已起。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// .env.local 自加载（standalone tsx 不会自动注入 Next env）。照搬同目录 DDL 脚本做法，不打印任何值。
async function loadEnvLocal(): Promise<void> {
  const file = path.join(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return;
  }
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
    if (!(key in process.env)) process.env[key] = val;
  }
}

(async () => {
  await loadEnvLocal();
  if (!process.env.DATABASE_URL) {
    console.error("ERR: DATABASE_URL 未配置（.env.local）。");
    process.exitCode = 1;
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { ssl: false, connect_timeout: 10 });
  try {
    // ① 隧道连通探针
    const probe = await sql<{ one: number }[]>`SELECT 1 AS one`;
    console.log(`[1/3] SELECT 1 -> ${probe[0]?.one}  (隧道连通)`);

    // ② 建表（幂等）
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS gsc_page_type_overrides (
        url_norm   text PRIMARY KEY,
        full_url   text NOT NULL,
        page_type  text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("[2/3] CREATE TABLE IF NOT EXISTS gsc_page_type_overrides -> OK");

    // ③ 验证：表存在 + 列数对
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gsc_page_type_overrides' ORDER BY ordinal_position
    `;
    console.log(`[3/3] 列: ${cols.map((c) => c.column_name).join(", ")}`);

    if (cols.length === 4) {
      console.log("\nVerdict: PASS — gsc_page_type_overrides 已建（4 列）。");
    } else {
      console.error(`FAIL: 期望 4 列，实际 ${cols.length} 列。`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
