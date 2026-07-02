/**
 * 给两个定时配置表加「每日运行时刻」字段 —— 让用户能在面板自定义触发时间。
 *   · run_hour   (0-23)  每日触发小时
 *   · run_minute (0-59)  每日触发分钟
 * 语义 = 洛杉矶时间（America/Los_Angeles），与 scheduler.ts 的判定时区一致。
 * 默认值：流量 LA 00:30、收录 LA 06:00。
 *
 * 幂等：ADD COLUMN IF NOT EXISTS。禁 drizzle-kit（snapshot 已漂移），手写直接执行。
 * 运行：  npx tsx scripts/ddl-scheduler-runtime.ts
 * 前提：  .env.local 已配 DATABASE_URL（隧道 127.0.0.1:5433 → 闲置机生产库）；SSH 隧道已起。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function loadEnvLocal(): Promise<void> {
  const file = path.join(process.cwd(), ".env.local");
  let raw: string;
  try { raw = await fs.readFile(file, "utf-8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

(async () => {
  await loadEnvLocal();
  if (!process.env.DATABASE_URL) { console.error("ERR: DATABASE_URL 未配置（.env.local）"); process.exit(1); }
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, connect_timeout: 15 });
  try {
    const probe = await sql<{ one: number }[]>`SELECT 1 AS one`;
    console.log(`[1/3] SELECT 1 -> ${probe[0]?.one}（隧道连通）`);

    // 流量：默认 LA 00:30
    await sql.unsafe(`ALTER TABLE app_traffic_scheduler_config ADD COLUMN IF NOT EXISTS run_hour   integer NOT NULL DEFAULT 0`);
    await sql.unsafe(`ALTER TABLE app_traffic_scheduler_config ADD COLUMN IF NOT EXISTS run_minute integer NOT NULL DEFAULT 30`);
    // 收录：默认 LA 06:00
    await sql.unsafe(`ALTER TABLE app_scheduler_config         ADD COLUMN IF NOT EXISTS run_hour   integer NOT NULL DEFAULT 6`);
    await sql.unsafe(`ALTER TABLE app_scheduler_config         ADD COLUMN IF NOT EXISTS run_minute integer NOT NULL DEFAULT 0`);
    console.log("[2/3] ALTER TABLE ADD COLUMN IF NOT EXISTS（run_hour / run_minute）-> OK");

    const t = await sql`SELECT run_hour, run_minute FROM app_traffic_scheduler_config WHERE id = 1`;
    const c = await sql`SELECT run_hour, run_minute FROM app_scheduler_config WHERE id = 1`;
    console.log(`[3/3] 验证 -> 流量 run=${t[0]?.run_hour}:${String(t[0]?.run_minute).padStart(2, "0")}  收录 run=${c[0]?.run_hour}:${String(c[0]?.run_minute).padStart(2, "0")}（均为 LA 时间）`);
    console.log("\nVerdict: PASS — 两表已加 run_hour / run_minute。");
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
