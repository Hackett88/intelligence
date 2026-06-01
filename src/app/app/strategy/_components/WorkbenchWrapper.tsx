"use client";

import dynamic from "next/dynamic";
import type { WorkbenchSeed, RawKeyword, MarketRankings, IndexedMatches, PlanPayload } from "./_workbench";

interface WorkbenchWrapperProps {
  seed: WorkbenchSeed;
  /** 关键词进料源：实时读库的全表 RawKeyword（与「关键词库」同源） */
  allKeywords: RawKeyword[];
  rankings: MarketRankings;
  indexedMatches: IndexedMatches;
  /** M6：服务端按 owner 读取的已落库规划；null = 库内无记录（前端回退本地草稿/蓝图） */
  initialPlan?: PlanPayload | null;
}

const WorkbenchClientDynamic = dynamic(
  () => import("./WorkbenchClient").then((m) => m.WorkbenchClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-manor-inkFaint text-sm">加载中...</span>
      </div>
    ),
  }
);

export function WorkbenchWrapper({ seed, allKeywords, rankings, indexedMatches, initialPlan }: WorkbenchWrapperProps) {
  return (
    <WorkbenchClientDynamic
      seed={seed}
      allKeywords={allKeywords}
      rankings={rankings}
      indexedMatches={indexedMatches}
      initialPlan={initialPlan}
    />
  );
}
