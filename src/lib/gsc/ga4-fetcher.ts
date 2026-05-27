// GA4「进站后」指标采集器（用户工作流，镜像 GSC fetcher 思路）
//
// 工作前提：用户的 Chrome 已登录 GA4，并以 --remote-debugging-port=9222 启动。
// 复用 cdp.ts 的连接原语接管同一个浏览器，在已登录的 analytics.google.com 页面
// 上下文里 POST GA4 内部数据接口 `venus`（同源自动带 cookie + x-gafe4-xsrf-token），
// 拿结构化 JSON。零独立凭证 —— 与 GSC 采集同一套"骑登录会话"思路。
//
// 口径（Sean 拍板 2026-05-27）：全渠道、近 28 天、landing_page 维度。
//
// 取两次：
//   ① 指标：landing_page × [active_users, engaged_sessions, sessions, user_engagement_duration]
//      → 派生 engagementRate = engaged/sessions、avgEngagementTime = duration/sessions（每会话）
//   ② 国家：[landing_page, country] × active_users → 按 page 分组、按活跃用户降序取 Top10
//
// 容错铁律：任何失败返回 { failed:true, byPath:空 }，绝不抛 —— 由 sync 层降级，不拖垮 GSC。

import { type Browser, type Page } from "puppeteer-core";
import { DEFAULT_CDP_HOST, DEFAULT_CDP_PORT, connectBrowser } from "./cdp";

// property / dataset 走环境变量，缺省回落到本项目已知值（便于本地直接跑、生产可覆盖）。
const DEFAULT_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "530847425";
const DEFAULT_DATASET = process.env.GA4_DATASET || "a389587172p530847425";

export type Ga4PageMetrics = {
  activeUsers: number;
  engagementRate: number;     // 0..1
  avgEngagementTime: number;  // 秒/会话
  topCountries: { country: string; activeUsers: number }[];
};

export type Ga4FetchResult = {
  byPath: Map<string, Ga4PageMetrics>;
  sampledAny: boolean;  // 任一查询被 GA4 采样 → 数据近似
  failed: boolean;      // 采集失败（连接/接口/解析）→ sync 层应降级，GA4 字段留 NULL
};

// 近 28 天窗口：endDate = 昨天（今天数据未完整），startDate = 昨天往前 28 天。
function last28d(): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// 路径归一为「合并键」，统一 GA4 与 GSC 两侧口径，必须双方都过一次才能对齐：
//   1) 解码 percent-encoding —— GA4 的 page_path/landing_page 存的是【已解码】的原文
//      （如 /ar-خاتم-الذكر），而 GSC/快照存的是【百分号编码】（/ar-%D8%AE...）。
//      不解码 → 所有非 ASCII slug（阿拉伯语等本地化页）永远 miss。解码失败回退原串。
//   2) 尾斜杠归一（"/x/" → "/x"，根 "/" 保留）。
// 导出供 sync/loader 在 byPath.get(...) 前对 p.url 做同款归一 —— 两侧同函数才不会错位。
export function ga4PathKey(p: string): string {
  if (!p) return p;
  let s = p;
  try {
    s = decodeURIComponent(p);
  } catch {
    /* 含非法 % 转义 → 保留原串 */
  }
  return s.length > 1 && s.endsWith("/") ? s.replace(/\/+$/, "") : s;
}
const normPath = ga4PathKey;

// 复用已开的 GA4 tab（最不打扰用户：只在其上下文 fetch，不导航它）；没有则新开并 goto。
async function resolveGa4Tab(browser: Browser): Promise<{ page: Page; opened: boolean }> {
  const pages = await browser.pages();
  const existing = pages.find((p) => p.url().includes("analytics.google.com"));
  if (existing) return { page: existing, opened: false };
  const page = await browser.newPage();
  await page.goto("https://analytics.google.com/analytics/web/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  return { page, opened: true };
}

// 在页面上下文跑两次 venus 查询，返回原始行（派生/分组放到 Node 侧做）。
// 该函数体被序列化进浏览器执行 —— 只能用浏览器内可用的 API（fetch / document / JSON）。
async function pullRawInPage(
  page: Page,
  cfg: { propertyId: string; dataset: string; dimension: string; startDate: string; endDate: string }
): Promise<{
  metricRows: { path: string; activeUsers: number; engagedSessions: number; sessions: number; engagementDuration: number }[];
  countryRows: { path: string; country: string; activeUsers: number }[];
  sampled: boolean;
}> {
  return await page.evaluate(async (c) => {
    // 兼容垫片：tsx/esbuild 会给内部具名函数注入 __name(...) 包装，但该 helper 不存在于
    // 浏览器 evaluate 上下文 → 先在 global 兜一个恒等实现，避免 "__name is not defined"。
    (globalThis as unknown as { __name?: (f: unknown) => unknown }).__name ||= (f) => f;
    const xsrf = (document.cookie.match(/GA_XSRF_TOKEN=([^;]+)/) || [])[1] || "";
    const endpoint =
      `/analytics/app/data/v2/venus?accessmode=read&dataset=${encodeURIComponent(c.dataset)}&hl=zh_CN`;

    const post = async (metrics: string[], dims: string[]) => {
      const limit = 5000;
      let offset = 0;
      let sampled = false;
      const all: { dims: string[]; mets: number[] }[] = [];
      for (let guard = 0; guard < 25; guard++) {
        const body = {
          entity: { propertyId: c.propertyId, identityBlendingStrategy: 2 },
          requests: [{
            dimensions: dims.map((name, i) => ({ name, isSecondary: i > 0 })),
            dimensionFilters: [],
            metricFilters: [],
            metrics: metrics.map((name) => ({ name, isInvisible: false, isSecondary: false })),
            cardName: "ga4_pipeline", cardId: "ga4_pipeline",
            requestGrandTotal: false,
            dateRanges: [{ startDate: c.startDate, endDate: c.endDate }],
            rowAxis: {
              fieldNames: dims,
              sorts: [{ fieldName: metrics[0], sortType: 1, isDesc: true, pivotSortInfos: [] }],
              limit, offset, metaAggTypes: [],
            },
          }],
          guid: "ga4-pipeline",
        };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json;charset=UTF-8", "x-gafe4-xsrf-token": xsrf, accept: "application/json, text/plain, */*" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (!res.ok) throw new Error("venus HTTP " + res.status);
        const text = (await res.text()).replace(/^\)\]\}',?\s*/, "");
        const json = JSON.parse(text);
        const resp = json?.default?.responses?.[0];
        if (!resp) throw new Error("venus malformed response");
        if ((resp.numberOfSamplesRead || []).length > 0) sampled = true;
        const rr = resp.responseRows || [];
        for (const r of rr) {
          all.push({
            dims: (r.dimensionCompoundValues || []).map((d: { value: string }) => d.value),
            mets: (r.metricCompoundValues || []).map((m: { value: string | number }) => Number(m.value)),
          });
        }
        if (rr.length < limit) break;
        offset += limit;
      }
      return { rows: all, sampled };
    };

    const m = await post(["active_users", "engaged_sessions", "sessions", "user_engagement_duration"], [c.dimension]);
    const co = await post(["active_users"], [c.dimension, "country"]);

    return {
      metricRows: m.rows.map((r) => ({
        path: r.dims[0], activeUsers: r.mets[0] || 0, engagedSessions: r.mets[1] || 0,
        sessions: r.mets[2] || 0, engagementDuration: r.mets[3] || 0,
      })),
      countryRows: co.rows.map((r) => ({ path: r.dims[0], country: r.dims[1], activeUsers: r.mets[0] || 0 })),
      sampled: m.sampled || co.sampled,
    };
  }, cfg);
}

/**
 * 拉取全站 per-landing-page 的 GA4 指标。失败绝不抛，返回 failed=true。
 * @param opts.pathnames 可选，只保留这些 pathname 的结果（增量档用，省合并量）；省略=全部。
 */
export async function fetchGa4PageMetrics(opts?: {
  pathnames?: string[];
  dimension?: "landing_page" | "page_path";
  startDate?: string;
  endDate?: string;
  propertyId?: string;
  dataset?: string;
  cdpHost?: string;
  cdpPort?: number;
}): Promise<Ga4FetchResult> {
  const dimension = opts?.dimension ?? "landing_page";
  const propertyId = opts?.propertyId ?? DEFAULT_PROPERTY_ID;
  const dataset = opts?.dataset ?? DEFAULT_DATASET;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const win = last28d();
  const startDate = opts?.startDate ?? win.startDate;
  const endDate = opts?.endDate ?? win.endDate;

  const empty: Ga4FetchResult = { byPath: new Map(), sampledAny: false, failed: true };

  let browser: Browser | null = null;
  let openedPage: Page | null = null;
  try {
    browser = await connectBrowser(host, port);
    const { page, opened } = await resolveGa4Tab(browser);
    if (opened) openedPage = page;

    // 重试 1 次（venus 偶发 5xx / token 刷新）
    let raw: Awaited<ReturnType<typeof pullRawInPage>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2 && raw === null; attempt++) {
      try {
        raw = await pullRawInPage(page, { propertyId, dataset, dimension, startDate, endDate });
      } catch (e) {
        lastErr = e;
        raw = null;
      }
    }
    if (raw === null) {
      console.warn("[ga4-fetcher] venus pull failed:", (lastErr as Error)?.message);
      return empty;
    }

    // Node 侧：派生 + 按 page 分组国家取 Top10
    const wanted = opts?.pathnames ? new Set(opts.pathnames.map(normPath)) : null;

    const countriesByPath = new Map<string, { country: string; activeUsers: number }[]>();
    for (const r of raw.countryRows) {
      const p = normPath(r.path);
      if (!r.country) continue;
      const arr = countriesByPath.get(p) ?? [];
      arr.push({ country: r.country, activeUsers: r.activeUsers });
      countriesByPath.set(p, arr);
    }

    const byPath = new Map<string, Ga4PageMetrics>();
    for (const r of raw.metricRows) {
      const p = normPath(r.path);
      if (!p) continue;
      if (wanted && !wanted.has(p)) continue;
      const topCountries = (countriesByPath.get(p) ?? [])
        .sort((a, b) => b.activeUsers - a.activeUsers)
        .slice(0, 10);
      byPath.set(p, {
        activeUsers: r.activeUsers,
        engagementRate: r.sessions > 0 ? r.engagedSessions / r.sessions : 0,
        avgEngagementTime: r.sessions > 0 ? r.engagementDuration / r.sessions : 0,
        topCountries,
      });
    }

    return { byPath, sampledAny: raw.sampled, failed: false };
  } catch (e) {
    console.warn("[ga4-fetcher] fetch failed:", (e as Error)?.message);
    return empty;
  } finally {
    // 只关本函数自己新开的 tab；不动用户已有的 GA4 标签页；只 disconnect 不 close 浏览器。
    if (openedPage) {
      try { await openedPage.close(); } catch { /* ignore */ }
    }
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignore */ }
    }
  }
}
