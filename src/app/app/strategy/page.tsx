import { getWorkbenchSeed } from "./_components/_workbench";
import { getKeywordSource } from "./_components/_keyword-source";
import { getMarketRankings, getIndexedMatches } from "./_components/_gsc-rankings";
import { loadPlan } from "./_components/_plan-store";
import { WorkbenchWrapper } from "./_components/WorkbenchWrapper";
import { auth } from "@/lib/auth";

export default async function StrategyPage() {
  // 关键词进料实时读库（与「关键词库」同源，库变进料即变）+ 每市场 GSC 排名 + 收录索引匹配表
  const [allKeywords, rankings, indexedMatches] = await Promise.all([
    getKeywordSource(),
    getMarketRankings(),
    getIndexedMatches(),
  ]);
  const seed = getWorkbenchSeed(allKeywords);
  // M6：按登录账号读取已落库的规划（DB 为权威）；无记录 → null，前端回退本地草稿/蓝图种子
  const session = await auth();
  const owner = session?.user?.email ?? null;
  const initialPlan = owner ? await loadPlan(owner) : null;
  return (
    <WorkbenchWrapper
      seed={seed}
      allKeywords={allKeywords}
      rankings={rankings}
      indexedMatches={indexedMatches}
      initialPlan={initialPlan}
    />
  );
}
