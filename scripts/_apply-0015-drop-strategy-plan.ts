/**
 * Apply drizzle/0015_drop_strategy_plan.sql to local PG (via SSH tunnel localhost:5433).
 * Drops strategy_bindings and strategy_pages (废弃的选题工作台持久化层).
 * Verifies both tables no longer exist in information_schema after execution.
 *
 * Usage: pnpm exec tsx scripts/_apply-0015-drop-strategy-plan.ts
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore
import { config } from "dotenv";
config({ path: ".env.local" });

const sql = postgres(process.env.DATABASE_URL!, { ssl: false, connect_timeout: 10 });

(async () => {
  try {
    const path = resolve(process.cwd(), "drizzle/0015_drop_strategy_plan.sql");
    const ddl = readFileSync(path, "utf8");
    console.log(`Applying: ${path}`);
    await sql.unsafe(ddl);
    console.log("OK: DDL executed.");

    // 验证：两表均不存在于 information_schema.tables
    const remaining = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('strategy_pages', 'strategy_bindings')
    `;

    console.log("\n--- Verification (should be 0 rows) ---");
    if (remaining.length === 0) {
      console.log("  (no rows — both tables gone)");
      console.log("\nVerdict: PASS - strategy_pages and strategy_bindings successfully dropped.");
    } else {
      console.log("  Still present:", remaining.map((r) => r.table_name).join(", "));
      console.log("\nVerdict: FAIL - one or more target tables still exist.");
      process.exitCode = 1;
    }

    // 列出删后剩余的所有 public 表，供人工核对
    const allTables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    console.log("\n--- All public tables (AFTER DROP) ---");
    allTables.forEach((t) => console.log(" ", t.tablename));
  } catch (err: any) {
    console.error("ERR:", err.message);
    process.exitCode = 1;
  }
  await sql.end();
})();
