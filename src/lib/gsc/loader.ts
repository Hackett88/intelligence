// GSC snapshot 加载器 —— 是 UI 与"存储介质"之间的唯一桥。
//
// 职责：
//   1) 优先从 PG 读最新成功 batch（repository.loadLatestBatch）
//   2) PG 没数据或读失败 → 降级读 data/gsc-snapshot.json 文件
//   3) 拿到 raw 真实页后，在内存里重建合成目录节点 + parentId 链
//   4) 返回 IndexingClient 期望的 { pages: PageRow[], stats, meta }
//
// 合成节点不入库（决策已定）：parentId 链每次加载时重新生成。
// id 用 sortOrder 派生（pg_NNNN）保证稳定 —— 真实页用 1..N，合成节点用 N+1..N+M。

import type { PageRow, IndexingStats, IndexState } from "@/app/app/indexing/_components/_mock";
import {
  inferMarket,
  inferPageType,
  inferCluster,
  inferIsPillar,
  isLocaleRoot,
  synthesizeDirNodes,
  buildParentMap,
} from "./transform";
import { loadLatestBatch, type RealPageRecord, type LoadedBatch } from "./repository";
import { loadSnapshot, type IndexingSnapshotFile } from "./store";

export type SnapshotSource = "pg" | "json" | "none";

export interface LoadedSnapshot {
  pages: PageRow[];
  stats: IndexingStats;
  source: SnapshotSource;
  fetchedAt?: string;
  property?: string;
  freshnessText?: string;
}

function emptyTrend(): number[] {
  return new Array(12).fill(0);
}

/**
 * 把"真实页"raw records → 完整 PageRow[]（含合成目录节点 + parentId 链）。
 * sortOrder：真实页保持原顺序（clicks DESC），合成节点按字典序追加。
 */
export function rebuildPagesFromReal(
  realPages: RealPageRecord[],
  lastSyncISO: string
): PageRow[] {
  // 真实 path 集合
  const realPaths = realPages.map((p) => p.url);

  // 合成虚拟目录节点
  const synthPaths = synthesizeDirNodes(realPaths).sort();

  // 统一 id：真实页用 sortOrder + 1（已按 clicks DESC 排过），合成节点接在后面
  const idByPath = new Map<string, string>();
  realPages.forEach((p) => {
    idByPath.set(p.url, `pg_${String(p.sortOrder + 1).padStart(4, "0")}`);
  });
  const realCount = realPages.length;
  synthPaths.forEach((path, i) => {
    idByPath.set(path, `pg_${String(realCount + 1 + i).padStart(4, "0")}`);
  });

  // parent 链（含合成节点）
  const allPaths = [...realPaths, ...synthPaths];
  const parentByPath = buildParentMap(allPaths);

  const out: PageRow[] = [];

  // 真实页 — 字段直接从 PG 行取
  for (const p of realPages) {
    const parentPath = parentByPath.get(p.url);
    out.push({
      id: idByPath.get(p.url)!,
      url: p.url,
      fullUrl: p.fullUrl,
      market: p.market,
      pageType: p.pageType,
      cluster: p.cluster,
      topQuery: p.topQuery,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: p.ctr,
      position: p.position,
      indexState: p.indexState as IndexState,
      trend12m: p.trend12m && p.trend12m.length > 0 ? p.trend12m : emptyTrend(),
      queries: p.queries ?? [],
      lastSync: lastSyncISO,
      parentId: parentPath ? idByPath.get(parentPath) : undefined,
      isPillar: p.isPillar || undefined,
      sortOrder: p.sortOrder,
    });
  }

  // 合成节点 — clicks / impressions / ctr / position 都是 0
  const origin = realPages[0]?.fullUrl ? safeOrigin(realPages[0].fullUrl) : "";
  synthPaths.forEach((path, i) => {
    const parentPath = parentByPath.get(path);
    out.push({
      id: idByPath.get(path)!,
      url: path,
      fullUrl: origin + path,
      market: inferMarket(path),
      pageType: inferPageType(path),
      cluster: inferCluster(path),
      topQuery: "—",
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      indexState: "indexed",
      trend12m: emptyTrend(),
      lastSync: lastSyncISO,
      parentId: parentPath ? idByPath.get(parentPath) : undefined,
      isPillar: inferIsPillar(path) || undefined,
      sortOrder: realCount + i,
      isSynthetic: true,
    });
  });

  return out;
}

function safeOrigin(fullUrl: string): string {
  try {
    return new URL(fullUrl).origin;
  } catch {
    return "";
  }
}

/** 从 PG 加载最新 batch */
async function loadFromPg(): Promise<LoadedSnapshot | null> {
  let batch: LoadedBatch | null;
  try {
    batch = await loadLatestBatch();
  } catch (e) {
    // PG 不可用 → 降级
    console.warn("[gsc/loader] PG load failed, will try JSON:", (e as Error).message);
    return null;
  }
  if (!batch) return null;

  const lastSyncISO = (batch.log.completedAt ?? batch.log.startedAt).toISOString();
  const pages = rebuildPagesFromReal(batch.pages, lastSyncISO);

  const realOnly = pages.filter((p) => !p.isSynthetic);
  const top10 = realOnly.filter((p) => p.position > 0 && p.position <= 10).length;

  const stats: IndexingStats = {
    totalPages: batch.log.totalPages ?? realOnly.length,
    totalClicks: batch.log.totalClicks ?? realOnly.reduce((s, p) => s + p.clicks, 0),
    totalImpressions:
      batch.log.totalImpressions ??
      realOnly.reduce((s, p) => s + p.impressions, 0),
    avgCtr:
      batch.log.avgCtr ??
      (realOnly.length ? realOnly.reduce((s, p) => s + p.ctr, 0) / realOnly.length : 0),
    avgPosition:
      batch.log.avgPosition ??
      (realOnly.length
        ? parseFloat((realOnly.reduce((s, p) => s + p.position, 0) / realOnly.length).toFixed(1))
        : 0),
    top10Pages: batch.log.top10Pages ?? top10,
    lastSync: lastSyncISO,
  };

  return {
    pages,
    stats,
    source: "pg",
    fetchedAt: lastSyncISO,
    property: batch.log.property ?? undefined,
    freshnessText: batch.log.freshnessText ?? undefined,
  };
}

/** 从 data/gsc-snapshot.json 加载（兜底） */
async function loadFromJson(): Promise<LoadedSnapshot | null> {
  let snap: IndexingSnapshotFile | null;
  try {
    snap = await loadSnapshot();
  } catch (e) {
    console.warn("[gsc/loader] JSON load failed:", (e as Error).message);
    return null;
  }
  if (!snap) return null;

  // JSON 文件已经包含完整 PageRow[]（含合成节点），直接用即可
  return {
    pages: snap.pages,
    stats: snap.stats,
    source: "json",
    fetchedAt: snap.fetchedAt,
    property: snap.propertyResourceId,
    freshnessText: snap.freshnessText,
  };
}

/** 入口：先 PG，再 JSON 兜底。两条都没数据返回 null。 */
export async function loadLatestSnapshot(): Promise<LoadedSnapshot | null> {
  const fromPg = await loadFromPg();
  if (fromPg) return fromPg;
  return await loadFromJson();
}
