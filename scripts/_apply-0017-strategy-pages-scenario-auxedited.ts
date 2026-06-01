/**
 * Apply drizzle/0017_strategy_pages_scenario_auxedited.sql to local PG (via SSH tunnel localhost:5433).
 * Adds two columns to strategy_pages (already in use with ~20 rows):
 *   - scenario_id  TEXT nullable      — 子支柱场景列 id
 *   - aux_edited   BOOLEAN NOT NULL DEFAULT false — 辅助词手工编辑标记
 *
 * Verifies after execution:
 *   - scenario_id  exists, type=text,    nullable=YES
 *   - aux_edited   exists, type=boolean, nullable=NO, default=false
 *   - strategy_pages row count unchanged (data intact)
 *   - strategy_bindings untouched (spot-check)
 *
 * Usage: pnpm exec tsx scripts/_apply-0017-strategy-pages-scenario-auxedited.ts
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
    // ── 0. 行数快照（加列前） ──────────────────────────────────────────────────
    const beforeRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM strategy_pages
    `;
    const rowsBefore = parseInt(beforeRows[0].count, 10);
    console.log(`strategy_pages rows BEFORE: ${rowsBefore}`);

    // ── 1. 应用 0017 SQL ───────────────────────────────────────────────────────
    const sqlPath = resolve(process.cwd(), "drizzle/0017_strategy_pages_scenario_auxedited.sql");
    const ddl = readFileSync(sqlPath, "utf8");
    console.log(`\nApplying: ${sqlPath}`);
    await sql.unsafe(ddl);
    console.log("OK: DDL executed.");

    // ── 2. 验证两列存在及类型 ──────────────────────────────────────────────────
    const cols = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'strategy_pages'
        AND column_name IN ('scenario_id', 'aux_edited')
      ORDER BY column_name
    `;

    console.log("\n--- Verification: new columns ---");
    cols.forEach((c) =>
      console.log(
        `  ${c.column_name.padEnd(14)} type=${c.data_type.padEnd(10)} nullable=${c.is_nullable.padEnd(4)} default=${c.column_default ?? "NULL"}`
      )
    );

    const scenarioCol = cols.find((c) => c.column_name === "scenario_id");
    const auxEditedCol = cols.find((c) => c.column_name === "aux_edited");

    const scenarioOk =
      !!scenarioCol &&
      scenarioCol.data_type === "text" &&
      scenarioCol.is_nullable === "YES";

    const auxEditedOk =
      !!auxEditedCol &&
      auxEditedCol.data_type === "boolean" &&
      auxEditedCol.is_nullable === "NO" &&
      (auxEditedCol.column_default ?? "").includes("false");

    // ── 3. 行数快照（加列后） ──────────────────────────────────────────────────
    const afterRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM strategy_pages
    `;
    const rowsAfter = parseInt(afterRows[0].count, 10);
    console.log(`\nstrategy_pages rows AFTER:  ${rowsAfter}`);
    const rowsOk = rowsAfter === rowsBefore;
    console.log(`Row count delta: ${rowsAfter - rowsBefore} (expected 0)`);

    // ── 4. 抽查 aux_edited 值全为 false（现有行） ──────────────────────────────
    const nonFalse = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM strategy_pages WHERE aux_edited = true
    `;
    const nonFalseCount = parseInt(nonFalse[0].count, 10);
    const defaultOk = nonFalseCount === 0;
    console.log(`Rows with aux_edited=true (expect 0): ${nonFalseCount}`);

    // ── 5. 抽查 scenario_id 全为 NULL（现有行） ───────────────────────────────
    const nonNull = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM strategy_pages WHERE scenario_id IS NOT NULL
    `;
    const nonNullCount = parseInt(nonNull[0].count, 10);
    const nullOk = nonNullCount === 0;
    console.log(`Rows with scenario_id NOT NULL (expect 0): ${nonNullCount}`);

    // ── 6. strategy_bindings 未被触碰（spot-check） ────────────────────────────
    const bindingsCheck = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'strategy_bindings'
    `;
    const bindingsOk = bindingsCheck.length === 1;
    console.log(`\nstrategy_bindings still exists: ${bindingsOk}`);

    // ── 7. 综合判决 ────────────────────────────────────────────────────────────
    console.log("\n--- Final Verdict ---");
    const checks = [
      { name: "scenario_id: text, nullable",            ok: scenarioOk },
      { name: "aux_edited: boolean, not null, default false", ok: auxEditedOk },
      { name: "Row count unchanged",                    ok: rowsOk },
      { name: "Existing rows aux_edited=false",         ok: defaultOk },
      { name: "Existing rows scenario_id=NULL",         ok: nullOk },
      { name: "strategy_bindings untouched",            ok: bindingsOk },
    ];
    checks.forEach((c) => console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}`));
    const allOk = checks.every((c) => c.ok);
    console.log(
      `\nVerdict: ${allOk ? "PASS" : "FAIL"} — ${
        allOk ? "columns added, all checks green." : "one or more checks failed, review above."
      }`
    );
    if (!allOk) process.exitCode = 1;

  } catch (err: any) {
    console.error("ERR:", err.message);
    process.exitCode = 1;
  }
  await sql.end();
})();
