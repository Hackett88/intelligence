// 把 .tmp/kw.json（真实 176 词）转成工作台数据底座 _all-keywords.ts
import { readFileSync, writeFileSync } from "fs";
const rows = JSON.parse(readFileSync(".tmp/kw.json", "utf8")) as any[];
const esc = (s: string | null) => s == null ? "null" : JSON.stringify(s);
const lines = rows.map((r, i) => {
  return `  { id: "k${i}", keyword: ${JSON.stringify(r.keyword)}, market: ${esc(r.market)}, sv: ${r.sv ?? "null"}, kd: ${r.kd ?? "null"}, intent: ${esc(r.intent)}, behaviorIntent: ${esc(r.bi)}, pagePlanningIntent: ${esc(r.ppi)}, layer: ${esc(r.layer)}, questionType: ${esc(r.qtype)} },`;
});
const out = `// AUTO-GENERATED from .tmp/kw.json (真实关键词库 176 词). 勿手改；改数据请重跑 scripts/_gen-all-keywords.ts。
import type { RawKeyword } from "./_workbench";

export const ALL_KEYWORDS: RawKeyword[] = [
${lines.join("\n")}
];
`;
writeFileSync("src/app/app/strategy/_components/_all-keywords.ts", out);
console.log("wrote _all-keywords.ts with", rows.length, "keywords");
