// 页面「内容优化」追踪持久化层 —— PG 优先，JSON 兜底（与 gsc_page_type_overrides 同款方案）。
//
// 曝光高点击低的页做内容优化后，抽屉「基本信息」卡点「标记优化」记一个版本
// （版本号 + 洛杉矶日历日 + 备注）。流量趋势按各版本起算日展示「优化后累计」与总计对比。
//
// 为什么按 url_norm 存：与页面类型修正、请求索引计数一致 —— url_norm 跨 GSC 同步批次稳定，
// www/协议/尾斜杠变体塌缩到同一逻辑页（同一页的优化历史本就该合并）。
// 为什么迁 PG：生产容器文件系统随部署重置，JSON 里的标记撑不过发版。PG 为唯一权威源，
// JSON 降级镜像兜底（与 overrides / index-status-store 同款）。
//
// events 单行存该 URL 全部版本历史（jsonb 数组 [{ v, at, note }]，v 从 1 递增、at 为洛杉矶日历日）。
// 追加/撤销走「读当前 → 计算 → upsert」；本工具单管理员低并发，不引入事务（与 overrides 同风格）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { gscPageOptimizations, type PageOptimizationEvent } from "@/db/schema";
import { normalizeForMatch } from "./url-normalize";
import { laDay } from "./api-usage-store";

export type { PageOptimizationEvent };
// fullUrl -> 版本历史（供 coverage-loader 按 url_norm 挂到每页）
export type PageOptimizations = Record<string, PageOptimizationEvent[]>;

const STORE_PATH = path.join(process.cwd(), "data", "page-optimizations.json");
const NOTE_MAX = 200; // 备注最长 200 字，超出截断

// ── JSON 读写（降级兜底）────────────────────────────────────────────────────────

async function _loadJson(): Promise<PageOptimizations> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PageOptimizations;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    // 损坏文件不应让页面崩 —— 视作"无优化记录"
    console.error("[gsc/optimizations] _loadJson failed:", err);
    return {};
  }
}

async function _mirrorJson(all: PageOptimizations): Promise<void> {
  try {
    const dir = path.dirname(STORE_PATH);
    await fs.mkdir(dir, { recursive: true });
    // 原子写入：先写临时文件再 rename，避免并发读到半个文件
    const tmp = STORE_PATH + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf-8");
    await fs.rename(tmp, STORE_PATH);
  } catch (err) {
    console.warn("[gsc/optimizations] _mirrorJson failed (non-fatal):", err);
  }
}

// ── PG 读 ──────────────────────────────────────────────────────────────────────

async function _loadPg(): Promise<PageOptimizations> {
  const rows = await db.select().from(gscPageOptimizations);
  const out: PageOptimizations = {};
  for (const row of rows) {
    out[row.fullUrl] = (row.events as PageOptimizationEvent[]) ?? [];
  }
  return out;
}

/** 读单行 events（按 urlNorm）。不存在返回 []。 */
async function _loadEvents(urlNorm: string): Promise<PageOptimizationEvent[]> {
  const rows = await db
    .select()
    .from(gscPageOptimizations)
    .where(eq(gscPageOptimizations.urlNorm, urlNorm))
    .limit(1);
  return (rows[0]?.events as PageOptimizationEvent[]) ?? [];
}

// ── 对外接口 ────────────────────────────────────────────────────────────────────

/** 全量读（PG 主，失败回退 JSON）—— coverage-loader 用它把版本历史按 url_norm 挂到每页。 */
export async function loadPageOptimizations(): Promise<PageOptimizations> {
  try {
    return await _loadPg();
  } catch (err) {
    console.warn(
      "[gsc/optimizations] PG load failed, falling back to JSON:",
      (err as Error).message
    );
    return _loadJson();
  }
}

/**
 * 追加一个优化版本（v = 现有版本数 + 1，at = 洛杉矶今天，note 去空白后截断 200 字）。
 * PG UPSERT on url_norm + 镜像写 JSON。PG 写失败抛给路由（转 500），绝不假成功。返回新的 events。
 */
export async function appendOptimization(
  fullUrl: string,
  note: string
): Promise<PageOptimizationEvent[]> {
  const urlNorm = normalizeForMatch(fullUrl);
  const now = new Date();
  const prev = await _loadEvents(urlNorm);
  const nextEvents: PageOptimizationEvent[] = [
    ...prev,
    { v: prev.length + 1, at: laDay(now), note: (note ?? "").trim().slice(0, NOTE_MAX) },
  ];

  await db
    .insert(gscPageOptimizations)
    .values({ urlNorm, fullUrl, events: nextEvents, updatedAt: now })
    .onConflictDoUpdate({
      target: gscPageOptimizations.urlNorm,
      set: { fullUrl, events: nextEvents, updatedAt: now },
    });

  try {
    await _mirrorJson(await _loadPg());
  } catch (err) {
    console.warn("[gsc/optimizations] mirror after append failed (non-fatal):", err);
  }
  return nextEvents;
}

/**
 * 撤销最新一次优化（弹出最后一个版本）。撤到空 → 删行。只动最新一次，不改历史版本。
 * 返回剩余 events。原本就没有记录 → 直接返回 []（幂等）。
 */
export async function undoLastOptimization(
  fullUrl: string
): Promise<PageOptimizationEvent[]> {
  const urlNorm = normalizeForMatch(fullUrl);
  const now = new Date();
  const prev = await _loadEvents(urlNorm);
  if (prev.length === 0) return [];

  const nextEvents = prev.slice(0, -1);
  if (nextEvents.length === 0) {
    await db.delete(gscPageOptimizations).where(eq(gscPageOptimizations.urlNorm, urlNorm));
  } else {
    await db
      .update(gscPageOptimizations)
      .set({ events: nextEvents, updatedAt: now })
      .where(eq(gscPageOptimizations.urlNorm, urlNorm));
  }

  try {
    await _mirrorJson(await _loadPg());
  } catch (err) {
    console.warn("[gsc/optimizations] mirror after undo failed (non-fatal):", err);
  }
  return nextEvents;
}
