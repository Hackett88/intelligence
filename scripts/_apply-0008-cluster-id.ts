/**
 * Apply drizzle/0008_keywords_cluster_id.sql to local PG (via SSH tunnel localhost:5433).
 * Idempotent — uses ADD COLUMN IF NOT EXISTS. Verifies the column exists after running.
 *
 * Usage: pnpm exec tsx scripts/_apply-0008-cluster-id.ts
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
    const path = resolve(process.cwd(), "drizzle/0008_keywords_cluster_id.sql");
    const ddl = readFileSync(path, "utf8");
    console.log(`Applying: ${path}`);
    await sql.unsafe(ddl);
    console.log("OK: DDL executed.");

    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'keywords'
        AND column_name IN ('behavior_intent','page_planning_intent','layer_level','cluster_id','l4_subtype')
      ORDER BY column_name
    `;
    console.log("\nkeywords table columns (intent/layer/cluster family):");
    cols.forEach((c) =>
      console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(8)} nullable=${c.is_nullable}`)
    );

    const has = (name: string) => cols.some((c) => c.column_name === name);
    const required = ["behavior_intent", "page_planning_intent", "layer_level", "cluster_id"];
    const missing = required.filter((n) => !has(n));
    if (missing.length === 0) {
      console.log("\nVerdict: PASS - all 4 target columns present.");
    } else {
      console.log(`\nVerdict: FAIL - missing columns: ${missing.join(", ")}`);
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error("ERR:", err.message);
    process.exitCode = 1;
  }
  await sql.end();
})();
