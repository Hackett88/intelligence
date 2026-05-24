"use client";

import dynamic from "next/dynamic";
import type { PageRow, IndexingStats } from "./_mock";

export type LastSyncMeta = {
  source: "gsc" | "mock";
  fetchedAt?: string;
  property?: string;
  freshnessText?: string;
};

interface IndexingWrapperProps {
  initialData: PageRow[];
  stats: IndexingStats;
  lastSyncMeta?: LastSyncMeta;
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
}: IndexingWrapperProps) {
  return (
    <IndexingClientDynamic
      initialData={initialData}
      stats={stats}
      lastSyncMeta={lastSyncMeta}
    />
  );
}
