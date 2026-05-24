import { getMockPages, getMockStats } from "./_components/_mock";
import { IndexingWrapper } from "./_components/IndexingWrapper";

// 一期：mock 数据，等真实 GSC 接入后改为
//   const [pages, stats] = await Promise.all([getPages(), getIndexingStats()]);
export default function IndexingPage() {
  const pages = getMockPages();
  const stats = getMockStats();
  return <IndexingWrapper initialData={pages} stats={stats} />;
}
