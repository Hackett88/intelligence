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
import { loadIndexStatus, saveMergeIndexStatus } from "@/lib/gsc/index-status-store";
import { normalizeForMatch } from "@/lib/gsc/url-normalize";
import { inspectUrls, type IndexInspectionResult } from "@/lib/gsc/index-inspection-fetcher";
import {
  inspectUrlsViaApi,
  isGscApiConfigured,
} from "@/lib/gsc/index-inspection-api-fetcher";

// 路由现在返回的统计体。code/error 仅在「已配 key 但授权失败」错误态出现，
// 由路由据此转成 400（前端 toast 指引去 GSC 加 Full User）；成功态二者恒为 undefined（JSON 自动省略）。
export interface InspectionSummary {
  ok: boolean;
  mode: "incremental" | "all";
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

/**
 * 收录检查核心（鉴权与生产守卫之外的全部逻辑）。
 *
 * @param opts.mode    incremental（仅查"未检查"页）| all（仅 API 法生效，全量重查）。
 * @param opts.apiOnly 默认 false。true 时若未配官方 API → 直接返回空 summary（不碰会话法），给定时器用。
 */
export async function runInspectionCore(
  opts: { mode: "incremental" | "all"; apiOnly?: boolean }
): Promise<InspectionSummary> {
  const { mode } = opts;
  const apiOnly = opts.apiOnly ?? false;

  const startedAt = Date.now();
  const apiConfigured = isGscApiConfigured();

  // all 模式仅对【官方 API 法】生效（API 稳/快/无验证码，maxDuration 放得下全 57 页）；
  // 会话法（无 key）有 reCAPTCHA 软拦截风险，强制全量重查不安全 → 退回 incremental。
  const effectiveAll = mode === "all" && apiConfigured;
  const effectiveMode: "incremental" | "all" = effectiveAll ? "all" : "incremental";

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

  // hardCap / limit：照搬原路由。requestedLimit 在核心里恒取默认（路由不再透传 limit）——
  // 前端 incremental 本就发 limit:12 == 此默认值，故响应与重构前逐字一致。
  const hardCap = apiConfigured ? (effectiveAll ? 57 : 50) : 57;
  const limit = effectiveAll ? hardCap : Math.min(12, hardCap);

  // 取 sitemap 全量页 + 当前已检查状态
  const [sitemapPages, status] = await Promise.all([
    fetchSitemapPages(),
    loadIndexStatus(),
  ]);

  // 候选集：all（仅 API 法）= 全部 sitemap 页（强制重新 inspect）；
  // 否则 incremental = 仅"未检查"（status 里无记录或 indexed===null）。
  const candidates = effectiveAll
    ? sitemapPages
    : sitemapPages.filter((sp) => {
        const key = normalizeForMatch(sp.fullUrl);
        const entry = status.byUrl[key];
        return !entry || entry.indexed === null;
      });

  const toInspect = candidates.slice(0, limit).map((sp) => sp.fullUrl);

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

  // 取数：优先官方 API（稳/快/无验证码），未配置则回退会话抓取法（reCAPTCHA 逻辑原样保留）。
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

  // 合并写入
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
    // all 模式覆盖全部 → candidates=全 57 页，inspected 全部后此值=0；
    // incremental → 本轮未检查里还剩多少没查。
    remainingUnchecked: candidates.length - results.length,
    durationMs: Date.now() - startedAt,
  };
}
