/**
 * 建表 app_traffic_scheduler_config —— 应用内「定时更新（流量）」单行配置（id=1）。
 *
 * 纯增量幂等 DDL。本地 PG == 生产 PG（共享同一库，SSH 隧道 127.0.0.1:5433），
 * 故禁用 drizzle-kit generate/push/migrate（snapshot 已漂移）；这里手写 CREATE TABLE IF NOT EXISTS 直接执行。
 *
 * 步骤：① SELECT 1 验隧道连通 ② CREATE TABLE IF NOT EXISTS ③ INSERT 种子行(id=1) ON CONFLICT DO NOTHING
 *      ④ SELECT * 验证有 1 行。
 *
 * 运行：  npx tsx scripts/ddl-traffic-scheduler.ts
 * 前提：  .env.local 已配 DATABASE_URL（指向隧道 127.0.0.1:5433）；SSH 隧道已起。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// .env.local 自加载（standalone tsx 不会自动注入 Next env）。照搬 backfill/calibrate 做法，不打印任何值。
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
      CREATE TABLE IF NOT EXISTS app_traffic_scheduler_config (
        id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled boolean NOT NULL DEFAULT false,
        interval_minutes integer NOT NULL DEFAULT 1440,
        last_run_at timestamptz,
        last_run_summary jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("[2/4] CREATE TABLE IF NOT EXISTS app_traffic_scheduler_config -> OK");

    // ③ 种子单行
    await sql.unsafe(
      `INSERT INTO app_traffic_scheduler_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`
    );
    console.log("[3/4] INSERT 种子行 (id=1) ON CONFLICT DO NOTHING -> OK");

    // ④ 验证
    const rows = await sql<
      {
        id: number;
        enabled: boolean;
        interval_minutes: number;
        last_run_at: Date | null;
        last_run_summary: unknown;
        updated_at: Date;
      }[]
    >`SELECT * FROM app_traffic_scheduler_config ORDER BY id`;
    console.log(`[4/4] SELECT * -> ${rows.length} 行`);
    console.table(
      rows.map((r) => ({
        id: r.id,
        enabled: r.enabled,
        interval_minutes: r.interval_minutes,
        last_run_at: r.last_run_at,
        last_run_summary: r.last_run_summary,
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      }))
    );

    if (rows.length === 1 && rows[0].id === 1) {
      console.log("\nVerdict: PASS — 表已建、种子行就位（1 行，id=1）。");
    } else {
      console.error(`FAIL: 期望 1 行 id=1，实际 ${rows.length} 行。`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
