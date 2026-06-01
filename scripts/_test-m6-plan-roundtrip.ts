/**
 * M6 一次性自测：savePlan / loadPlan 往返无损 + aux_keywords 落库。
 *
 * 用本地库（.env.local 的 DATABASE_URL，127.0.0.1:5433，非生产）。
 * 流程：
 *   1. 用一个隔离 owner（m6-selftest@weslamic.com）保证不污染真实账号数据。
 *   2. 构造 PlanPayload：含 pages（带 auxKeywords）+ bindings（kwId→pageId）+ parked（kwId[]）。
 *   3. savePlan → 查 strategy_pages / strategy_bindings 行数与内容（含 aux_keywords）。
 *   4. loadPlan → 与原 plan 等价（kwId↔自然键往返无损）。
 *   5. 清理该 owner 的测试行（不动其余 owner）。
 *
 * 运行：npx tsx scripts/_test-m6-plan-roundtrip.ts
 */
import { readFileSync } from "node:fs";

// 先注入 DATABASE_URL（store 经 @/db/client 读 process.env），再动态 import store。
const env = readFileSync(".env.local", "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if (!dbUrl) {
  console.error("FAIL: .env.local 无 DATABASE_URL");
  process.exit(1);
}
process.env.DATABASE_URL = dbUrl.replace(/^["']|["']$/g, "");

const OWNER = "m6-selftest@weslamic.com";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exit(1);
  }
  console.log("  ok:", msg);
}

(async () => {
  const { savePlan, loadPlan } = await import("@/app/app/strategy/_components/_plan-store");
  const { ALL_KEYWORDS } = await import("@/app/app/strategy/_components/_all-keywords");
  const { getKeywordSource } = await import("@/app/app/strategy/_components/_keyword-source");
  const { db } = await import("@/db/client");
  const { strategyPages, strategyBindings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  // 选 3 个真实词 id 做绑定/暂存：进料已改实时读库，故 savePlan 用的是 getKeywordSource 的
  // id 体系（k<dbid>）。这里也从同一进料取词，保证 kwId↔自然键能往返（与 savePlan 同源）。
  const liveKeywords = await getKeywordSource();
  const k0 = liveKeywords[0]; // bound
  const k1 = liveKeywords[1]; // bound
  const k2 = liveKeywords[2]; // parked
  console.log(`选词：bound=[${k0.id} "${k0.keyword}"/${k0.market}, ${k1.id} "${k1.keyword}"/${k1.market}], parked=[${k2.id} "${k2.keyword}"/${k2.market}]`);

  // ── [0] reconcile「空则补 seed」回填逻辑自测 ───────────────────────────────
  // 复现 WorkbenchClient.initState 的 reconcile 核心规则（蓝图页：auxKeywords 空则补 seed，
  // 非空则保留），用真实 getWorkbenchSeed() 的页验证。模拟旧 localStorage 草稿无 auxKeywords。
  {
    const { getWorkbenchSeed } = await import("@/app/app/strategy/_components/_workbench");
    const seed = getWorkbenchSeed(ALL_KEYWORDS);
    const seedById = new Map(seed.pages.map((p) => [p.id, p]));
    // 取一个 seed 里确有非空 auxKeywords 的蓝图页（如 dk-pillar）做样本
    const seedSample = seed.pages.find((p) => (p.auxKeywords?.length ?? 0) > 0);
    assert(!!seedSample, "seed 中存在含非空 auxKeywords 的蓝图页（如 dk-pillar）");
    const sampleId = seedSample!.id;
    console.log(`  reconcile 样本页：${sampleId}，seed.auxKeywords=${JSON.stringify(seedSample!.auxKeywords)}`);

    // reconcile 的「未编辑 ∧ 空 → 补 seed」纯函数（与 WorkbenchClient 同规则）
    const reconcileAux = (
      draftAux: string[] | undefined,
      auxEdited: boolean | undefined,
      sp: { auxKeywords?: string[] } | undefined,
    ) => {
      if (!sp) return draftAux; // 用户自建页：不动
      const auxEmpty = !draftAux || draftAux.length === 0;
      return (!auxEdited && auxEmpty) ? sp.auxKeywords : draftAux;
    };

    // 场景 A：旧草稿页 auxKeywords=undefined（M1 时无字段）、未编辑 → 应补成 seed 值
    const aA = reconcileAux(undefined, false, seedById.get(sampleId));
    assert(JSON.stringify(aA) === JSON.stringify(seedSample!.auxKeywords), "草稿 aux=undefined ∧ 未编辑 → 补 seed 值（非空）");
    // 场景 B：DB 落成空 []、未编辑 → 应补成 seed 值（这正是上一次缺陷的自愈点）
    const aB = reconcileAux([], false, seedById.get(sampleId));
    assert(JSON.stringify(aB) === JSON.stringify(seedSample!.auxKeywords), "草稿 aux=[] ∧ 未编辑 → 补 seed 值（修正 DB 空 aux）");
    // 场景 C：草稿已有非空 auxKeywords（未编辑也）→ 保留，不被 seed 覆盖
    const userAux = ["user-edited-1", "user-edited-2"];
    const aC = reconcileAux(userAux, false, seedById.get(sampleId));
    assert(JSON.stringify(aC) === JSON.stringify(userAux), "草稿 aux 非空 → reconcile 后保留");
    // 场景 D：用户自建页（seed 无）→ 不补
    const aD = reconcileAux(undefined, false, seedById.get("usr-pil-9999"));
    assert(aD === undefined, "用户自建页（seed 无）aux=undefined → 不补（保持 undefined）");
    // 场景 E（限制2 核心）：auxEdited=true ∧ aux=[] → 保留 []（尊重用户清空，不补 seed）
    const aE = reconcileAux([], true, seedById.get(sampleId));
    assert(Array.isArray(aE) && aE.length === 0, "auxEdited=true ∧ aux=[] → 保留 []（不补 seed，尊重用户清空）");
    // 场景 F：auxEdited=undefined（旧草稿无此字段）∧ aux=[] → 视为未编辑，补 seed
    const aF = reconcileAux([], undefined, seedById.get(sampleId));
    assert(JSON.stringify(aF) === JSON.stringify(seedSample!.auxKeywords), "auxEdited 缺失 ∧ aux=[] → 视为未编辑、补 seed");
  }

  const plan = {
    pages: [
      {
        id: "test-pillar",
        role: "pillar" as const,
        pillarId: null,
        title: "M6 Test Pillar",
        primaryKeyword: "m6 test",
        pageType: "知识深度页" as const,
        status: "gap" as const,
        url: null,
        market: "us" as const,
        markets: ["us", "uk"] as const as unknown as ("us" | "uk")[],
        position: null,
        clicks: null,
        impressions: null,
        note: "辅助词[实体]：alpha · beta · gamma",
        auxKeywords: ["alpha", "beta", "gamma"],
        auxEdited: false, // 未编辑（默认）
        themeId: "test-pillar",
        themeName: "M6 Test",
        themeLatin: "M6TEST",
        territory: "知识" as const,
      },
      {
        id: "test-cluster",
        role: "cluster" as const,
        pillarId: "test-pillar",
        title: "M6 Test Cluster",
        primaryKeyword: "m6 cluster",
        pageType: "品类聚合页" as const,
        status: "gap" as const,
        url: "/collections/m6-test",
        market: "us" as const,
        markets: ["us"] as ("us")[],
        position: null,
        clicks: null,
        impressions: null,
        auxKeywords: [] as string[], // 用户清空后的空数组（配 auxEdited=true 应原样落库/取回）
        auxEdited: true,             // 用户手工改过 → 落库 aux_edited=true
        scenarioId: "knowledge-dhikr", // 自建子支柱的格子归属 → 落库 scenario_id
        themeId: "test-pillar",
        themeName: "M6 Test",
        themeLatin: "M6TEST",
        territory: "知识" as const,
      },
    ],
    bindings: { [k0.id]: "test-pillar", [k1.id]: "test-cluster" },
    parked: [k2.id],
  };

  // 先清掉残留（保证可重复运行）
  await db.delete(strategyBindings).where(eq(strategyBindings.owner, OWNER));
  await db.delete(strategyPages).where(eq(strategyPages.owner, OWNER));

  console.log("\n[1] savePlan ...");
  await savePlan(OWNER, plan as any);

  console.log("\n[2] 校验落库行 ...");
  const pageRows = await db.select().from(strategyPages).where(eq(strategyPages.owner, OWNER));
  const bindRows = await db.select().from(strategyBindings).where(eq(strategyBindings.owner, OWNER));
  assert(pageRows.length === 2, `strategy_pages 行数 = 2（实际 ${pageRows.length}）`);
  assert(bindRows.length === 3, `strategy_bindings 行数 = 3（2 bound + 1 parked，实际 ${bindRows.length}）`);

  const pillarRow = pageRows.find((r) => r.pageId === "test-pillar")!;
  const clusterRow = pageRows.find((r) => r.pageId === "test-cluster")!;
  console.log("  pillar.aux_keywords =", JSON.stringify(pillarRow.auxKeywords));
  console.log("  cluster.aux_keywords =", JSON.stringify(clusterRow.auxKeywords));
  assert(JSON.stringify(pillarRow.auxKeywords) === JSON.stringify(["alpha", "beta", "gamma"]), "pillar.aux_keywords 落库 = [alpha,beta,gamma]");
  assert(Array.isArray(clusterRow.auxKeywords) && (clusterRow.auxKeywords as any[]).length === 0, "cluster.aux_keywords 落库 = []（空数组而非 NULL）");
  assert(JSON.stringify(pillarRow.markets) === JSON.stringify(["us", "uk"]), "pillar.markets 落库 = [us,uk]");
  // 限制1：scenario_id 落库
  console.log("  pillar.scenario_id =", JSON.stringify(pillarRow.scenarioId), "| cluster.scenario_id =", JSON.stringify(clusterRow.scenarioId));
  assert(pillarRow.scenarioId === null, "pillar.scenario_id 落库 = NULL（未设）");
  assert(clusterRow.scenarioId === "knowledge-dhikr", "cluster.scenario_id 落库 = knowledge-dhikr");
  // 限制2：aux_edited 落库
  console.log("  pillar.aux_edited =", pillarRow.auxEdited, "| cluster.aux_edited =", clusterRow.auxEdited);
  assert(pillarRow.auxEdited === false, "pillar.aux_edited 落库 = false");
  assert(clusterRow.auxEdited === true, "cluster.aux_edited 落库 = true");

  const parkedRow = bindRows.find((b) => b.state === "parked")!;
  const boundRows = bindRows.filter((b) => b.state === "bound");
  assert(parkedRow.keyword === k2.keyword && parkedRow.pageId === null, `parked 行 keyword="${k2.keyword}" pageId=NULL`);
  assert(boundRows.length === 2 && boundRows.every((b) => b.pageId === "test-pillar" || b.pageId === "test-cluster"), "bound 行 pageId 正确");
  // market 自然键：k0/k1/k2 的 market 不为 null 时存原值，否则空串
  for (const b of bindRows) {
    assert(b.market !== null, `binding.market 非 NULL（"${b.keyword}" → "${b.market}"）`);
  }

  console.log("\n[3] loadPlan 往返 ...");
  const loaded = await loadPlan(OWNER);
  assert(loaded !== null, "loadPlan 返回非 null");
  assert(loaded!.pages.length === 2, `往返 pages 数 = 2（实际 ${loaded!.pages.length}）`);

  const lPillar = loaded!.pages.find((p) => p.id === "test-pillar")!;
  const lCluster = loaded!.pages.find((p) => p.id === "test-cluster")!;
  assert(JSON.stringify(lPillar.auxKeywords) === JSON.stringify(["alpha", "beta", "gamma"]), "往返 pillar.auxKeywords 等价");
  assert(JSON.stringify(lCluster.auxKeywords) === JSON.stringify([]), "往返 cluster.auxKeywords = []");
  assert(lPillar.role === "pillar" && lCluster.pillarId === "test-pillar", "往返 role/pillarId 等价");
  assert(lCluster.url === "/collections/m6-test", "往返 url 等价");
  assert(JSON.stringify(lPillar.markets) === JSON.stringify(["us", "uk"]), "往返 markets 等价");
  // 限制1：scenarioId 往返（NULL→undefined / 值原样回来）
  assert(lPillar.scenarioId === undefined, "往返 pillar.scenarioId = undefined（DB NULL）");
  assert(lCluster.scenarioId === "knowledge-dhikr", "往返 cluster.scenarioId = knowledge-dhikr");
  // 限制2：auxEdited 往返
  assert(lPillar.auxEdited === false, "往返 pillar.auxEdited = false");
  assert(lCluster.auxEdited === true, "往返 cluster.auxEdited = true（用户清空标记保留，配空 aux 不被回填）");

  // bindings：kwId 必须原样回来（kwId↔自然键往返无损）
  assert(loaded!.bindings[k0.id] === "test-pillar", `往返 bindings[${k0.id}] = test-pillar`);
  assert(loaded!.bindings[k1.id] === "test-cluster", `往返 bindings[${k1.id}] = test-cluster`);
  assert(loaded!.parked.includes(k2.id), `往返 parked 含 ${k2.id}`);
  assert(Object.keys(loaded!.bindings).length === 2, "往返 bindings 恰 2 条");
  assert(loaded!.parked.length === 1, "往返 parked 恰 1 条");

  console.log("\n[4] 清理测试行 ...");
  await db.delete(strategyBindings).where(eq(strategyBindings.owner, OWNER));
  await db.delete(strategyPages).where(eq(strategyPages.owner, OWNER));
  const leftP = await db.select().from(strategyPages).where(eq(strategyPages.owner, OWNER));
  const leftB = await db.select().from(strategyBindings).where(eq(strategyBindings.owner, OWNER));
  assert(leftP.length === 0 && leftB.length === 0, "清理后 owner 行数 = 0");

  console.log("\n✅ ALL PASS — savePlan/loadPlan 往返无损，aux_keywords 落库正确。");
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
