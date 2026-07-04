// 页面类型"人工修正"持久化层 —— PG 优先，JSON 兜底。
//
// 迁移历史: JSON-only (v1) → PG-first + JSON-fallback (2026-07-04)
// 对外函数签名/返回结构与原版完全一致，callers（page-type 路由 / loader / coverage-loader）无需改动。
//
// 为什么单独存：pageType 是 inferPageType(URL) 自动推断后落库的，每次 GSC 同步都会
// 重新推断并写新 batch —— 若直接改 gsc_pages 行，下次同步必被覆盖。这里把"人工修正"
// 按 url_norm（跨批次稳定）单独存，同步流程不碰它；由 loader / coverage-loader 在重建
// 页面后套用覆盖，从而让修正长期生效。
//
// 为什么迁 PG：生产容器文件系统随每次部署重置，JSON 里线上做的修正撑不过下一次发版。
// PG 为唯一权威源（跨部署持久），JSON 降级为镜像兜底（与 index-status-store 同款方案）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { gscPageTypeOverrides } from "@/db/schema";
import { normalizeForMatch } from "./url-normalize";

// fullUrl -> 修正后的 pageType
export type PageTypeOverrides = Record<string, string>;

const OVERRIDES_PATH = path.join(process.cwd(), "data", "page-type-overrides.json");

// ── JSON 读写（降级兜底）────────────────────────────────────────────────────────

async function _loadJson(): Promise<PageTypeOverrides> {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PageTypeOverrides;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    // 损坏文件不应让页面崩 —— 视作"无覆盖"
    console.error("[gsc/overrides] _loadJson failed:", err);
    return {};
  }
}

async function _mirrorJson(overrides: PageTypeOverrides): Promise<void> {
  try {
    const dir = path.dirname(OVERRIDES_PATH);
    await fs.mkdir(dir, { recursive: true });
    // 原子写入：先写临时文件再 rename，避免并发读到半个文件
    const tmp = OVERRIDES_PATH + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(overrides, null, 2), "utf-8");
    await fs.rename(tmp, OVERRIDES_PATH);
  } catch (err) {
    console.warn("[gsc/overrides] _mirrorJson failed (non-fatal):", err);
  }
}

// ── PG 读 ──────────────────────────────────────────────────────────────────────

async function _loadPg(): Promise<PageTypeOverrides> {
  const rows = await db.select().from(gscPageTypeOverrides);
  const out: PageTypeOverrides = {};
  for (const row of rows) {
    out[row.fullUrl] = row.pageType;
  }
  return out;
}

// ── 对外接口（签名/返回结构与原版完全一致）───────────────────────────────────────

export async function loadPageTypeOverrides(): Promise<PageTypeOverrides> {
  try {
    return await _loadPg();
  } catch (err) {
    console.warn(
      "[gsc/overrides] PG load failed, falling back to JSON:",
      (err as Error).message
    );
    return _loadJson();
  }
}

/**
 * upsert 单条修正（PG UPSERT on url_norm）+ 镜像写 JSON（兜底数据保鲜）。
 * pageType 传空串则删除该 url 的修正（恢复自动推断）。
 * PG 写失败 → 抛错（路由转 500 提示用户），绝不"JSON 写成功但 PG 没写"造成假象。
 */
export async function savePageTypeOverride(fullUrl: string, pageType: string): Promise<void> {
  const urlNorm = normalizeForMatch(fullUrl);
  const now = new Date();

  // 1) PG 主路径（权威源，失败直接抛给路由）
  if (pageType) {
    await db
      .insert(gscPageTypeOverrides)
      .values({ urlNorm, fullUrl, pageType, updatedAt: now })
      .onConflictDoUpdate({
        target: gscPageTypeOverrides.urlNorm,
        set: { fullUrl, pageType, updatedAt: now },
      });
  } else {
    await db.delete(gscPageTypeOverrides).where(eq(gscPageTypeOverrides.urlNorm, urlNorm));
  }

  // 2) 镜像写 JSON（best-effort：读回 PG 全量，失败只 warn 不抛）
  try {
    await _mirrorJson(await _loadPg());
  } catch (err) {
    console.warn("[gsc/overrides] mirror after save failed (non-fatal):", err);
  }
}

/**
 * 批量修正：一条多行 UPSERT（或一条 inArray DELETE）+ 镜像写 JSON 一次。
 * pageType 传空串 = 批量清除这些 url 的修正（恢复自动推断）。
 * 语义与单条 savePageTypeOverride 一致；PG 写失败直接抛（路由转 500）。
 * 先按 url_norm 去重 —— 不同 fullUrl 可能塌缩到同一 norm（www/协议/尾斜杠变体），
 * 同一条 INSERT 内重复主键会撞 ON CONFLICT（"cannot affect row a second time"）。
 * 返回去重后的实际写入/删除条数。
 */
export async function savePageTypeOverridesBatch(
  fullUrls: string[],
  pageType: string
): Promise<number> {
  const now = new Date();
  const byNorm = new Map<string, string>(); // urlNorm -> fullUrl（同 norm 取首个）
  for (const u of fullUrls) {
    const s = u.trim();
    if (!s) continue;
    const n = normalizeForMatch(s);
    if (!byNorm.has(n)) byNorm.set(n, s);
  }
  if (byNorm.size === 0) return 0;

  if (pageType) {
    await db
      .insert(gscPageTypeOverrides)
      .values(
        [...byNorm.entries()].map(([urlNorm, fullUrl]) => ({
          urlNorm,
          fullUrl,
          pageType,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: gscPageTypeOverrides.urlNorm,
        set: {
          fullUrl: sql`excluded.full_url`,
          pageType: sql`excluded.page_type`,
          updatedAt: now,
        },
      });
  } else {
    await db
      .delete(gscPageTypeOverrides)
      .where(inArray(gscPageTypeOverrides.urlNorm, [...byNorm.keys()]));
  }

  try {
    await _mirrorJson(await _loadPg());
  } catch (err) {
    console.warn("[gsc/overrides] mirror after batch save failed (non-fatal):", err);
  }
  return byNorm.size;
}
