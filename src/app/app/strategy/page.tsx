import { auth } from "@/lib/auth";
import { getWorkbenchSeed } from "./_components/_workbench";
import { getMarketRankings } from "./_components/_gsc-rankings";
import { loadPlan } from "./_components/_plan-store";
import { WorkbenchWrapper } from "./_components/WorkbenchWrapper";

export default async function StrategyPage() {
  const seed = getWorkbenchSeed();
  // 每市场 GSC 排名 —— 与「收录与索引」同源
  const rankings = await getMarketRankings();
  // 按登录用户读取已持久化的规划（无记录 → null，前端回退蓝图/本地草稿）
  const session = await auth();
  const owner = session?.user?.email ?? null;
  const initialPlan = owner ? await loadPlan(owner) : null;
  return <WorkbenchWrapper seed={seed} rankings={rankings} initialPlan={initialPlan} />;
}
