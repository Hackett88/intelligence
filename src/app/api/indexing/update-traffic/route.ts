// POST /api/indexing/update-traffic
//
// 走官方 Search Analytics API 拉最近 60 天 per-page 流量 → 落 PG 批次（桥与展示自动用上）
// + 旧址 60 天退休。主逻辑在 @/lib/gsc/run-traffic-update 的 runTrafficUpdateCore（路由与定时器共用）。
// 本路由只保留：鉴权 + 调核心 + 未配/授权错误转 400 + revalidate + 响应/错误包装。
//
// 鉴权照抄 inspect-coverage/route.ts。
// 刻意【不加】生产 403 守卫：官方 API 法服务端直连 Google、无浏览器依赖，生产可跑。

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runTrafficUpdateCore } from "@/lib/gsc/run-traffic-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
  // ── 鉴权（照抄 inspect-coverage/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  const startedAt = Date.now();

  try {
    const summary = await runTrafficUpdateCore({ apiOnly: false });

    // 未配 key / 配了但授权失败 → 400 + message（前端 toast 指引去配 key 或 GSC 加 Full User）。
    if (
      !summary.ok &&
      (summary.code === "GSC_API_NOT_AUTHORIZED" ||
        summary.code === "GSC_API_NOT_CONFIGURED")
    ) {
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

    // 让 RSC 重新跑，页面读到新批次。
    revalidatePath("/app/indexing");

    // 成功态 summary 的 code/error 恒为 undefined → JSON 自动省略。
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "TRAFFIC_UPDATE_FAILED", message, durationMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
