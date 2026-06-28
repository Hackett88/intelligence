// GSC 收录状态持久化层 —— data/gsc-index-status.json
//
// 与 gsc-snapshot.json（性能数据）独立：收录状态来自 URL Inspection API，
// 更新频率和数据源完全不同。按 normalizeForMatch(url) 做 key，合并写入。

import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeForMatch } from "./url-normalize";

export interface IndexStatusEntry {
  url: string;
  indexed: boolean | null;   // true=已收录, false=未收录, null=未检查/失败
  coverageText: string;
  lastCrawled: string | null;
  checkedAt: string;
}

export interface IndexStatusFile {
  version: 1;
  updatedAt: string;
  byUrl: Record<string, IndexStatusEntry>;
}

const STATUS_PATH = path.join(process.cwd(), "data", "gsc-index-status.json");

export async function loadIndexStatus(): Promise<IndexStatusFile> {
  try {
    const raw = await fs.readFile(STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as IndexStatusFile;
    if (parsed?.version === 1 && parsed.byUrl) return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[gsc/index-status-store] loadIndexStatus failed:", err);
    }
  }
  // 文件不存在或损坏 → 返回空
  return { version: 1, updatedAt: "", byUrl: {} };
}

/**
 * 按 normalizeForMatch(url) 合并写入新结果，刷新 updatedAt。
 * 已有记录被覆盖（最新一次检查结果优先）。
 */
export async function saveMergeIndexStatus(
  results: { url: string; indexed: boolean | null; coverageText: string; lastCrawled: string | null }[]
): Promise<IndexStatusFile> {
  const existing = await loadIndexStatus();
  const now = new Date().toISOString();

  for (const r of results) {
    const key = normalizeForMatch(r.url);
    existing.byUrl[key] = {
      url: r.url,
      indexed: r.indexed,
      coverageText: r.coverageText,
      lastCrawled: r.lastCrawled,
      checkedAt: now,
    };
  }
  existing.updatedAt = now;

  const dir = path.dirname(STATUS_PATH);
  await fs.mkdir(dir, { recursive: true });
  const tmp = STATUS_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(existing, null, 2), "utf-8");
  await fs.rename(tmp, STATUS_PATH);

  return existing;
}
