import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper } from "./_components/IndexingWrapper";
import { loadCoveragePages } from "@/lib/gsc/coverage-loader";
import { loadLastSyncByModeCached } from "@/lib/gsc/loader";
import { isGscApiConfigured } from "@/lib/gsc/index-inspection-api-fetcher";

// GSC 抓取依赖本地浏览器（CDP 127.0.0.1:9222），只有本地开发环境能跑；
// 生产部署没有本地 Chrome，前端据此禁用"更新"并提示联系管理员。
const SYNC_ENABLED = process.env.NODE_ENV !== "production";

const VALID_WINDOWS = [7, 28, 90] as const;

export default async function IndexingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.window === "string" ? parseInt(params.window, 10) : NaN;
  const windowDays = (VALID_WINDOWS as readonly number[]).includes(raw) ? raw : 90;

  const trafficApiConfigured = isGscApiConfigured();
  const [snapshot, syncStatus] = await Promise.all([
    loadCoveragePages(windowDays),
    loadLastSyncByModeCached(),
  ]);
  if (snapshot) {
    return (
      <IndexingWrapper
        initialData={snapshot.pages}
        stats={snapshot.stats}
        lastSyncMeta={{
          fetchedAt: snapshot.fetchedAt,
          property: snapshot.property,
          freshnessText: snapshot.freshnessText,
          source: "gsc",
        }}
        syncStatus={syncStatus}
        syncEnabled={SYNC_ENABLED}
        trafficApiConfigured={trafficApiConfigured}
        windowDays={windowDays}
      />
    );
  }
  return (
    <IndexingWrapper
      initialData={getMockPages()}
      stats={getMockStats()}
      lastSyncMeta={{ source: "mock" }}
      syncStatus={{ full: null, weekly: null, daily: null }}
      syncEnabled={SYNC_ENABLED}
      trafficApiConfigured={trafficApiConfigured}
      windowDays={windowDays}
    />
  );
}
