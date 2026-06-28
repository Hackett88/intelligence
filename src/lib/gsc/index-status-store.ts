// GSC 收录状态持久化层 —— PG 优先，JSON 兜底
//
// 迁移历史: JSON-only (v1) → PG-first + JSON-fallback (2026-06-28)
// 对外函数签名/返回结构与原版完全一致，callers（route.ts / recheck 脚本）无需改动。
//
// 与 gsc-snapshot.json（性能数据）独立：收录状态来自 URL Inspection API，
// 更新频率和数据源完全不同。按 normalizeForMatch(url) 做 key，合并写入。

import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/db/client";
import { gscIndexStatus } from "@/db/schema";
import { normalizeForMatch } from "./url-normalize";

export interface IndexStatusEntry {
  url: string;
  indexed: boolean | null;    // true=已收录, false=未收录, null=未检查/失败
  coverageText: string;
  pageIndexingText?: string;  // 可选，来自 URL Inspection API（page_indexing_text 列）
  lastCrawled: string | null;
  checkedAt: string;
}

export interface IndexStatusFile {
  version: 1;
  updatedAt: string;
  byUrl: Record<string, IndexStatusEntry>;
}

const STATUS_PATH = path.join(process.cwd(), "data", "gsc-index-status.json");

// ── JSON 读写（降级兜底）────────────────────────────────────────────────────────

async function _loadJson(): Promise<IndexStatusFile> {
  try {
    const raw = await fs.readFile(STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as IndexStatusFile;
    if (parsed?.version === 1 && parsed.byUrl) return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[gsc/index-status-store] _loadJson failed:", err);
    }
  }
  return { version: 1, updatedAt: "", byUrl: {} };
}

async function _mirrorJson(data: IndexStatusFile): Promise<void> {
  try {
    const dir = path.dirname(STATUS_PATH);
    await fs.mkdir(dir, { recursive: true });
    const tmp = STATUS_PATH + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, STATUS_PATH);
  } catch (err) {
    console.warn("[gsc/index-status-store] _mirrorJson failed (non-fatal):", err);
  }
}

// ── PG 读写 ────────────────────────────────────────────────────────────────────

async function _loadPg(): Promise<IndexStatusFile> {
  const rows = await db.select().from(gscIndexStatus);
  const byUrl: Record<string, IndexStatusEntry> = {};
  let maxUpdatedAt = "";

  for (const row of rows) {
    const updatedAtStr = row.updatedAt.toISOString();
    if (updatedAtStr > maxUpdatedAt) maxUpdatedAt = updatedAtStr;

    const entry: IndexStatusEntry = {
      url:          row.fullUrl,
      indexed:      row.indexed ?? null,
      coverageText: row.coverageText ?? "",
      lastCrawled:  row.lastCrawled ?? null,
      checkedAt:    row.checkedAt?.toISOString() ?? updatedAtStr,
    };
    if (row.pageIndexingText != null) {
      entry.pageIndexingText = row.pageIndexingText;
    }
    byUrl[row.urlNorm] = entry;
  }

  return { version: 1, updatedAt: maxUpdatedAt, byUrl };
}

// ── 对外接口（签名/返回结构与原版完全一致）───────────────────────────────────────

export async function loadIndexStatus(): Promise<IndexStatusFile> {
  try {
    return await _loadPg();
  } catch (err) {
    console.warn(
      "[gsc/index-status-store] PG load failed, falling back to JSON:",
      (err as Error).message
    );
    return _loadJson();
  }
}

/**
 * 按 normalizeForMatch(url) 合并写入新结果，刷新 updatedAt。
 * PG 优先（UPSERT on conflict url_norm DO UPDATE）+ 镜像写 JSON（兜底数据保鲜）。
 * 合并语义与原版一致：只覆盖传入 URL 的字段，其余行不受影响。
 * pageIndexingText 不在本函数参数中，UPSERT 时不更新该列（保留已有值）。
 */
export async function saveMergeIndexStatus(
  results: { url: string; indexed: boolean | null; coverageText: string; lastCrawled: string | null }[]
): Promise<IndexStatusFile> {
  const now = new Date();
  const nowIso = now.toISOString();
  let pgSuccess = false;

  // ── 1. PG UPSERT（主路径）────────────────────────────────────────────────────
  try {
    for (const r of results) {
      const key = normalizeForMatch(r.url);
      await db
        .insert(gscIndexStatus)
        .values({
          urlNorm:      key,
          fullUrl:      r.url,
          indexed:      r.indexed,
          coverageText: r.coverageText,
          lastCrawled:  r.lastCrawled,
          checkedAt:    now,
          updatedAt:    now,
        })
        .onConflictDoUpdate({
          target: gscIndexStatus.urlNorm,
          set: {
            fullUrl:      r.url,
            indexed:      r.indexed,
            coverageText: r.coverageText,
            lastCrawled:  r.lastCrawled,
            checkedAt:    now,
            updatedAt:    now,
            // pageIndexingText 不在此参数中，不覆盖（保留已有值）
          },
        });
    }
    pgSuccess = true;
  } catch (err) {
    console.warn(
      "[gsc/index-status-store] PG UPSERT failed, fallback to JSON only:",
      (err as Error).message
    );
  }

  // ── 2. 读回完整当前状态 ────────────────────────────────────────────────────────
  let latest: IndexStatusFile;

  if (pgSuccess) {
    try {
      latest = await _loadPg();
    } catch {
      // PG 读回失败 → 从 JSON 手工合并
      latest = await _loadJson();
      for (const r of results) {
        latest.byUrl[normalizeForMatch(r.url)] = {
          url: r.url, indexed: r.indexed,
          coverageText: r.coverageText, lastCrawled: r.lastCrawled, checkedAt: nowIso,
        };
      }
      latest.updatedAt = nowIso;
    }
  } else {
    // PG 写入失败 → 纯 JSON 合并（原版行为）
    latest = await _loadJson();
    for (const r of results) {
      latest.byUrl[normalizeForMatch(r.url)] = {
        url: r.url, indexed: r.indexed,
        coverageText: r.coverageText, lastCrawled: r.lastCrawled, checkedAt: nowIso,
      };
    }
    latest.updatedAt = nowIso;
  }

  // ── 3. 镜像写 JSON（兜底数据保鲜，失败只 warn 不抛）────────────────────────────
  await _mirrorJson(latest);

  return latest;
}
