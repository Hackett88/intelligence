// POST /api/indexing/request-index
//
// 对单个 URL 在 GSC 网址检查页执行「请求编入索引」（用户工作流：新建页面后让 Google 立即抓取）。
// 驱动本地已登录 GSC 的 Chrome（CDP 调试端口 9222），代驾点击「请求编入索引 / Request indexing」。
//
// 鉴权照抄 inspect-coverage/route.ts。
//
// 生产守卫：本功能依赖本地浏览器（9222），且官方无"为任意网页请求编入索引"的 API（URL Inspection
// API 只读），故没有线上替代路径 → 生产环境直接 403（不像 inspect-coverage 可回退官方 API）。
//
// 刻意不写 index-status-store / 不动收录状态文件：只驱动浏览器 + 返回结果，避免与并行进行的存储改造冲突。

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requestIndexing } from "@/lib/gsc/request-index-fetcher";
import { recordIndexRequested } from "@/lib/gsc/index-request-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 单 URL 含实时测试可能耗时数分钟（GSC 实时查询 20-50s + 实时测试 ≤90s），给足预算。
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ── 鉴权（照抄 inspect-coverage/route.ts） ──
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "请先登录" },
      { status: 401 }
    );
  }

  // ── 生产环境 403 守卫 ──
  // 请求编入索引只能走 GSC UI（官方无公开 API），UI 法依赖本地调试端口（9222），
  // 部署环境不具备 → 线上一律 403，无回退路径。
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        code: "REQUEST_INDEX_LOCAL_ONLY",
        message: "请求索引依赖本地浏览器，仅本地可用",
      },
      { status: 403 }
    );
  }

  // ── 解析并校验 body ──
  let url: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (typeof body?.url !== "string" || !/^https?:\/\//.test(body.url.trim())) {
      return NextResponse.json(
        { ok: false, code: "INVALID_URL", message: "缺少有效的 url（需以 http(s):// 开头）" },
        { status: 400 }
      );
    }
    url = body.url.trim();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_BODY", message: "请求体需为 JSON：{ url: string }" },
      { status: 400 }
    );
  }

  try {
    const result = await requestIndexing(url);
    // 历史计数:仅真正提交成功才 +1(already_indexed / throttled / captcha 都不是提交)。
    // best-effort:计数落库失败不影响本次提交结果(store 内部已吞错)。
    if (result.status === "requested") {
      await recordIndexRequested(url);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "REQUEST_INDEX_FAILED", message },
      { status: 500 }
    );
  }
}
