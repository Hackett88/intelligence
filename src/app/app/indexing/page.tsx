import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper } from "./_components/IndexingWrapper";
import { loadLatestSnapshot } from "@/lib/gsc/loader";

// loader 优先 PG，没数据/失败再降级 JSON；两条都没数据 → mock（一期定稿前的 UI 样本）
export default async function IndexingPage() {
  const snapshot = await loadLatestSnapshot();
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
      />
    );
  }
  return (
    <IndexingWrapper
      initialData={getMockPages()}
      stats={getMockStats()}
      lastSyncMeta={{ source: "mock" }}
    />
  );
}
