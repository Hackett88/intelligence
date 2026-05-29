"use server";

/**
 * 选题工作台 · 保存规划的 Server Action
 * 前端（WorkbenchClient）防抖调用；owner 一律由服务端会话解析，前端无法伪造。
 */
import { auth } from "@/lib/auth";
import { savePlan } from "./_plan-store";
import type { PlanPayload } from "./_workbench";

export async function saveStrategyPlanAction(plan: PlanPayload): Promise<{ ok: boolean }> {
  const session = await auth();
  const owner = session?.user?.email ?? null;
  if (!owner) return { ok: false };
  try {
    await savePlan(owner, plan);
    return { ok: true };
  } catch (e) {
    console.error("[strategy] savePlan failed:", e);
    return { ok: false };
  }
}
