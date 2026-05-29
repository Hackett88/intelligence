"use client";

import dynamic from "next/dynamic";
import type { WorkbenchSeed, MarketRankings, PlanPayload } from "./_workbench";

interface WorkbenchWrapperProps {
  seed: WorkbenchSeed;
  rankings: MarketRankings;
  initialPlan: PlanPayload | null;
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

export function WorkbenchWrapper({ seed, rankings, initialPlan }: WorkbenchWrapperProps) {
  return <WorkbenchClientDynamic seed={seed} rankings={rankings} initialPlan={initialPlan} />;
}
