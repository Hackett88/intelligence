/**
 * Apply drizzle/0016_strategy_plan_revive.sql to local PG (via SSH tunnel localhost:5433).
 * Revives strategy_pages and strategy_bindings (dropped in 0015),
 * with strategy_pages gaining a new aux_keywords JSONB column (M6 辅助词).
 *
 * Verifies after execution:
 *   - Both tables exist in information_schema.tables
 *   - strategy_pages.aux_keywords column exists and is type 'jsonb'
 *   - UNIQUE constraints on both tables present
 *   - Indexes on both tables present
 *   - Public table count increased by exactly 2
 *
 * Usage: pnpm exec tsx scripts/_apply-0016-strategy-plan-revive.ts
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
    // ── 0. 记录建表前的 public 表数 ──────────────────────────────────────────
    const beforeResult = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM pg_tables WHERE schemaname = 'public'
    `;
    const countBefore = parseInt(beforeResult[0].count, 10);
    console.log(`Public tables BEFORE migration: ${countBefore}`);

    // ── 1. 应用 0016 SQL ──────────────────────────────────────────────────────
    const sqlPath = resolve(process.cwd(), "drizzle/0016_strategy_plan_revive.sql");
    const ddl = readFileSync(sqlPath, "utf8");
    console.log(`\nApplying: ${sqlPath}`);
    await sql.unsafe(ddl);
    console.log("OK: DDL executed.");

    // ── 2. 验证两表存在 ───────────────────────────────────────────────────────
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('strategy_pages', 'strategy_bindings')
      ORDER BY table_name
    `;
    console.log("\n--- Verification: tables ---");
    tables.forEach((t) => console.log(`  FOUND: ${t.table_name}`));
    const tablesOk =
      tables.some((t) => t.table_name === "strategy_pages") &&
      tables.some((t) => t.table_name === "strategy_bindings");

    // ── 3. 验证 aux_keywords 列存在且类型为 jsonb ─────────────────────────────
    const auxCol = await sql<{ column_name: string; data_type: string; column_default: string }[]>`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'strategy_pages'
        AND column_name  = 'aux_keywords'
    `;
    console.log("\n--- Verification: aux_keywords column ---");
    const auxOk = auxCol.length === 1 && auxCol[0].data_type === "jsonb";
    if (auxCol.length === 1) {
      console.log(`  column_name   : ${auxCol[0].column_name}`);
      console.log(`  data_type     : ${auxCol[0].data_type}`);
      console.log(`  column_default: ${auxCol[0].column_default}`);
    } else {
      console.log("  NOT FOUND — aux_keywords missing from strategy_pages");
    }

    // ── 4. 验证 strategy_pages 所有列 ────────────────────────────────────────
    const pageCols = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'strategy_pages'
      ORDER BY ordinal_position
    `;
    console.log("\n--- strategy_pages columns ---");
    pageCols.forEach((c) =>
      console.log(`  ${c.column_name.padEnd(20)} ${c.data_type}`)
    );

    // ── 5. 验证 UNIQUE 约束 ────────────────────────────────────────────────────
    const constraints = await sql<{ constraint_name: string; table_name: string }[]>`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints
      WHERE table_schema    = 'public'
        AND table_name IN ('strategy_pages', 'strategy_bindings')
        AND constraint_type = 'UNIQUE'
      ORDER BY table_name, constraint_name
    `;
    console.log("\n--- Verification: UNIQUE constraints ---");
    constraints.forEach((c) => console.log(`  ${c.table_name}: ${c.constraint_name}`));
    const uqPages    = constraints.some((c) => c.table_name === "strategy_pages");
    const uqBindings = constraints.some((c) => c.table_name === "strategy_bindings");

    // ── 6. 验证索引 ───────────────────────────────────────────────────────────
    const indexes = await sql<{ indexname: string; tablename: string }[]>`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('strategy_pages', 'strategy_bindings')
      ORDER BY tablename, indexname
    `;
    console.log("\n--- Verification: indexes ---");
    indexes.forEach((i) => console.log(`  ${i.tablename}: ${i.indexname}`));
    const idxPagesOwner        = indexes.some((i) => i.indexname === "idx_strategy_pages_owner");
    const idxBindingsOwner     = indexes.some((i) => i.indexname === "idx_strategy_bindings_owner");
    const idxBindingsOwnerPage = indexes.some((i) => i.indexname === "idx_strategy_bindings_owner_page_id");

    // ── 7. 建表后 public 表数 ─────────────────────────────────────────────────
    const afterResult = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM pg_tables WHERE schemaname = 'public'
    `;
    const countAfter = parseInt(afterResult[0].count, 10);
    console.log(`\nPublic tables AFTER  migration: ${countAfter}`);
    console.log(`Table count delta: ${countAfter - countBefore} (expected 2)`);
    const countOk = countAfter - countBefore === 2;

    // ── 8. 综合判决 ───────────────────────────────────────────────────────────
    console.log("\n--- Final Verdict ---");
    const checks = [
      { name: "Both tables exist",              ok: tablesOk },
      { name: "aux_keywords col is jsonb",      ok: auxOk },
      { name: "UNIQUE on strategy_pages",       ok: uqPages },
      { name: "UNIQUE on strategy_bindings",    ok: uqBindings },
      { name: "idx_strategy_pages_owner",       ok: idxPagesOwner },
      { name: "idx_strategy_bindings_owner",    ok: idxBindingsOwner },
      { name: "idx_strategy_bindings_owner_page_id", ok: idxBindingsOwnerPage },
      { name: "Table count +2",                 ok: countOk },
    ];
    checks.forEach((c) => console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}`));
    const allOk = checks.every((c) => c.ok);
    console.log(`\nVerdict: ${allOk ? "PASS" : "FAIL"} — ${allOk ? "migration complete, all checks green." : "one or more checks failed, review above."}`);
    if (!allOk) process.exitCode = 1;

  } catch (err: any) {
    console.error("ERR:", err.message);
    process.exitCode = 1;
  }
  await sql.end();
})();
