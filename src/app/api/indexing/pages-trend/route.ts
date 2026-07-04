// POST /api/indexing/pages-trend
//
// 一批页面的【合并每日增量趋势】——每天 = 所选各页(own + 旧址 308 归并来源)当日
// 曝光/点击之和。口径与单页 /page-trend 完全一致,只是多页合并一次求和。
// 供「功能 → 批量增量趋势」弹窗使用(前端画每日 + 累计,与抽屉同款图)。
//
// body: { urls: string[] }  —— fullUrl 数组,上限 500(全站 76 页量级)。
// 鉴权照抄 page-trend/route.ts(无 session → 401)。

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { loadPagesDailyTrend } from "@/lib/gsc/coverage-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  let urls: string[] = [];
  try {
    const body = (await req.json()) as { urls?: unknown };
    if (Array.isArray(body?.urls)) {
      urls = body.urls
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim());
    }
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_BODY", message: "请求体格式错误" },
      { status: 400 }
    );
  }

  if (urls.length === 0) {
    return NextResponse.json(
      { ok: false, code: "MISSING_URLS", message: "缺少页面 URL 数组" },
      { status: 400 }
    );
  }
  if (urls.length > 500) {
    return NextResponse.json(
      { ok: false, code: "TOO_MANY_URLS", message: `批量上限 500 条，收到 ${urls.length} 条` },
      { status: 400 }
    );
  }

  try {
    const { startDate, pages, series } = await loadPagesDailyTrend(urls);
    return NextResponse.json({ ok: true, startDate, pages, series });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "TREND_FAILED", message },
      { status: 500 }
    );
  }
}
