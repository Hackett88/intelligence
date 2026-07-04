/**
 * 收录检查退避机制 DDL(三条打包,均幂等纯增):
 *   ① gsc_index_status 加 2 列:check_count(累计检查次数)、not_indexed_streak(连续未收录次数)
 *      —— 退避节律依据:streak=1→隔1天,=2→隔3天,>=3→每周;排序依据:check_count 升序。
 *   ② 新表 gsc_api_usage(day,kind PK):按天记 API 用量(url_inspection 精确计数 / traffic_rounds 轮数)。
 *   ③ app_scheduler_config 加 tuning jsonb:退避参数(用量面板可调,NULL=用代码默认 1/3/7/7 天)。
 *
 * 本地 PG == 生产 PG(共享同一库);禁 drizzle-kit(snapshot 漂移),手写幂等 DDL 直接执行。
 * 运行:  npx tsx scripts/ddl-inspect-backoff.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

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
    const probe = await sql<{ one: number }[]>`SELECT 1 AS one`;
    console.log(`[1/5] SELECT 1 -> ${probe[0]?.one}  (隧道连通)`);

    // ① 状态表加 2 列
    await sql.unsafe(`
      ALTER TABLE gsc_index_status
        ADD COLUMN IF NOT EXISTS check_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS not_indexed_streak integer NOT NULL DEFAULT 0;
    `);
    console.log("[2/5] ALTER gsc_index_status +check_count +not_indexed_streak -> OK");

    // ② 用量表
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS gsc_api_usage (
        day        date NOT NULL,
        kind       text NOT NULL,
        count      integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (day, kind)
      );
    `);
    console.log("[3/5] CREATE TABLE IF NOT EXISTS gsc_api_usage -> OK");

    // ③ 配置表加 tuning
    await sql.unsafe(`
      ALTER TABLE app_scheduler_config
        ADD COLUMN IF NOT EXISTS tuning jsonb;
    `);
    console.log("[4/5] ALTER app_scheduler_config +tuning -> OK");

    // 验证
    const c1 = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gsc_index_status' AND column_name IN ('check_count','not_indexed_streak')`;
    const c2 = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'gsc_api_usage'`;
    const c3 = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'app_scheduler_config' AND column_name = 'tuning'`;
    console.log(`[5/5] status+${c1.length}列 | usage ${c2.length}列 | config+${c3.length}列`);

    if (c1.length === 2 && c2.length === 4 && c3.length === 1) {
      console.log("\nVerdict: PASS — 三条 DDL 全部就位。");
    } else {
      console.error("FAIL: 列结构与预期不符。");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("ERR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
