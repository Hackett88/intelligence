import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper } from "./_components/IndexingWrapper";
import { loadLatestSnapshot, loadLastSyncByModeCached } from "@/lib/gsc/loader";

// GSC 抓取依赖本地浏览器（CDP 127.0.0.1:9222），只有本地开发环境能跑；
// 生产部署没有本地 Chrome，前端据此禁用"更新"并提示联系管理员。
const SYNC_ENABLED = process.env.NODE_ENV !== "production";

// loader 优先 PG，没数据/失败再降级 JSON；两条都没数据 → mock（一期定稿前的 UI 样本）
export default async function IndexingPage() {
  // 两者互不依赖且都带缓存 —— 并行加载；命中缓存时几乎零开销，不再每次打库。
  const [snapshot, syncStatus] = await Promise.all([
    loadLatestSnapshot(),
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
