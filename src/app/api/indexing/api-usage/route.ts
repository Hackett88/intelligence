// GET  /api/indexing/api-usage  —— API 用量(今日 + 近 7 天,LA 日期口径)+ 收录退避参数
// PATCH /api/indexing/api-usage —— 保存退避参数(app_scheduler_config.tuning)
//
// 供「用量」独立面板使用。鉴权照抄 inspect-coverage/route.ts。

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { appSchedulerConfig } from "@/db/schema";
import {
  loadApiUsage,
  laDay,
  URL_INSPECTION_DAILY_QUOTA,
} from "@/lib/gsc/api-usage-store";
import {
  loadInspectTuning,
  sanitizeTuning,
  type InspectTuning,
} from "@/lib/gsc/inspect-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
  }

  const [usage, tuning] = await Promise.all([loadApiUsage(7), loadInspectTuning()]);

  const today = laDay();
  const byDay = new Map<string, { urlInspection: number; trafficRounds: number }>();
  for (const r of usage) {
    let d = byDay.get(r.day);
    if (!d) {
      d = { urlInspection: 0, trafficRounds: 0 };
      byDay.set(r.day, d);
    }
    if (r.kind === "url_inspection") d.urlInspection += r.count;
    if (r.kind === "traffic_rounds") d.trafficRounds += r.count;
  }
  const days = [...byDay.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  const todayRow = byDay.get(today) ?? { urlInspection: 0, trafficRounds: 0 };

  return NextResponse.json({
    ok: true,
    today: { day: today, ...todayRow, quota: URL_INSPECTION_DAILY_QUOTA },
    days,
    tuning,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
  }

  let raw: Partial<InspectTuning>;
  try {
    const body = (await req.json()) as { tuning?: Partial<InspectTuning> };
    raw = body?.tuning ?? {};
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_BODY", message: "请求体格式错误" }, { status: 400 });
  }

  const tuning = sanitizeTuning(raw); // 越界/坏值静默回默认(1..60 整数天)

  try {
    await db
      .update(appSchedulerConfig)
      .set({ tuning, updatedAt: new Date() })
      .where(eq(appSchedulerConfig.id, 1));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, code: "SAVE_FAILED", message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tuning });
}
