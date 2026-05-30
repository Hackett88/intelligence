/**
 * 蚕食检测回归脚本 —— 用真实 8 主题 29 页（_data.ts → getWorkbenchSeed）跑新旧 detectCannibalization，
 * 对比并核对关键样本。验证：① 智能指环三页两两判绿（漏斗协作）；② iTasbih 落地页×工具变体页判红
 * （真蚕食）；③ 去停用词+单复数归一后，50% 阈值是否仍合理（列出"新增/少报"对供人工定夺）。
 *
 * 运行：  npx tsx scripts/regression-cannibalization.ts
 */
import {
  getWorkbenchSeed,
  detectCannibalization,
  resolvePageIntent,
  meaningfulOverlapPct,
  serpOverlapPct,
  urlFunnelLayer,
  isHardCannibalization,
  type RawKeyword,
  type RelationType,
} from "../src/app/app/strategy/_components/_workbench";
import { ALL_KEYWORDS } from "../src/app/app/strategy/_components/_all-keywords";

const seed = getWorkbenchSeed();
const pages = seed.pages;

// 复刻 WorkbenchClient 的数据流：用初始预绑定 bindings 构造 boundByPage，注入意图 resolver
const KW_BY_ID = new Map(ALL_KEYWORDS.map((k) => [k.id, k]));
const boundByPage = new Map<string, RawKeyword[]>();
for (const [kwId, pageId] of Object.entries(seed.bindings)) {
  const kw = KW_BY_ID.get(kwId);
  if (!kw) continue;
  if (!boundByPage.has(pageId)) boundByPage.set(pageId, []);
  boundByPage.get(pageId)!.push(kw);
}
const getIntent = (id: string) => resolvePageIntent(boundByPage.get(id) ?? []);

const titleOf = (id: string) => {
  const p = pages.find((x) => x.id === id);
  return p ? p.title.slice(0, 28) : id;
};
const fam = (id: string) => getIntent(id).family ?? "—";

console.log(`\n=== 蚕食检测回归 · 真实 ${pages.length} 页 / ${new Set(pages.map((p) => p.themeId)).size} 主题 ===\n`);

// ── 旧逻辑：serpOverlapPct（不去停用词）≥50 即报红 ───────────────────────────
const oldPairs: { a: string; b: string; ov: number }[] = [];
for (let i = 0; i < pages.length; i++)
  for (let j = i + 1; j < pages.length; j++) {
    const ov = serpOverlapPct(pages[i].primaryKeyword, pages[j].primaryKeyword);
    if (ov >= 50) oldPairs.push({ a: pages[i].id, b: pages[j].id, ov });
  }
console.log(`--- 旧逻辑（只看主词词面、不去停用词、≥50 全报红）：${oldPairs.length} 对 ---`);
for (const p of oldPairs) console.log(`  红 ${p.ov}%  ${titleOf(p.a)}  ×  ${titleOf(p.b)}`);

// ── 新逻辑：三维门控 ──────────────────────────────────────────────────────────
const rel = detectCannibalization(pages, getIntent);
const byType = (t: RelationType) => rel.filter((r) => r.relationType === t);
const fmt = (r: { aId: string; bId: string; overlap: number }) =>
  `${r.overlap}%  ${titleOf(r.aId)} [${urlFunnelLayer(pages.find((p) => p.id === r.aId)?.url ?? null) ?? "—"}/${fam(r.aId)}]  ×  ${titleOf(r.bId)} [${urlFunnelLayer(pages.find((p) => p.id === r.bId)?.url ?? null) ?? "—"}/${fam(r.bId)}]`;

console.log(`\n--- 新逻辑（词面 ∧ 同漏斗层 ∧ 同意图族）：共 ${rel.length} 对 ---`);
for (const t of ["true_cannibalization", "intent_overlap", "funnel_division", "cross_theme_low"] as RelationType[]) {
  const g = byType(t);
  console.log(`\n  [${t}] ${g.length} 对：`);
  for (const r of g) console.log(`    ${fmt(r)}`);
}

// ── 关键样本核对 ─────────────────────────────────────────────────────────────
const relOf = (a: string, b: string) =>
  rel.find((r) => (r.aId === a && r.bId === b) || (r.aId === b && r.bId === a))?.relationType ?? "（未达阈值/无关系）";
const check = (got: string, want: string) => (got === want ? "✓" : "✗ 不符！");

console.log(`\n--- 关键样本核对 ---`);
console.log(`[智能指环] 期望三页两两 = funnel_division（漏斗协作，误报消除）：`);
console.log(`  collection×blog    ：${relOf("zr-pillar", "zr-c-know")}  ${check(relOf("zr-pillar", "zr-c-know"), "funnel_division")}`);
console.log(`  collection×product ：${relOf("zr-pillar", "zr-c-pdp")}  ${check(relOf("zr-pillar", "zr-c-pdp"), "funnel_division")}`);
console.log(`  blog×product       ：${relOf("zr-c-know", "zr-c-pdp")}  ${check(relOf("zr-c-know", "zr-c-pdp"), "funnel_division")}`);
console.log(`[iTasbih] 期望 = true_cannibalization（同工具层同意图，真蚕食）：`);
console.log(`  pillar×online      ：${relOf("it-pillar", "it-c-online")}  ${check(relOf("it-pillar", "it-c-online"), "true_cannibalization")}`);

// ── 阈值健康度：去停用词+归一带来的"新增/少报"候选 ───────────────────────────
console.log(`\n--- 阈值健康度（meaningfulOverlapPct vs serpOverlapPct，找 50% 附近的漂移）---`);
const newlyCrossed: string[] = [];
const droppedBelow: string[] = [];
for (let i = 0; i < pages.length; i++)
  for (let j = i + 1; j < pages.length; j++) {
    const m = meaningfulOverlapPct(pages[i].primaryKeyword, pages[j].primaryKeyword);
    const s = serpOverlapPct(pages[i].primaryKeyword, pages[j].primaryKeyword);
    if (m >= 50 && s < 50) newlyCrossed.push(`  新增候选 meaningful ${m}% (旧 serp ${s}%)  ${titleOf(pages[i].id)} × ${titleOf(pages[j].id)}`);
    if (s >= 50 && m < 50) droppedBelow.push(`  跌出 meaningful ${m}% (旧 serp ${s}%)  ${titleOf(pages[i].id)} × ${titleOf(pages[j].id)}`);
  }
console.log(`新逻辑因去停用词+归一"新冒出 ≥50%"的对：${newlyCrossed.length}`);
newlyCrossed.forEach((s) => console.log(s));
console.log(`旧 ≥50% 但新逻辑"跌破 50%"的对：${droppedBelow.length}`);
droppedBelow.forEach((s) => console.log(s));

console.log(`\n=== 回归结束 ===\n`);
