import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper, type SyncModeStatus } from "./_components/IndexingWrapper";
import { loadLatestSnapshot } from "@/lib/gsc/loader";
import { loadLastSyncByMode } from "@/lib/gsc/repository";

// GSC 抓取依赖本地浏览器（CDP 127.0.0.1:9222），只有本地开发环境能跑；
// 生产部署没有本地 Chrome，前端据此禁用"更新"并提示联系管理员。
const SYNC_ENABLED = process.env.NODE_ENV !== "production";

async function safeLastSyncByMode(): Promise<SyncModeStatus> {
  try {
    return await loadLastSyncByMode();
  } catch {
    return { full: null, weekly: null, daily: null };
  }
}

// loader 优先 PG，没数据/失败再降级 JSON；两条都没数据 → mock（一期定稿前的 UI 样本）
export default async function IndexingPage() {
  const snapshot = await loadLatestSnapshot();
  if (snapshot) {
    const syncStatus = await safeLastSyncByMode();
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
