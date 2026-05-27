// POST /api/indexing/page-type
//
// 人工修正某个页面的"页面类型"。修正按 fullUrl 存到 data/page-type-overrides.json，
// 由 loader 在重建页面后套用，独立于 GSC 同步（同步重新推断也不会覆盖）。
//
// body: { url: string(fullUrl), pageType: string }
//   pageType 传空串 → 删除该 url 的修正，恢复自动推断。
//
// 写完清快照缓存 + revalidate，使 /app/indexing 下次请求拿到修正后的数据。

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { savePageTypeOverride } from "@/lib/gsc/overrides";
import { invalidateSnapshotCache } from "@/lib/gsc/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 合法页面类型集合 —— 与前端 _utils.PAGE_TYPE_ORDER 保持一致（那边是 "use client"
// 模块，服务端不能直接引入，故在此独立维护一份校验集。新增类型时两处同步。）
const VALID_PAGE_TYPES = new Set<string>([
  "首页", "品类列表页", "产品详情页", "落地页", "指南教程",
  "博客目录", "博客文章", "资讯新闻", "对比页", "工具页",
  "常见问题", "关于页", "政策页", "资源文件", "系统页",
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
  }

  let url = "";
  let pageType = "";
  try {
    const body = (await req.json()) as { url?: unknown; pageType?: unknown };
    if (typeof body?.url === "string") url = body.url.trim();
    if (typeof body?.pageType === "string") pageType = body.pageType.trim();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_BODY", message: "请求体格式错误" }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ ok: false, code: "MISSING_URL", message: "缺少页面 URL" }, { status: 400 });
  }
  // 允许空串（= 清除修正、恢复自动推断）；非空时必须是合法类型
  if (pageType && !VALID_PAGE_TYPES.has(pageType)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PAGE_TYPE", message: `未知页面类型：${pageType}` },
      { status: 400 }
    );
  }

  try {
    await savePageTypeOverride(url, pageType);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/indexing/page-type] save failed:", message);
    return NextResponse.json({ ok: false, code: "SAVE_FAILED", message }, { status: 500 });
  }

  // 清缓存 + revalidate —— 否则页面读旧缓存，要等 TTL 才刷新
  invalidateSnapshotCache();
  revalidatePath("/app/indexing");

  return NextResponse.json({ ok: true, url, pageType });
}
