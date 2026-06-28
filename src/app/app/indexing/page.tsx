import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper } from "./_components/IndexingWrapper";
import { loadCoveragePages } from "@/lib/gsc/coverage-loader";
import { loadLastSyncByModeCached } from "@/lib/gsc/loader";

// GSC 抓取依赖本地浏览器（CDP 127.0.0.1:9222），只有本地开发环境能跑；
// 生产部署没有本地 Chrome，前端据此禁用"更新"并提示联系管理员。
const SYNC_ENABLED = process.env.NODE_ENV !== "production";

export default async function IndexingPage() {
  const [snapshot, syncStatus] = await Promise.all([
    loadCoveragePages(),
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
    />
  );
}
