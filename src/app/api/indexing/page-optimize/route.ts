// POST /api/indexing/page-optimize
//
// 页面「内容优化」标记（追加版本 / 撤销上一次）。曝光高点击低的页优化内容后，在抽屉
// 「基本信息」卡点「标记优化」记一个版本（版本号 + 洛杉矶日历日 + 备注）；流量趋势按各
// 版本起算日展示「优化后累计」与总计对比。标记落 PG gsc_page_optimizations（权威源，跨部署
// 持久）+ JSON 镜像兜底，由 coverage-loader 重建页面后按 url_norm 挂到每页，独立于 GSC 同步。
//
// body: { url: string(fullUrl), action: "add" | "undo", note?: string }
//   · add  —— 追加一个版本（v+1，落洛杉矶今天，note 可留空）
//   · undo —— 撤销最新一次（弹出最后一个版本；撤到空则删记录）
//
// 写完清快照缓存 + revalidate，使 /app/indexing 下次请求拿到更新后的数据；前端配合 router.refresh()。

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { appendOptimization, undoLastOptimization } from "@/lib/gsc/optimizations";
import { invalidateSnapshotCache } from "@/lib/gsc/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
  }

  let url = "";
  let action = "";
  let note = "";
  try {
    const body = (await req.json()) as { url?: unknown; action?: unknown; note?: unknown };
    if (typeof body?.url === "string") url = body.url.trim();
    if (typeof body?.action === "string") action = body.action.trim();
    if (typeof body?.note === "string") note = body.note;
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_BODY", message: "请求体格式错误" }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ ok: false, code: "MISSING_URL", message: "缺少页面 URL" }, { status: 400 });
  }
  if (action !== "add" && action !== "undo") {
    return NextResponse.json({ ok: false, code: "BAD_ACTION", message: "action 必须是 add 或 undo" }, { status: 400 });
  }

  let events;
  try {
    events =
      action === "add"
        ? await appendOptimization(url, note)
        : await undoLastOptimization(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/indexing/page-optimize] save failed:", message);
    return NextResponse.json({ ok: false, code: "SAVE_FAILED", message }, { status: 500 });
  }

  // 清缓存 + revalidate —— 否则页面读旧缓存，要等 TTL 才刷新（与 page-type 同款）
  invalidateSnapshotCache();
  revalidatePath("/app/indexing");

  return NextResponse.json({ ok: true, url, action, events });
}
