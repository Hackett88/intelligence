// 应用内置「双定时调度器」—— 收录 + 流量更新，两个 tick 串行，60s 心跳。
//
// 由 src/instrumentation.ts 在 Node 服务启动时调用 startScheduler() 一次。
// 设计：60s 固定心跳（tickAll），每跳依次跑 inspectionTick → trafficTick，各自独立。
//   · 到点判断：Math.min(intervalMinutes, MAX_STALENESS_MIN) 同时实现「按配置间隔」
//     与「最多 24h 必更」兜底 —— 间隔配再大也被 1440 压住。
//   · 两个 tick 各自防重入、独立读写配置表，互不干扰。
//   · apiOnly:true —— 服务端无浏览器，强制走官方 API 法。

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appSchedulerConfig,
  appTrafficSchedulerConfig,
  type AppSchedulerConfig,
  type AppTrafficSchedulerConfig,
} from "@/db/schema";
import { isGscApiConfigured } from "@/lib/gsc/index-inspection-api-fetcher";
import { runInspectionCore } from "@/lib/gsc/run-inspection";
import { runTrafficUpdateCore } from "@/lib/gsc/run-traffic-update";

const TICK_MS = 60_000;          // 60s 心跳（仅控制检查频率，不等于执行间隔）
const MAX_STALENESS_MIN = 1440;  // 24h 兜底上限：数据超 24h 未更新则强制补更

// 防重入：各自独立，上一轮未完成则跳过后续触发（全量收录可能数分钟，远超心跳周期）。
let inspectionRunning = false;
let trafficRunning = false;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 到点判断（两个 tick 共用口径）。
 * 实现「按配置间隔」同时「最多 24h 必更」：间隔设再大也被 MAX_STALENESS_MIN 压住。
 */
function isDue(lastRunAt: Date | null | undefined, intervalMinutes: number): boolean {
  if (!lastRunAt) return true; // 从未跑过 → 立刻跑
  const effectiveMs = Math.min(intervalMinutes, MAX_STALENESS_MIN) * 60_000;
  return Date.now() - new Date(lastRunAt).getTime() >= effectiveMs;
}

// ─── 收录 Tick ───────────────────────────────────────────────────────────────

async function inspectionTick(): Promise<void> {
  // 1) 读配置：DB 不可达 → 吞掉 warn，不让 timer 崩。
  let cfg: AppSchedulerConfig | undefined;
  try {
    const rows = await db
      .select()
      .from(appSchedulerConfig)
      .where(eq(appSchedulerConfig.id, 1));
    cfg = rows[0];
  } catch (err) {
    console.warn("[scheduler] 收录 tick 读配置失败，跳过:", (err as Error).message);
    return;
  }
  if (!cfg) return;

  // 2) 守卫：未启用 / 未到点 / API 未配。
  if (!cfg.enabled) return;
  if (!isDue(cfg.lastRunAt, cfg.intervalMinutes)) return;
  if (!isGscApiConfigured()) {
    console.warn("[scheduler] GSC API 未配置，跳过本次定时收录");
    return;
  }

  // 3) 防重入 + 执行。
  if (inspectionRunning) return;
  inspectionRunning = true;
  try {
    // 定时收录【恒走按需】（没查过→立即；未收录→超 24h；已收录→超 7 天），绝不全量重查 ——
    // 这是用户「按需调用」的核心。cfg.mode 已废弃不读（前端定时面板也已移除"全部重查"开关）。
    const summary = await runInspectionCore({ mode: "on-demand", apiOnly: true });

    await db
      .update(appSchedulerConfig)
      .set({
        lastRunAt:      new Date(),
        lastRunSummary: summary,
        updatedAt:      new Date(),
      })
      .where(eq(appSchedulerConfig.id, 1));

    console.log("[scheduler] 定时收录完成", {
      inspected:  summary.inspected,
      indexed:    summary.indexed,
      notIndexed: summary.notIndexed,
    });
  } catch (err) {
    console.error(
      "[scheduler] 定时收录失败:",
      err instanceof Error ? err.stack ?? err.message : err
    );
  } finally {
    inspectionRunning = false;
  }
}

// ─── 流量更新 Tick ───────────────────────────────────────────────────────────

async function trafficTick(): Promise<void> {
  // 1) 读配置：DB 不可达 → 吞掉 warn，不让 timer 崩。
  let cfg: AppTrafficSchedulerConfig | undefined;
  try {
    const rows = await db
      .select()
      .from(appTrafficSchedulerConfig)
      .where(eq(appTrafficSchedulerConfig.id, 1));
    cfg = rows[0];
  } catch (err) {
    console.warn("[scheduler] 流量 tick 读配置失败，跳过:", (err as Error).message);
    return;
  }
  if (!cfg) return;

  // 2) 守卫：未启用 / 未到点 / API 未配。
  if (!cfg.enabled) return;
  if (!isDue(cfg.lastRunAt, cfg.intervalMinutes)) return;
  if (!isGscApiConfigured()) {
    console.warn("[scheduler] GSC API 未配置，跳过本次定时流量更新");
    return;
  }

  // 3) 防重入 + 执行。
  if (trafficRunning) return;
  trafficRunning = true;
  try {
    const summary = await runTrafficUpdateCore({ apiOnly: true });

    await db
      .update(appTrafficSchedulerConfig)
      .set({
        lastRunAt:      new Date(),
        lastRunSummary: summary,
        updatedAt:      new Date(),
      })
      .where(eq(appTrafficSchedulerConfig.id, 1));

    console.log("[scheduler] 定时流量更新完成", {
      pages:   summary.pages,
      clicks:  summary.totalClicks,
      retired: summary.retiredThisRun,
    });
  } catch (err) {
    console.error(
      "[scheduler] 定时流量更新失败:",
      err instanceof Error ? err.stack ?? err.message : err
    );
  } finally {
    trafficRunning = false;
  }
}

// ─── 总入口 ──────────────────────────────────────────────────────────────────

/**
 * 串行跑两个 tick（各自已 try/catch，这里再包一层防御，确保一个 tick 的未捕获异常
 * 不会导致另一个 tick 被跳过）。
 * 串行而非并发：避免两个 tick 同时向 GSC API 发请求。
 */
async function tickAll(): Promise<void> {
  try {
    await inspectionTick();
  } catch (err) {
    console.error("[scheduler] inspectionTick 未捕获异常:", err);
  }
  try {
    await trafficTick();
  } catch (err) {
    console.error("[scheduler] trafficTick 未捕获异常:", err);
  }
}

export function startScheduler(): void {
  void tickAll(); // 开机立即补更一次（24h 兜底的关键：不管上次何时跑，启动就查）
  setInterval(() => void tickAll(), TICK_MS);
}
