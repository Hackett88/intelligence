// POST /api/indexing/inspect-coverage
//
// 按需检查新站 sitemap 页面的 Google 收录状态。
// 收录检查主逻辑已抽到 @/lib/gsc/run-inspection 的 runInspectionCore（路由与应用内定时器共用）。
// 本路由只保留：鉴权 + 生产环境守卫 + body 解析 + 调核心 + revalidate + 响应/错误包装。
//
// 对外行为与重构前逐字一致（前端"刷新收录状态①②"在用此响应体）。
//
// 鉴权 + 生产环境守卫照抄 sync/route.ts。

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isGscApiConfigured } from "@/lib/gsc/index-inspection-api-fetcher";
import { runInspectionCore } from "@/lib/gsc/run-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  // ── 鉴权（照抄 sync/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  // ── 生产环境 403 守卫 ──
  // 官方 API 已配（服务账号）→ 服务端直连 Google，无需本地浏览器 → 线上放行。
  // 未配 API → 会话法依赖本地调试端口（9222），部署环境不具备 → 仍 403。
  if (process.env.NODE_ENV === "production" && !isGscApiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        code: "INSPECT_DISABLED_ON_DEPLOY",
        message: "线上未配置官方 API（GSC_SA_KEY_JSON），无法检查收录状态。",
        hint: "未配 GSC 服务账号时，会话法 URL Inspection 依赖本地浏览器（调试端口 9222），部署环境不具备该条件。",
      },
      { status: 403 }
    );
  }

  // 解析 body：mode（刷新模式，默认 on-demand）。
  // limit 固定为 12 传给核心，防止按钮触发的同步请求超过网关 ~11s 超时。
  let mode: "on-demand" | "all" = "on-demand";
  try {
    const body = (await req.json()) as { mode?: "on-demand" | "all" };
    if (body?.mode === "all") mode = "all";
  } catch {
    // 没 body 也行，用默认 mode
  }

  const startedAt = Date.now();

  try {
    const summary = await runInspectionCore({ mode, limit: 12, apiOnly: false });

    // 配了 key 但鉴权/授权失败 → 维持原 400 + 同 message（让前端 toast 指引去 GSC 加 Full User）。
    if (!summary.ok && summary.code === "GSC_API_NOT_AUTHORIZED") {
      return NextResponse.json(
        {
          ok: false,
          code: summary.code,
          message: summary.error,
          via: summary.via,
          durationMs: summary.durationMs,
        },
        { status: 400 }
      );
    }

    // 让 RSC 重新跑
    revalidatePath("/app/indexing");

    // 成功态 summary 的 code/error 恒为 undefined → JSON 自动省略，响应字段与重构前完全一致。
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "INSPECT_FAILED", message, durationMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
