"use client";

import dynamic from "next/dynamic";
import type { PageRow, IndexingStats } from "./_mock";

export type LastSyncMeta = {
  source: "gsc" | "mock";
  fetchedAt?: string;
  property?: string;
  freshnessText?: string;
};

// 各模式最近一次成功同步的完成时间（ISO），没跑过为 null
export type SyncModeStatus = {
  full: string | null;
  weekly: string | null;
  daily: string | null;
};

interface IndexingWrapperProps {
  initialData: PageRow[];
  stats: IndexingStats;
  lastSyncMeta?: LastSyncMeta;
  syncStatus?: SyncModeStatus;
  syncEnabled?: boolean;
}

const IndexingClientDynamic = dynamic(
  () => import("./IndexingClient").then((m) => m.IndexingClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-manor-inkFaint text-sm">加载中...</span>
      </div>
    ),
  }
);

export function IndexingWrapper({
  initialData,
  stats,
  lastSyncMeta,
  syncStatus,
  syncEnabled,
}: IndexingWrapperProps) {
  return (
    <IndexingClientDynamic
      initialData={initialData}
      stats={stats}
      lastSyncMeta={lastSyncMeta}
      syncStatus={syncStatus}
      syncEnabled={syncEnabled}
    />
  );
}
