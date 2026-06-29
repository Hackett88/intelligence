// GET /api/indexing/page-trend?path=/collection/zikr-ring  (或 ?url=完整URL)
//
// 返回某页【每日总流量趋势】（总流量 = 自身 + 旧址归并，与列表/抽屉顶部显示同口径）。
// 前端在 URL 详情抽屉里用它画「每日 + 累计」两种图。只返回每日序列，累计由前端算。
//
// 鉴权照抄 inspect-coverage/route.ts（无 session → 401）。

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { loadPageDailyTrend } from "@/lib/gsc/coverage-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://www.weslamic.com";

export async function GET(req: NextRequest) {
  // ── 鉴权（照抄 inspect-coverage/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  // path（页面 pathname）或 url（完整 URL）二选一；都缺 → 400。
  const sp = req.nextUrl.searchParams;
  const url = sp.get("url");
  const path = sp.get("path");
  let fullUrl: string;
  if (url && url.trim()) {
    fullUrl = url.trim();
  } else if (path && path.trim()) {
    const p = path.trim();
    fullUrl = ORIGIN + (p.startsWith("/") ? p : "/" + p);
  } else {
    return NextResponse.json(
      { ok: false, code: "MISSING_PARAM", message: "需提供 path 或 url 参数" },
      { status: 400 }
    );
  }

  try {
    const { startDate, series } = await loadPageDailyTrend(fullUrl);
    return NextResponse.json({ ok: true, startDate, series });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "TREND_FAILED", message },
      { status: 500 }
    );
  }
}
