/**
 * 建表 gsc_page_daily —— 每页每天流量明细（T2 地基）。
 *
 * 纯增量幂等 DDL。本地 PG == 生产 PG（共享同一库，SSH 隧道 127.0.0.1:5433），
 * 故禁用 drizzle-kit generate/push/migrate（snapshot 已漂移）；手写 CREATE TABLE IF NOT EXISTS 直接执行。
 *
 * 步骤：① SELECT 1 验隧道连通 ② CREATE TABLE IF NOT EXISTS ③ CREATE INDEX IF NOT EXISTS ④ 验证表/索引存在。
 *
 * 运行：  npx tsx scripts/ddl-page-daily.ts
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
    console.log(`[1/4] SELECT 1 -> ${probe[0]?.one}  (隧道连通)`);

    // ② 建表（幂等）
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS gsc_page_daily (
        url_norm    text NOT NULL,
        full_url    text NOT NULL,
        date        date NOT NULL,
        clicks      integer NOT NULL DEFAULT 0,
        impressions integer NOT NULL DEFAULT 0,
        sum_position double precision NOT NULL DEFAULT 0,
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (url_norm, date)
      );
    `);
    console.log("[2/4] CREATE TABLE IF NOT EXISTS gsc_page_daily -> OK");

    // ③ 建索引（幂等）
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_gsc_page_daily_date ON gsc_page_daily(date);`
    );
    console.log("[3/4] CREATE INDEX IF NOT EXISTS idx_gsc_page_daily_date -> OK");

    // ④ 验证：表存在 + 索引存在 + 列数对
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gsc_page_daily' ORDER BY ordinal_position
    `;
    const idx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'gsc_page_daily' ORDER BY indexname
    `;
    console.log(`[4/4] 列: ${cols.map((c) => c.column_name).join(", ")}`);
    console.log(`      索引: ${idx.map((i) => i.indexname).join(", ")}`);

    const hasDateIdx = idx.some((i) => i.indexname === "idx_gsc_page_daily_date");
    if (cols.length === 7 && hasDateIdx) {
      console.log("\nVerdict: PASS — gsc_page_daily 已建（7 列）+ date 索引就位。");
    } else {
      console.error(`FAIL: 期望 7 列 + date 索引，实际 ${cols.length} 列, hasDateIdx=${hasDateIdx}。`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
