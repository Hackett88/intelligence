// GSC snapshot 文件持久化层。
//
// 当前一期：用本地文件 data/gsc-snapshot.json 存最新一次抓取结果，简单稳。
// 真要做时间序列 / 多 property，后续再升级到 Postgres（Drizzle 表）。

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PageRow, IndexingStats } from "@/app/app/indexing/_components/_mock";

export type IndexingSnapshotFile = {
  version: 1;
  fetchedAt: string;
  propertyResourceId: string;
  freshnessText?: string;
  stats: IndexingStats;
  pages: PageRow[];
};

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "gsc-snapshot.json");

export function getSnapshotPath(): string {
  return SNAPSHOT_PATH;
}

export async function loadSnapshot(): Promise<IndexingSnapshotFile | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const parsed = JSON.parse(raw) as IndexingSnapshotFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.pages)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // 损坏的快照不应让页面崩 — 视作"没快照"，fallback 到 mock
    console.error("[gsc/store] loadSnapshot failed:", err);
    return null;
  }
}

export async function saveSnapshot(file: IndexingSnapshotFile): Promise<void> {
  const dir = path.dirname(SNAPSHOT_PATH);
  await fs.mkdir(dir, { recursive: true });
  // 原子写入：先写到临时文件再 rename，避免并发读到半个文件
  const tmp = SNAPSHOT_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await fs.rename(tmp, SNAPSHOT_PATH);
}
