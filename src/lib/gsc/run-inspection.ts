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
  type IndexStatusEntry,
} from "@/lib/gsc/index-status-store";
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

// ── 新鲜度阈值 ──────────────────────────────────────────────────────────────────
// 定时器每天固定 LA 钟点触发一次。阈值若取整 24h/7d，任何「上次检查发生在触发点之后」的页
// （手动按钮下午点过、或上一轮批量跑到触发点之后几十秒才写完）到次日触发时都差一点不到期，
// 被整体顺延一天：未收录页实际 48h 才复查——Google 翻成已收录后面板要多错一天（实案：
// /smart-tasbih-ring 2026-07-01 15:26 手动查为未收录，07-02 上午 Google 收录，07-02 13:00
// 定时跑时仅过 21.6h 被跳过）。各留 4h 相位余量，保证「昨天检查过的页，今天到点必复查」。
const STALE_NOT_INDEXED_MS = 20 * 60 * 60 * 1000; // 未收录 → ≥20h 复查（名义节律仍是每日）
const STALE_INDEXED_MS = (7 * 24 - 4) * 60 * 60 * 1000; // 已收录 → ≥6d20h 复查（名义节律仍是每周）

/**
 * 判断该 entry 是否需要重新检查（新鲜度判定）。
 * - 无 entry（未查过）→ 需查
 * - indexed===null（失败/未知）→ 需查
 * - indexed===false（未收录）→ 距上次检查 ≥ 20h 才查（每日节律，含相位余量）
 * - indexed===true（已收录）→ 距上次检查 ≥ 6d20h 才查（每周节律，含相位余量）
 * - checkedAt 缺失/解析为 NaN → 当作 0（很旧）→ 需查
 */
function needsInspection(entry: IndexStatusEntry | undefined, now: number): boolean {
  if (!entry) return true;
  if (entry.indexed === null) return true;
  const checkedTime = entry.checkedAt ? new Date(entry.checkedAt).getTime() : 0;
  if (entry.indexed === false) return now - checkedTime >= STALE_NOT_INDEXED_MS;
  return now - checkedTime >= STALE_INDEXED_MS; // indexed === true
}

/**
 * 优先级得分（升序，越小越优先，limit 截断时先查最紧要的页）。
 * 0 = 无记录（从未检查）
 * 1 = indexed===null（上次失败/未知）
 * 2 = indexed===false（未收录，24h 到期）
 * 3 = indexed===true（已收录，7d 到期）
 */
function inspectionPriority(entry: IndexStatusEntry | undefined): number {
  if (!entry) return 0;
  if (entry.indexed === null) return 1;
  if (entry.indexed === false) return 2;
  return 3; // indexed === true
}

/**
 * 收录检查核心（鉴权与生产守卫之外的全部逻辑）。
 *
 * @param opts.mode    on-demand（按新鲜度选候选集）| all（仅 API 法，强制重查全部）。
 * @param opts.apiOnly 默认 false。true 时若未配官方 API → 直接返回空 summary（不碰会话法），给定时器用。
 * @param opts.limit   截断候选数上限；缺省（undefined）= 不截断，查全部到期页，给定时器用。
 */
export async function runInspectionCore(
  opts: { mode: "on-demand" | "all"; apiOnly?: boolean; limit?: number }
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

  // 取 sitemap 全量页 + 当前已检查状态
  const [sitemapPages, status] = await Promise.all([
    fetchSitemapPages(),
    loadIndexStatus(),
  ]);

  // ── 候选集选取 ───────────────────────────────────────────────────────────────
  // "all"（仅 API 法）= 全部 sitemap 页（强制重查，忽略新鲜度）；
  // "on-demand" = 仅"需查"页（新鲜度判定），按优先级升序排序后再截断。
  let candidates: typeof sitemapPages;

  if (effectiveAll) {
    // 强制全量，不过滤、不排序（顺序与 sitemap 一致）
    candidates = sitemapPages;
  } else {
    // 新鲜度过滤
    candidates = sitemapPages.filter((sp) => {
      const key = normalizeForMatch(sp.fullUrl);
      return needsInspection(status.byUrl[key], now);
    });
    // 优先级排序（升序：越小越优先）——排在 limit 截断之前，确保截断后留下最紧要的页
    candidates.sort((a, b) => {
      const keyA = normalizeForMatch(a.fullUrl);
      const keyB = normalizeForMatch(b.fullUrl);
      return (
        inspectionPriority(status.byUrl[keyA]) -
        inspectionPriority(status.byUrl[keyB])
      );
    });
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
