/**
 * 增量同步：从 N8N 候选词池 DataTable (3irgfvwK6W7XumHj) 增量 upsert 到本地
 * PostgreSQL 的 keywords 表。
 *
 * 同步模型：
 *   - 业务唯一键 = row_key（源端稳定 id，已加 UNIQUE 约束，见 0004 migration）
 *   - INSERT ... ON CONFLICT (row_key) DO UPDATE 实现"有则刷字段、无则新增"
 *   - 本地行如果不再出现于源端，本次保留不动（如需软删请单独立项）
 *
 * 字段所有权：
 *   - 源端字段（keyword/market/.../question_type）→ 每次 upsert 用源端值覆盖
 *   - protected → 本地 UI 可写，仅在首次 INSERT 时写入源端值，后续 upsert 不覆盖
 *   - createdAt  → 仅在首次 INSERT 时由 schema defaultNow() 设置
 *   - updatedAt  → 每次 upsert 触达都刷新为 NOW()
 *
 * 删除同步（源端孤儿处理）：
 *   - 源端不再出现的本地行 → 默认 DELETE（硬删）
 *   - 但若本地行 protected = TRUE → 保留不删（protected 字段语义本身就是"保护"）
 *   - 兜底：若源端返回 0 行（异常），refuse to delete，避免清空本地表
 *
 * NOTE: client.ts 在模块顶部就调用 postgres(process.env.DATABASE_URL!)。
 * 必须先 dotenv.config() 再 dynamic import 它，避免 ESM hoisting 导致
 * DATABASE_URL 未定义而连默认 127.0.0.1:5432。
 */
import * as fs from "node:fs";
// @ts-ignore — dotenv is a transitive dep (drizzle-kit), no @types installed by design (与 _dbtest.ts 一致)
import { config } from "dotenv";

config({ path: ".env.local" });

const N8N_CONFIG_PATH =
  process.env.N8N_CONFIG_PATH ??
  "C:/Users/lxpfo/.claude/skills/n8n-api/config.env";
const TABLE_ID = "3irgfvwK6W7XumHj";

function loadN8nConfig(): { baseUrl: string; apiKey: string } {
  const cfg = fs.readFileSync(N8N_CONFIG_PATH, "utf8");
  const baseUrl = cfg.match(/^N8N_BASE_URL=(.+)$/m)?.[1].trim();
  const apiKey = cfg.match(/^N8N_API_KEY=(.+)$/m)?.[1].trim();
  if (!baseUrl || !apiKey) {
    throw new Error(`Failed to parse N8N config from ${N8N_CONFIG_PATH}`);
  }
  return { baseUrl, apiKey };
}

interface PoolRow {
  keyword: string;
  market: string | null;
  month: string | null;
  row_key: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
  cpc: number | null;
  number_of_results: number | null;
  trends: string | null;
  intent: string | null;
  serp_features_keyword: string | null;
  bp: number | null;
  cs: number | null;
  source_row_keys: string | null;
  protected: boolean | null;
  question_type: string | null;
}

async function fetchAllRows(): Promise<PoolRow[]> {
  const { baseUrl, apiKey } = loadN8nConfig();
  const all: PoolRow[] = [];
  let cursor: string | null = null;
  do {
    const url =
      `${baseUrl}/api/v1/data-tables/${TABLE_ID}/rows?limit=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, {
      headers: { "X-N8N-API-KEY": apiKey, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`N8N API ${res.status} ${res.statusText}`);
    }
    const json: any = await res.json();
    if (!Array.isArray(json.data)) {
      throw new Error("N8N response missing data array");
    }
    all.push(...(json.data as PoolRow[]));
    cursor = json.nextCursor ?? null;
  } while (cursor);
  return all;
}

(async () => {
  // dynamic import after dotenv ran
  const { db } = await import("../src/db/client");
  const { keywords } = await import("../src/db/schema");
  const { sql, and, notInArray } = await import("drizzle-orm");

  console.log("[1/4] Fetching rows from N8N keywords_pool...");
  const rows = await fetchAllRows();
  console.log(`  -> fetched ${rows.length} rows`);

  // 防御：源端探查时 row_key 100% 非空，这里保留一道兜底
  const skipped = rows.filter((r) => r.row_key == null || r.row_key === "");
  if (skipped.length > 0) {
    console.warn(`  !! skipping ${skipped.length} rows with empty row_key`);
  }
  const validRows = rows.filter((r) => r.row_key != null && r.row_key !== "");

  // 关键兜底：源端 0 行不删任何本地行（避免源端拉取异常导致清表）
  if (validRows.length === 0) {
    throw new Error("Source returned 0 valid rows — refusing to upsert/delete (would risk wiping table)");
  }

  console.log("[2/4] Mapping rows...");
  const mapped = validRows.map((r) => ({
    keyword: r.keyword,
    market: r.market,
    month: r.month,
    rowKey: r.row_key as string,
    searchVolume: r.search_volume,
    keywordDifficulty: r.keyword_difficulty,
    cpc: r.cpc,
    numberOfResults: r.number_of_results,
    trends: r.trends,
    intent: r.intent,
    serpFeaturesKeyword: r.serp_features_keyword,
    bp: r.bp,
    cs: r.cs,
    sourceRowKeys: r.source_row_keys,
    protected: r.protected,         // 仅 INSERT 路径生效；UPDATE 路径下方 set 中不带
    questionType: r.question_type,
  }));

  console.log("[3/4] Upserting (INSERT ON CONFLICT row_key DO UPDATE)...");
  const result = await db
    .insert(keywords)
    .values(mapped)
    .onConflictDoUpdate({
      target: keywords.rowKey,
      set: {
        // 源端字段：每次以源端值覆盖
        keyword:             sql`EXCLUDED.keyword`,
        market:              sql`EXCLUDED.market`,
        month:               sql`EXCLUDED.month`,
        searchVolume:        sql`EXCLUDED.search_volume`,
        keywordDifficulty:   sql`EXCLUDED.keyword_difficulty`,
        cpc:                 sql`EXCLUDED.cpc`,
        numberOfResults:     sql`EXCLUDED.number_of_results`,
        trends:              sql`EXCLUDED.trends`,
        intent:              sql`EXCLUDED.intent`,
        serpFeaturesKeyword: sql`EXCLUDED.serp_features_keyword`,
        bp:                  sql`EXCLUDED.bp`,
        cs:                  sql`EXCLUDED.cs`,
        sourceRowKeys:       sql`EXCLUDED.source_row_keys`,
        questionType:        sql`EXCLUDED.question_type`,
        // 时间戳
        updatedAt:           sql`NOW()`,
        // 注意：不带 `protected`（本地 UI 可写）
        // 注意：不带 `createdAt`（首次 INSERT 由 schema defaultNow() 设置）
      },
    })
    .returning({
      id: keywords.id,
      // PostgreSQL 系统列：xmax = 0 表示这一行是 INSERT 新写入的；xmax <> 0 表示走了 UPDATE 分支
      isNew: sql<boolean>`(xmax = 0)`,
    });

  const insertedCount = result.filter((r) => r.isNew).length;
  const updatedCount = result.length - insertedCount;

  console.log("[4/4] Deleting source orphans (protected rows kept)...");
  const sourceRowKeys = validRows.map((r) => r.row_key as string);
  const deleted = await db
    .delete(keywords)
    .where(
      and(
        sql`"protected" IS NOT TRUE`,
        notInArray(keywords.rowKey, sourceRowKeys),
      ),
    )
    .returning({ rowKey: keywords.rowKey });
  console.log(`  -> deleted ${deleted.length} orphan rows`);

  console.log("\nReport:");
  console.log(`  fetched : ${rows.length}`);
  console.log(`  skipped : ${skipped.length} (empty row_key)`);
  console.log(`  inserted: ${insertedCount}`);
  console.log(`  updated : ${updatedCount}`);
  console.log(`  deleted : ${deleted.length} (source orphans, protected kept)`);
  console.log(`  sample[0]: ${rows[0]?.keyword} (${rows[0]?.market}, sv=${rows[0]?.search_volume})`);

  // 缓存提示：本脚本是独立进程，清不到运行中 server 进程里的 keywords 内存缓存
  // （src/lib/keywords-cache.ts，globalThis + TTL 60s）。导入后 /app/keywords 最长
  // 60s 仍显示旧数据，之后随 TTL 自愈；想立即生效就重启 server。应用内增删改/刷新
  // 走的是 invalidateKeywordsCache()，不受此影响。
  console.log(
    "\n  [cache] 运行中页面缓存最多 60s 后自动刷新（想立即生效请重启 dev/prod server）",
  );

  process.exit(0);
})().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
