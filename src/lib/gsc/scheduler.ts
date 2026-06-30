// 应用内置「双定时调度器」—— 收录 + 流量更新，两个 tick 串行，60s 心跳。
//
// 由 src/instrumentation.ts 在 Node 服务启动时调用 startScheduler() 一次。
//
// 触发口径（2026-06-30 改）：从「相对间隔（过 N 分钟就跑）」改为「固定洛杉矶墙钟点」——
//   · 流量更新：每天 America/Los_Angeles 18:00 触发一次。
//   · 收录检查：每天 America/Los_Angeles 06:00 触发一次（与流量错开 12h，不同时打 GSC API）。
//   为什么选 LA 时区的 18:00：GSC 的数据日界按太平洋时间走，LA 18:00 时「前一两天」的数据
//   已基本定稿，避开 GSC 最近 1-2 天 fresh 数据反复波动的时段，拉到的更稳、更全。
//
//   到点判断 isDueAtLaHour：「最近一个已发生的 LA HH:00」之后、且上次运行在该点之前
//   （= 今天这个点还没跑过）→ 跑。天然满足：
//     ① 准点触发：到了 LA HH:00 后的第一个 60s 心跳就跑；
//     ② 关机/断网补跑：服务恢复时若已过当天触发点且当天没跑过，立刻补跑缺的那次；
//     ③ 一天至多一次：跑完 lastRunAt 落在触发点之后，当天不再重复；
//     ④ 抑制乱跑：比旧的「过 24h 就跑」对机器时钟漂移更鲁棒（当天已跑过就不会再跑）。
//   每轮流量更新仍重拉最近 90 天 page×date 覆盖落库 —— 这是「数据不缺」的根基，没动它。
//
//   注意：app_*_scheduler_config.interval_minutes 字段保留（向后兼容 / UI），但调度逻辑
//   不再读它；执行节律完全由下面的 LA 钟点常量决定。enabled 开关仍生效。
//
//   apiOnly:true —— 服务端无浏览器，强制走官方 API 法。

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

const TICK_MS = 60_000; // 60s 心跳（仅控制检查频率，不等于执行节律）

// 每天的固定触发墙钟点（America/Los_Angeles 当地时间，24h 制）。改这两个常量即可调整时刻。
const LA_TZ = "America/Los_Angeles";
const TRAFFIC_LA_HOUR = 18;    // 流量更新：LA 18:00
const INSPECTION_LA_HOUR = 6;  // 收录检查：LA 06:00（与流量错开 12h）

// 防重入：各自独立，上一轮未完成则跳过后续触发（全量收录可能数分钟，远超心跳周期）。
let inspectionRunning = false;
let trafficRunning = false;

// ─── 时区/到点工具 ───────────────────────────────────────────────────────────

// 某瞬时 d 在 LA 时区的「墙上时间」各字段（h23 制，正确含夏令时）。
function laParts(d: Date): { y: number; mo: number; dd: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: g("year"), mo: g("month"), dd: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}

// LA 墙上时间 (y,mo,dd,hour:00:00) → 对应 UTC 毫秒。猜测+校正法，正确处理 DST（PST/PDT 切换）。
function laWallToUtcMs(y: number, mo: number, dd: number, hour: number): number {
  let guess = Date.UTC(y, mo - 1, dd, hour, 0, 0);
  // 迭代收敛：把 guess 在 LA 显示的墙上时间与目标墙上时间对齐（最多 3 次足够覆盖 DST 跳变）。
  for (let i = 0; i < 3; i++) {
    const p = laParts(new Date(guess));
    const shownAsUtc = Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s);
    const targetAsUtc = Date.UTC(y, mo - 1, dd, hour, 0, 0);
    const diff = targetAsUtc - shownAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// 「最近一个已经发生的 LA hour:00」对应的 UTC 毫秒。
function mostRecentLaHourMs(now: Date, hour: number): number {
  const p = laParts(now);
  const todayMs = laWallToUtcMs(p.y, p.mo, p.dd, hour);
  if (now.getTime() >= todayMs) return todayMs; // 今天这个点已过 → 就是它
  // 今天的点还没到 → 取「昨天 LA 日期」的该点
  const y = laParts(new Date(now.getTime() - 86_400_000));
  return laWallToUtcMs(y.y, y.mo, y.dd, hour);
}

/**
 * 到点判断：最近的 LA hour:00 已过，且上次运行在该点之前（今天还没跑过）→ 该跑。
 * lastRunAt 为空（从未跑过）→ 立即补跑。
 */
function isDueAtLaHour(lastRunAt: Date | null | undefined, hour: number): boolean {
  const triggerMs = mostRecentLaHourMs(new Date(), hour);
  if (!lastRunAt) return true;
  return new Date(lastRunAt).getTime() < triggerMs;
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

  // 2) 守卫：未启用 / 未到点（LA 06:00）/ API 未配。
  if (!cfg.enabled) return;
  if (!isDueAtLaHour(cfg.lastRunAt, INSPECTION_LA_HOUR)) return;
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

  // 2) 守卫：未启用 / 未到点（LA 18:00）/ API 未配。
  if (!cfg.enabled) return;
  if (!isDueAtLaHour(cfg.lastRunAt, TRAFFIC_LA_HOUR)) return;
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
  void tickAll(); // 启动即检查一次：若已过当天 LA 触发点且当天没跑过 → 立即补跑（关机/断网恢复的关键）
  setInterval(() => void tickAll(), TICK_MS);
}
