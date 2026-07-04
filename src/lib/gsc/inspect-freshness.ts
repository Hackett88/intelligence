// 收录检查「新鲜度 / 退避 / 优先级」共享逻辑(2026-07-04)。
//
// 节律(Sean 拍板,参数可在用量面板调,存 app_scheduler_config.tuning):
//   · 从未查过 / 上次失败(indexed===null)      → 立即
//   · 未收录:连续第 1 次未收录 → 隔 1 天复查;第 2 次 → 隔 3 天;第 3 次起 → 每周
//   · 已收录 → 每周兜底复查
// 全部阈值留 4h 相位余量(定时器固定 LA 钟点触发,防"差一点不到期被顺延一天",
// 沿革见 run-inspection.ts 旧注释与 2026-07-02 修复)。
//
// 优先级(升序,配额 2000/天,越紧要越先查):
//   ① 从未查过(0) → ② 上次失败(1) → ③ 未收录到期(2) → ④ 已收录到期(3)
//   同级内按 check_count 升序(查得少的优先),再按 checkedAt 升序(最久没查的优先)。

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSchedulerConfig } from "@/db/schema";
import type { IndexStatusEntry } from "./index-status-store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PHASE_MARGIN_MS = 4 * HOUR; // 相位余量

export interface InspectTuning {
  notIndexed1Days: number; // 连续第 1 次未收录后,隔几天复查
  notIndexed2Days: number; // 连续第 2 次未收录后
  notIndexed3Days: number; // 连续第 3 次及以上
  indexedDays: number;     // 已收录兜底复查周期
}

export const DEFAULT_INSPECT_TUNING: InspectTuning = {
  notIndexed1Days: 1,
  notIndexed2Days: 3,
  notIndexed3Days: 7,
  indexedDays: 7,
};

/** 从 app_scheduler_config.tuning 读退避参数,缺失/坏值一律回默认。失败返回默认(软失败)。 */
export async function loadInspectTuning(): Promise<InspectTuning> {
  try {
    const rows = await db
      .select({ tuning: appSchedulerConfig.tuning })
      .from(appSchedulerConfig)
      .where(eq(appSchedulerConfig.id, 1));
    const raw = rows[0]?.tuning as Partial<InspectTuning> | null | undefined;
    return sanitizeTuning(raw);
  } catch (err) {
    console.warn("[gsc/inspect-freshness] loadInspectTuning failed, use defaults:", (err as Error).message);
    return { ...DEFAULT_INSPECT_TUNING };
  }
}

/** 校验/兜底:每项必须是 1..60 的整数,否则回该项默认。 */
export function sanitizeTuning(raw: Partial<InspectTuning> | null | undefined): InspectTuning {
  const pick = (v: unknown, dflt: number): number =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 60 ? v : dflt;
  return {
    notIndexed1Days: pick(raw?.notIndexed1Days, DEFAULT_INSPECT_TUNING.notIndexed1Days),
    notIndexed2Days: pick(raw?.notIndexed2Days, DEFAULT_INSPECT_TUNING.notIndexed2Days),
    notIndexed3Days: pick(raw?.notIndexed3Days, DEFAULT_INSPECT_TUNING.notIndexed3Days),
    indexedDays: pick(raw?.indexedDays, DEFAULT_INSPECT_TUNING.indexedDays),
  };
}

/**
 * 该 entry 的下次到期时刻(epoch ms)。0 = 立即(从未查过 / 上次失败 / checkedAt 缺失)。
 */
export function inspectDueAtMs(
  entry: IndexStatusEntry | undefined,
  tuning: InspectTuning
): number {
  if (!entry) return 0;
  if (entry.indexed === null) return 0;
  const checkedTime = entry.checkedAt ? new Date(entry.checkedAt).getTime() : 0;
  if (!checkedTime || Number.isNaN(checkedTime)) return 0;

  if (entry.indexed === false) {
    const streak = entry.notIndexedStreak ?? 1;
    const days =
      streak <= 1
        ? tuning.notIndexed1Days
        : streak === 2
          ? tuning.notIndexed2Days
          : tuning.notIndexed3Days;
    return checkedTime + days * DAY - PHASE_MARGIN_MS;
  }
  // indexed === true
  return checkedTime + tuning.indexedDays * DAY - PHASE_MARGIN_MS;
}

/** 是否到期需查。 */
export function needsInspection(
  entry: IndexStatusEntry | undefined,
  now: number,
  tuning: InspectTuning
): boolean {
  return inspectDueAtMs(entry, tuning) <= now;
}

/** 优先级主序(升序):0 从未查过 / 1 上次失败 / 2 未收录 / 3 已收录。 */
export function inspectionPriority(entry: IndexStatusEntry | undefined): number {
  if (!entry) return 0;
  if (entry.indexed === null) return 1;
  if (entry.indexed === false) return 2;
  return 3;
}

/** 完整排序:优先级 → check_count 升序(查得少优先) → checkedAt 升序(最久没查优先)。 */
export function compareInspection(
  a: IndexStatusEntry | undefined,
  b: IndexStatusEntry | undefined
): number {
  const p = inspectionPriority(a) - inspectionPriority(b);
  if (p !== 0) return p;
  const c = (a?.checkCount ?? 0) - (b?.checkCount ?? 0);
  if (c !== 0) return c;
  const ta = a?.checkedAt ? new Date(a.checkedAt).getTime() : 0;
  const tb = b?.checkedAt ? new Date(b.checkedAt).getTime() : 0;
  return ta - tb;
}
