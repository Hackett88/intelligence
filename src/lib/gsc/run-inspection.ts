// GSC 收录检查【共享核心】—— 从 inspect-coverage/route.ts 抽出，供路由与应用内定时器复用。
//
// 这里只放「鉴权 + 生产守卫之后」的纯收录检查逻辑：取 sitemap + 现状 → 按 mode 选候选集 →
// 官方 API 优先（未配 key 时回退会话法）→ saveMergeIndexStatus → 算统计。行为与原路由逐字一致。
//
// 刻意【不含】：鉴权、NextResponse、revalidatePath、500 包装 —— 这些留在路由层。
// 非预期错误直接抛出（路由 catch 成 500 INSPECT_FAILED；定时器 catch 成 console.error）。
//
// apiOnly：给定时器用。定时器跑在服务端、无本地浏览器，绝不能触发会话法/puppeteer。
//   true 且未配官方 API → 直接返回 inspected:0 的空 summary，连 sitemap 都不取、更不碰会话法。

import { fetchSitemapPages } from "@/lib/gsc/sitemap";
import {
  loadIndexStatus,
  saveMergeIndexStatus,
} from "@/lib/gsc/index-status-store";
import { normalizeForMatch } from "@/lib/gsc/url-normalize";
import { inspectUrls, type IndexInspectionResult } from "@/lib/gsc/index-inspection-fetcher";
import {
  inspectUrlsViaApi,
  isGscApiConfigured,
} from "@/lib/gsc/index-inspection-api-fetcher";
import {
  loadInspectTuning,
  needsInspection,
  compareInspection,
} from "@/lib/gsc/inspect-freshness";
import { bumpApiUsage } from "@/lib/gsc/api-usage-store";

// 路由现在返回的统计体。code/error 仅在「已配 key 但授权失败」错误态出现，
// 由路由据此转成 400（前端 toast 指引去 GSC 加 Full User）；成功态二者恒为 undefined（JSON 自动省略）。
export interface InspectionSummary {
  ok: boolean;
  mode: "on-demand" | "all";
  via: "api" | "session";
  inspected: number;
  indexed: number;
  notIndexed: number;
  failed: number;
  captchaBlocked: boolean;
  remainingUnchecked: number;
  durationMs: number;
  code?: string;
  error?: string;
}

// ── 新鲜度 / 退避 / 排序 ─────────────────────────────────────────────────────────
// 2026-07-04 起抽到 inspect-freshness.ts 与前端/面板共享：
//   · 退避节律：没查过→立即；未收录 1 次→隔 1 天、2 次→隔 3 天、3 次起→每周；已收录→每周。
//     参数存 app_scheduler_config.tuning（用量面板可调），全部含 4h 相位余量（沿革见该模块注释）。
//   · 排序：从未查过 → 上次失败 → 未收录 → 已收录；同级按 check_count 升序（查得少优先）。

/**
 * 收录检查核心（鉴权与生产守卫之外的全部逻辑）。
 *
 * @param opts.mode    on-demand（按新鲜度选候选集）| all（仅 API 法，强制重查全部）。
 * @param opts.apiOnly 默认 false。true 时若未配官方 API → 直接返回空 summary（不碰会话法），给定时器用。
 * @param opts.limit   截断候选数上限；缺省（undefined）= 不截断，查全部到期页，给定时器用。
 * @param opts.urls    显式 URL 列表（清单弹窗勾选确认后传入）：只查这些页、跳过新鲜度过滤
 *                     （用户明确点名就查），仍按退避排序 + limit 截断 + 正常计数落库。
 */
export async function runInspectionCore(
  opts: { mode: "on-demand" | "all"; apiOnly?: boolean; limit?: number; urls?: string[] }
): Promise<InspectionSummary> {
  const { mode } = opts;
  const apiOnly = opts.apiOnly ?? false;
  const requestedLimit = opts.limit;

  const startedAt = Date.now();
  const now = startedAt;
  const apiConfigured = isGscApiConfigured();

  // "all" 模式仅对【官方 API 法】生效（稳/快/无验证码，maxDuration 放得下全量页）；
  // 会话法（无 key）有 reCAPTCHA 软拦截风险，强制全量重查不安全 → 退回 on-demand。
  const effectiveAll = mode === "all" && apiConfigured;
  const effectiveMode: "on-demand" | "all" = effectiveAll ? "all" : "on-demand";

  // apiOnly 守卫：强制 API-only 但未配 key → 直接空返回，绝不触发会话法/浏览器（给定时器兜底）。
  if (apiOnly && !apiConfigured) {
    return {
      ok: true,
      mode: effectiveMode,
      via: "api",
      inspected: 0,
      indexed: 0,
      notIndexed: 0,
      failed: 0,
      captchaBlocked: false,
      remainingUnchecked: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // 取 sitemap 全量页 + 当前已检查状态 + 退避参数（面板可调）
  const [sitemapPages, status, tuning] = await Promise.all([
    fetchSitemapPages(),
    loadIndexStatus(),
    loadInspectTuning(),
  ]);

  // ── 候选集选取 ───────────────────────────────────────────────────────────────
  // 显式 urls（清单弹窗勾选）= 只取点名页、跳过新鲜度（用户明确要查），仍按退避排序；
  // "all"（仅 API 法）= 全部 sitemap 页（强制重查，忽略新鲜度）；
  // "on-demand" = 仅"到期"页（退避判定），按优先级+次数升序排序后再截断。
  let candidates: typeof sitemapPages;

  if (opts.urls && opts.urls.length > 0) {
    const wanted = new Set(opts.urls.map((u) => normalizeForMatch(u)));
    candidates = sitemapPages.filter((sp) => wanted.has(normalizeForMatch(sp.fullUrl)));
    candidates.sort((a, b) =>
      compareInspection(
        status.byUrl[normalizeForMatch(a.fullUrl)],
        status.byUrl[normalizeForMatch(b.fullUrl)]
      )
    );
  } else if (effectiveAll) {
    // 强制全量，不过滤、不排序（顺序与 sitemap 一致）
    candidates = sitemapPages;
  } else {
    // 退避到期过滤
    candidates = sitemapPages.filter((sp) => {
      const key = normalizeForMatch(sp.fullUrl);
      return needsInspection(status.byUrl[key], now, tuning);
    });
    // 排序：优先级 → check_count 升序 → 最久没查优先——截断前排好，留最紧要的页
    candidates.sort((a, b) =>
      compareInspection(
        status.byUrl[normalizeForMatch(a.fullUrl)],
        status.byUrl[normalizeForMatch(b.fullUrl)]
      )
    );
  }

  // limit 截断：按钮传 12 防网关超时；定时器缺省不截断，查全部到期页
  const toInspect = (
    requestedLimit !== undefined ? candidates.slice(0, requestedLimit) : candidates
  ).map((sp) => sp.fullUrl);

  if (toInspect.length === 0) {
    return {
      ok: true,
      mode: effectiveMode,
      via: apiConfigured ? "api" : "session",
      inspected: 0,
      indexed: 0,
      notIndexed: 0,
      failed: 0,
      captchaBlocked: false,
      remainingUnchecked: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // ── 取数：优先官方 API；未配置则回退会话抓取法 ──────────────────────────────
  let results: IndexInspectionResult[];
  let captchaBlocked = false;
  let via: "api" | "session" = "session";

  const api = apiConfigured ? await inspectUrlsViaApi(toInspect) : null;

  if (api && api.configured && api.error) {
    // 配了 key 但鉴权/授权失败 → 透传给路由转 400，不静默回退会话法（避免掩盖配置问题）。
    return {
      ok: false,
      mode: effectiveMode,
      via: "api",
      inspected: 0,
      indexed: 0,
      notIndexed: 0,
      failed: 0,
      captchaBlocked: false,
      remainingUnchecked: 0,
      durationMs: Date.now() - startedAt,
      code: "GSC_API_NOT_AUTHORIZED",
      error: api.error,
    };
  }

  if (api && api.configured) {
    results = api.results;
    via = "api"; // captchaBlocked 保持 false：API 法无 reCAPTCHA
  } else {
    // 未配置 API → 会话抓取法。注：apiOnly===true 时若未配 key 已在上面提前返回，
    // 且「isGscApiConfigured() 为真 ⟹ api.configured 为真」，故本分支只在 apiOnly===false
    // （路由调用）且未配 API 时进入 —— 定时器永远到不了这里。
    const session = await inspectUrls(toInspect);
    results = session.results;
    captchaBlocked = session.captchaBlocked;
    via = "session";
  }

  // ── API 用量计数（仅官方 API 法吃 2000/天配额；会话法走浏览器不计）──
  if (via === "api" && results.length > 0) {
    await bumpApiUsage("url_inspection", results.length);
  }

  // ── 合并写入 PG ─────────────────────────────────────────────────────────────
  await saveMergeIndexStatus(
    results.map((r) => ({
      url: r.url,
      indexed: r.indexed,
      coverageText: r.coverageText,
      lastCrawled: r.lastCrawled,
    }))
  );

  const indexed = results.filter((r) => r.indexed === true).length;
  const notIndexed = results.filter((r) => r.indexed === false).length;
  const failed = results.filter((r) => r.indexed === null).length;

  return {
    ok: true,
    mode: effectiveMode,
    via,
    inspected: results.length,
    indexed,
    notIndexed,
    failed,
    captchaBlocked,
    // 本轮到期但因 limit 未查的页数 = 候选总数 - 本轮实际查数
    remainingUnchecked: candidates.length - results.length,
    durationMs: Date.now() - startedAt,
  };
}
