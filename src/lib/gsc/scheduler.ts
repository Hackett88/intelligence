// 应用内置「收录定时检查」调度器（不依赖 n8n，跟应用同生命周期）。
//
// 由 src/instrumentation.ts 在 Node 服务启动时调用 startScheduler() 一次。
// 设计：60s 固定心跳（tick），是否到点跑由配置表的 interval_minutes 决定 —— 二者解耦。
//   · tick 只是廉价心跳：读配置 → 判断 enabled / 到点 / API 已配 → 满足才真正跑一轮收录。
//   · 真正跑收录走 runInspectionCore({ apiOnly: true })：服务端无浏览器，强制官方 API 法，
//     绝不触发会话法/puppeteer。
//
// 配置表 app_scheduler_config 单行（id=1），由 /api/indexing/scheduler-config 读写。

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSchedulerConfig, type AppSchedulerConfig } from "@/db/schema";
import { isGscApiConfigured } from "@/lib/gsc/index-inspection-api-fetcher";
import { runInspectionCore } from "@/lib/gsc/run-inspection";

const TICK_MS = 60_000; // 60s 心跳

// 防重入：上一轮收录还没跑完（全量可能数分钟，远超 60s 心跳）就跳过后续 tick 的执行段。
let running = false;

// 一次心跳。独立成函数便于 setInterval 里 `void tick()`（回调返回 void，规避 no-misused-promises）。
async function tick(): Promise<void> {
  // 1) 读配置：隧道断 / PG 不可达等 → try/catch 吞掉 + warn，跳过本 tick（不让 timer 崩）。
  let cfg: AppSchedulerConfig | undefined;
  try {
    const rows = await db
      .select()
      .from(appSchedulerConfig)
      .where(eq(appSchedulerConfig.id, 1));
    cfg = rows[0];
  } catch (err) {
    console.warn("[scheduler] 读配置失败，跳过本次 tick:", (err as Error).message);
    return;
  }
  if (!cfg) return;

  // 2) 未启用 → 不跑。
  if (!cfg.enabled) return;

  // 3) 到点判断：tick 是 60s 心跳，真正多久跑一次由 interval_minutes 决定（二者解耦）。
  const due =
    !cfg.lastRunAt ||
    Date.now() - new Date(cfg.lastRunAt).getTime() >= cfg.intervalMinutes * 60_000;
  if (!due) return;

  // 4) 未配官方 API → 不空跑（定时器在服务端无浏览器，只能走 API 法；没 key 跑不动）。
  if (!isGscApiConfigured()) {
    console.warn("[scheduler] GSC API 未配置，跳过本次定时收录");
    return;
  }

  // 5) 防重入 + 真正执行。
  if (running) return;
  running = true;
  try {
    // mode 列是 text，DB 理论上可存任意值 → 收窄到联合类型（非 "all" 一律按 incremental，
    // 与核心内 effectiveMode 语义一致）。
    const mode: "incremental" | "all" = cfg.mode === "all" ? "all" : "incremental";
    const summary = await runInspectionCore({ mode, apiOnly: true });

    await db
      .update(appSchedulerConfig)
      .set({
        lastRunAt: new Date(),
        lastRunSummary: summary,
        updatedAt: new Date(),
      })
      .where(eq(appSchedulerConfig.id, 1));

    // 6) 适度日志。
    console.log("[scheduler] 定时收录完成", {
      inspected: summary.inspected,
      indexed: summary.indexed,
      notIndexed: summary.notIndexed,
    });
  } catch (err) {
    console.error(
      "[scheduler] 定时收录失败:",
      err instanceof Error ? err.stack || err.message : err
    );
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  setInterval(() => {
    void tick();
  }, TICK_MS);
}
