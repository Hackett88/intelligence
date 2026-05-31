import { getWorkbenchSeed } from "./_components/_workbench";
import { getMarketRankings } from "./_components/_gsc-rankings";
import { WorkbenchWrapper } from "./_components/WorkbenchWrapper";

export default async function StrategyPage() {
  const seed = getWorkbenchSeed();
  // 每市场 GSC 排名 —— 与「收录与索引」同源
  const rankings = await getMarketRankings();
  return <WorkbenchWrapper seed={seed} rankings={rankings} />;
}
