/**
 * 建表 gsc_index_requests —— 「请求编入索引」历史计数(每 URL 一行:次数 + 上次提交时刻)。
 *
 * 用途:请求索引改为「弹清单勾选确认」后,清单里逐页显示历史请求次数/上次时间,
 * 防止对同一页短期内反复烧配额。单页路由 /request-index 成功提交(status=requested)时 +1,
 * 单页抽屉按钮与批量勾选流共用同一计数。
 *
 * 纯增量幂等 DDL。本地 PG == 生产 PG(共享同一库,SSH 隧道 127.0.0.1:5433),
 * 故禁用 drizzle-kit generate/push/migrate(snapshot 已漂移);手写 CREATE TABLE IF NOT EXISTS 直接执行。
 *
 * 运行:  npx tsx scripts/ddl-index-requests.ts
 * 前提:  .env.local 已配 DATABASE_URL(指向隧道 127.0.0.1:5433);SSH 隧道已起。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// .env.local 自加载(standalone tsx 不会自动注入 Next env)。照搬同目录 DDL 脚本做法,不打印任何值。
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
    console.error("ERR: DATABASE_URL 未配置(.env.local)。");
    process.exitCode = 1;
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { ssl: false, connect_timeout: 10 });
  try {
    // ① 隧道连通探针
    const probe = await sql<{ one: number }[]>`SELECT 1 AS one`;
    console.log(`[1/3] SELECT 1 -> ${probe[0]?.one}  (隧道连通)`);

    // ② 建表(幂等)
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS gsc_index_requests (
        url_norm          text PRIMARY KEY,
        full_url          text NOT NULL,
        request_count     integer NOT NULL DEFAULT 0,
        last_requested_at timestamptz,
        updated_at        timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("[2/3] CREATE TABLE IF NOT EXISTS gsc_index_requests -> OK");

    // ③ 验证:表存在 + 列数对
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gsc_index_requests' ORDER BY ordinal_position
    `;
    console.log(`[3/3] 列: ${cols.map((c) => c.column_name).join(", ")}`);

    if (cols.length === 5) {
      console.log("\nVerdict: PASS — gsc_index_requests 已建(5 列)。");
    } else {
      console.error(`FAIL: 期望 5 列,实际 ${cols.length} 列。`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
