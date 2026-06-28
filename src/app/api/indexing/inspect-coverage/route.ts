// POST /api/indexing/inspect-coverage
//
// 按需检查新站 sitemap 页面的 Google 收录状态。
// 从 sitemap 中选"未检查"的前 limit 个 → inspectUrls() 逐页查 GSC
// → 合并写入 data/gsc-index-status.json → 返回统计摘要。
//
// 鉴权 + 生产环境守卫照抄 sync/route.ts。

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { fetchSitemapPages } from "@/lib/gsc/sitemap";
import { loadIndexStatus, saveMergeIndexStatus } from "@/lib/gsc/index-status-store";
import { normalizeForMatch } from "@/lib/gsc/url-normalize";
import { inspectUrls, type IndexInspectionResult } from "@/lib/gsc/index-inspection-fetcher";
import {
  inspectUrlsViaApi,
  isGscApiConfigured,
} from "@/lib/gsc/index-inspection-api-fetcher";

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

  // 取数前先看是否配了官方 API：API 法稳且快（~120ms/页、无 reCAPTCHA）→ 批量上限放大到 50；
  // 会话法慢且有 reCAPTCHA 风险 → 沿用 57 上限。
  const apiConfigured = isGscApiConfigured();
  const hardCap = apiConfigured ? 50 : 57;

  let limit = 12;
  try {
    const body = (await req.json()) as { limit?: number };
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, hardCap);
    }
  } catch {
    // 没 body 也行，用默认 limit
  }

  const startedAt = Date.now();

  try {
    // 取 sitemap 全量页 + 当前已检查状态
    const [sitemapPages, status] = await Promise.all([
      fetchSitemapPages(),
      loadIndexStatus(),
    ]);

    // 挑出"未检查"的 URL（status 里无记录或 indexed===null）
    const unchecked = sitemapPages.filter((sp) => {
      const key = normalizeForMatch(sp.fullUrl);
      const entry = status.byUrl[key];
      return !entry || entry.indexed === null;
    });

    const toInspect = unchecked.slice(0, limit).map((sp) => sp.fullUrl);

    if (toInspect.length === 0) {
      return NextResponse.json({
        ok: true,
        via: apiConfigured ? "api" : "session",
        inspected: 0,
        indexed: 0,
        notIndexed: 0,
        failed: 0,
        captchaBlocked: false,
        remainingUnchecked: 0,
        durationMs: Date.now() - startedAt,
      });
    }

    // 取数：优先官方 API（稳/快/无验证码），未配置则回退会话抓取法（reCAPTCHA 逻辑原样保留）。
    let results: IndexInspectionResult[];
    let captchaBlocked = false;
    let via: "api" | "session" = "session";

    const api = apiConfigured ? await inspectUrlsViaApi(toInspect) : null;

    if (api && api.configured && api.error) {
      // 配了 key 但鉴权/授权失败（多为服务账号没被加进 GSC 属性）→ 4xx 带提示，
      // 让前端 toast 指引去 GSC 加 Full User；不静默回退会话法，避免掩盖配置问题。
      return NextResponse.json(
        {
          ok: false,
          code: "GSC_API_NOT_AUTHORIZED",
          message: api.error,
          via: "api",
          durationMs: Date.now() - startedAt,
        },
        { status: 400 }
      );
    }

    if (api && api.configured) {
      results = api.results;
      via = "api"; // captchaBlocked 保持 false：API 法无 reCAPTCHA
    } else {
      // 未配置 API（或极端情况下 API 自检为未配置）→ 走原会话抓取法。
      const session = await inspectUrls(toInspect);
      results = session.results;
      captchaBlocked = session.captchaBlocked;
      via = "session";
    }

    // 合并写入
    await saveMergeIndexStatus(
      results.map((r) => ({
        url: r.url,
        indexed: r.indexed,
        coverageText: r.coverageText,
        lastCrawled: r.lastCrawled,
      }))
    );

    // 让 RSC 重新跑
    revalidatePath("/app/indexing");

    const indexed = results.filter((r) => r.indexed === true).length;
    const notIndexed = results.filter((r) => r.indexed === false).length;
    const failed = results.filter((r) => r.indexed === null).length;

    return NextResponse.json({
      ok: true,
      via,
      inspected: results.length,
      indexed,
      notIndexed,
      failed,
      captchaBlocked,
      remainingUnchecked: unchecked.length - results.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, code: "INSPECT_FAILED", message, durationMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
