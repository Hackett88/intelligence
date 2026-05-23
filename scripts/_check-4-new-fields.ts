/**
 * After running [Sync] keywords_pool → PG keywords, verify the 4 new fields
 * (behavior_intent / page_planning_intent / layer_level / cluster_id) are
 * populated in keywords table — distinct values + non-null counts + sample rows.
 */
import postgres from "postgres";
// @ts-ignore
import { config } from "dotenv";
config({ path: ".env.local" });

const sql = postgres(process.env.DATABASE_URL!, { ssl: false, connect_timeout: 10 });

(async () => {
  try {
    const total = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM keywords`;
    console.log(`Total rows: ${total[0].c}\n`);

    const counts = await sql<
      { bi_n: number; ppi_n: number; ll_n: number; ci_n: number }[]
    >`
      SELECT
        count(behavior_intent)::int      AS bi_n,
        count(page_planning_intent)::int AS ppi_n,
        count(layer_level)::int          AS ll_n,
        count(cluster_id)::int           AS ci_n
      FROM keywords
    `;
    console.log("Non-null counts:");
    console.log(`  behavior_intent      : ${counts[0].bi_n}`);
    console.log(`  page_planning_intent : ${counts[0].ppi_n}`);
    console.log(`  layer_level          : ${counts[0].ll_n}`);
    console.log(`  cluster_id           : ${counts[0].ci_n}`);

    const distinct = async (col: string) => {
      const rows = await sql<{ v: string | null; c: number }[]>`
        SELECT ${sql(col)} AS v, count(*)::int AS c
        FROM keywords
        GROUP BY ${sql(col)}
        ORDER BY c DESC
        LIMIT 12
      `;
      return rows;
    };

    for (const col of ["behavior_intent", "page_planning_intent", "layer_level", "cluster_id"]) {
      const rows = await distinct(col);
      console.log(`\nDistinct values in ${col} (top 12):`);
      rows.forEach((r) => console.log(`  ${String(r.v ?? "(NULL)").padEnd(28)} ${r.c}`));
    }

    const sample = await sql<
      {
        row_key: string;
        keyword: string;
        behavior_intent: string | null;
        page_planning_intent: string | null;
        layer_level: string | null;
        cluster_id: string | null;
      }[]
    >`
      SELECT row_key, keyword, behavior_intent, page_planning_intent, layer_level, cluster_id
      FROM keywords
      WHERE behavior_intent IS NOT NULL
         OR page_planning_intent IS NOT NULL
         OR layer_level IS NOT NULL
         OR cluster_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 5
    `;
    console.log("\nSample rows with any 4-field populated:");
    sample.forEach((r) =>
      console.log(
        `  ${r.row_key}  bi=${r.behavior_intent ?? "-"}  ppi=${r.page_planning_intent ?? "-"}  ll=${r.layer_level ?? "-"}  ci=${r.cluster_id ?? "-"}  kw="${r.keyword}"`
      )
    );
  } catch (err: any) {
    console.error("ERR:", err.message);
    process.exitCode = 1;
  }
  await sql.end();
})();
