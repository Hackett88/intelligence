// GSC Performance > Pages 抓取器（用户工作流）
//
// 工作前提：用户的 Chrome 已经登录 GSC，并以 `--remote-debugging-port=9222`
// 启动（chrome-devtools MCP 已经这样起着）。本模块通过 CDP 接管这个
// 浏览器实例，不会另外起 Chromium。
//
// 数据来源页：
//   /performance/search-analytics?resource_id=...&breakdown=page
//     &metrics=CLICKS,IMPRESSIONS,CTR,POSITION
//
// 实测：GSC 一次把全部 N 行（这个站 265 行）渲染到 `<table.i3WFpf tbody tr>`，
// "每页行数"只是 visual paging，DOM 已经全员到齐。所以直接遍历 tbody 即可，
// 不需要切分页或滚动。

import { type Browser, type Page } from "puppeteer-core";
import {
  DEFAULT_CDP_HOST,
  DEFAULT_CDP_PORT,
  connectBrowser,
} from "./cdp";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";

const performanceUrl = (resourceId: string) =>
  `https://search.google.com/search-console/performance/search-analytics?` +
  `resource_id=${encodeURIComponent(resourceId)}` +
  `&breakdown=page&metrics=CLICKS%2CIMPRESSIONS%2CCTR%2CPOSITION`;

// query 维度 + 按"网页"精确过滤（page=!<exactUrl>）→ 拿该 URL 下的关键词排名。
// 实测同 page 视图：整表（最多 1000 行）全员渲染到 table.i3WFpf tbody，5 个 td：
// query / clicks / impressions / ctr / position；默认即按点击降序（"热门查询"）。
const queryByPageUrl = (resourceId: string, pageUrl: string) =>
  `https://search.google.com/search-console/performance/search-analytics?` +
  `resource_id=${encodeURIComponent(resourceId)}` +
  `&breakdown=query&metrics=CLICKS%2CIMPRESSIONS%2CCTR%2CPOSITION` +
  `&page=!${encodeURIComponent(pageUrl)}`;

// CDP 连接原语（connectBrowser / resolveBrowserWSEndpoint / chromeUserDataDir）已抽到
// ./cdp.ts，GSC 与 GA4 采集共享，避免两份逻辑漂移。

// 优先复用已存在的 GSC tab（用户多半已经在那里登录、看过数据），没有就新开一个。
async function resolveGscTab(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const existing = pages.find((p) =>
    p.url().includes("search.google.com/search-console")
  );
  return existing ?? (await browser.newPage());
}

export type GscPageRaw = {
  fullUrl: string;
  clicks: number;
  impressions: number;
  ctr: number;       // 0..1
  position: number;
};

// 单页关键词排名行（per-URL drill-down）
export type GscQueryRaw = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;       // 0..1
  position: number;
};

export type GscSummaryRaw = {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;       // 0..1
  avgPosition: number;
  freshnessText: string; // e.g. "上次更新日期：3小时前"
};

export type GscSnapshot = {
  propertyResourceId: string;
  fetchedAt: string;       // ISO 8601
  summary: GscSummaryRaw;
  pages: GscPageRaw[];
};

// ─── 解析工具（数字 / 百分比 / 中文计数单位） ───────────────────────────────
function parseCount(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return 0;
  // "1.2万" / "54万" → 万 = 10000
  if (/万$/.test(t)) return Math.round(parseFloat(t.replace(/[万,\s]/g, "")) * 10_000);
  if (/亿$/.test(t)) return Math.round(parseFloat(t.replace(/[亿,\s]/g, "")) * 100_000_000);
  // "1.2K" / "1.2M" — 英文版兼容
  if (/k$/i.test(t)) return Math.round(parseFloat(t.replace(/[k,\s]/gi, "")) * 1_000);
  if (/m$/i.test(t)) return Math.round(parseFloat(t.replace(/[m,\s]/gi, "")) * 1_000_000);
  const n = parseFloat(t.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(s: string): number {
  const n = parseFloat((s ?? "").replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? n / 100 : 0;
}

function parseFloat2(s: string): number {
  const n = parseFloat((s ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────
export async function fetchGscSnapshot(opts?: {
  resourceId?: string;
  cdpHost?: string;
  cdpPort?: number;
  timeoutMs?: number;
}): Promise<GscSnapshot> {
  const resourceId = opts?.resourceId ?? DEFAULT_PROPERTY;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  let browser: Browser | null = null;
  try {
    browser = await connectBrowser(host, port);
    const target = await resolveGscTab(browser);

    await target.bringToFront();
    await target.goto(performanceUrl(resourceId), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // 等表格渲染（含 "共 N 行" 文本 + table.i3WFpf 实际有 tbody > tr）
    await target.waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        const hasTotalText = /共\s*\d+\s*行/.test(body) || /of\s+\d+\s+rows/i.test(body);
        const tbody = document.querySelector("table.i3WFpf tbody");
        return hasTotalText && !!tbody && tbody.children.length > 0;
      },
      { timeout: timeoutMs, polling: 500 }
    );

    // 遍历表格 + 抓顶部汇总
    const raw = await target.evaluate(() => {
      // 表格行：table.i3WFpf tbody tr，5 个 td：URL / clicks / impr / ctr / position
      const tbody = document.querySelector("table.i3WFpf tbody");
      const trs = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
      const rows = trs
        .map((tr) => {
          const tds = Array.from(tr.querySelectorAll("td"));
          // URL 在第一个 td 的最深层 span 里；textContent 会把"复制网址 / 新标签页打开 / 检查网址"
          // 这些 hover icon 的 a11y 文字一并塞进来，所以取第一个空格之前的部分。
          const urlRaw = tds[0] ? (tds[0].textContent || "").trim() : "";
          const url = urlRaw.split(/\s/)[0] ?? "";
          return {
            url,
            clicks: tds[1] ? (tds[1].textContent || "").trim() : "",
            impressions: tds[2] ? (tds[2].textContent || "").trim() : "",
            ctr: tds[3] ? (tds[3].textContent || "").trim() : "",
            position: tds[4] ? (tds[4].textContent || "").trim() : "",
          };
        })
        .filter((r) => r.url && /^https?:\/\//.test(r.url));

      // 顶部 4 张汇总卡：DOM 里是 "<label-span>总点击次数</label-span><value-span>7840</value-span>"
      // 拼起来 textContent 就是 "总点击次数7840"。直接 regex 切。
      function extract(label: string, labelEn?: string): string {
        const all = document.body.innerText;
        const reCN = new RegExp(label + "\\s*([0-9.,万亿KkMm%]+)");
        const m1 = all.match(reCN);
        if (m1 && m1[1]) return m1[1];
        if (labelEn) {
          const reEN = new RegExp(labelEn + "\\s*([0-9.,KkMm%]+)", "i");
          const m2 = all.match(reEN);
          if (m2 && m2[1]) return m2[1];
        }
        return "";
      }

      const summary = {
        totalClicks: extract("总点击次数", "Total clicks"),
        totalImpressions: extract("总曝光次数", "Total impressions"),
        avgCtr: extract("平均点击率", "Average CTR"),
        avgPosition: extract("平均排名", "Average position"),
      };

      const freshness =
        (document.body.innerText.match(/上次更新日期：[^\n]+/) ||
          document.body.innerText.match(/Last updated:[^\n]+/i) ||
          [])[0] || "";

      const totalLine =
        (document.body.innerText.match(/共\s*(\d+)\s*行/) ||
          document.body.innerText.match(/of\s+(\d+)\s+rows/i) ||
          [])[1] || String(rows.length);

      return { rows, summary, freshness, totalLine: parseInt(totalLine, 10) };
    });

    const pagesRaw: GscPageRaw[] = raw.rows.map((r) => ({
      fullUrl: r.url,
      clicks: parseCount(r.clicks),
      impressions: parseCount(r.impressions),
      ctr: parsePercent(r.ctr),
      position: parseFloat2(r.position),
    }));

    const summary: GscSummaryRaw = {
      totalClicks: parseCount(raw.summary.totalClicks),
      totalImpressions: parseCount(raw.summary.totalImpressions),
      avgCtr: parsePercent(raw.summary.avgCtr),
      avgPosition: parseFloat2(raw.summary.avgPosition),
      freshnessText: raw.freshness,
    };

    // 健康检查：DOM 抓到的行数 vs 表格自报"共 N 行"，差太多说明列错位或 lazy render
    if (
      pagesRaw.length === 0 ||
      (raw.totalLine > 0 && pagesRaw.length < Math.min(raw.totalLine, 200) * 0.9)
    ) {
      throw new Error(
        `GSC 抓取数据条数异常：DOM ${pagesRaw.length} 行 vs 表格自报 ${raw.totalLine} 行`
      );
    }

    return {
      propertyResourceId: resourceId,
      fetchedAt: new Date().toISOString(),
      summary,
      pages: pagesRaw,
    };
  } finally {
    // 仅 disconnect，不 close —— 这是用户自己的 Chrome，留着别动
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignore */ }
    }
  }
}

// ─── 单页关键词排名抓取（共享核心） ──────────────────────────────────────────
// 把某个已有的 page 导航到"query 维度 + page=!<fullUrl> 精确过滤"，抓回 top N。
// 该页没有任何 query（零曝光 / 过滤无命中）时优雅返回空数组，不抛错。
async function navigateAndScrapeQueries(
  page: Page,
  resourceId: string,
  pageUrl: string,
  timeoutMs: number,
  limit: number
): Promise<{ queries: GscQueryRaw[]; totalRows: number }> {
  await page.goto(queryByPageUrl(resourceId, pageUrl), {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  // 等表格出行；等不到（确实无 query / 渲染超时）→ 当空结果。
  // 关键：有 query 的页几秒内就渲染出表格，没有 query 的页永远不会出。所以这里
  // 用一个"短得多"的等待预算（默认 20s，且不超过整体 timeout），避免零-query 页
  // 每个都白等满整段 timeout —— 这是全量同步耗时的主要来源。
  // 注：日更只爬"已知有数据"的页，几乎不碰零-query 页；20s 主要在月度全量时生效。
  const tableWaitMs = Math.min(timeoutMs, 20_000);
  let hasRows = true;
  try {
    await page.waitForFunction(
      () => {
        const tbody = document.querySelector("table.i3WFpf tbody");
        return !!tbody && tbody.children.length > 0;
      },
      { timeout: tableWaitMs, polling: 400 }
    );
  } catch {
    hasRows = false;
  }
  if (!hasRows) return { queries: [], totalRows: 0 };

  // 校验当前页面的过滤器确实是目标 URL（并发多 tab 时防错位 / SPA 残留旧表）
  const raw = await page.evaluate((expectUrl: string) => {
    const filterMatch = document.body.innerText.match(/网页：(https?:\/\/[^\s]+)/);
    const pageFilter = filterMatch ? filterMatch[1] : null;
    const tbody = document.querySelector("table.i3WFpf tbody");
    const trs = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
    const rows = trs
      .map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td"));
        // query 维度第 1 个 td 是查询词本身，含空格，直接 trim（不像 URL 那样切空格）
        return {
          query: tds[0] ? (tds[0].textContent || "").trim() : "",
          clicks: tds[1] ? (tds[1].textContent || "").trim() : "",
          impressions: tds[2] ? (tds[2].textContent || "").trim() : "",
          ctr: tds[3] ? (tds[3].textContent || "").trim() : "",
          position: tds[4] ? (tds[4].textContent || "").trim() : "",
        };
      })
      .filter((r) => r.query);
    const totalLine =
      (document.body.innerText.match(/共\s*(\d+)\s*行/) ||
        document.body.innerText.match(/of\s+(\d+)\s+rows/i) ||
        [])[1] || String(rows.length);
    return { rows, totalLine: parseInt(totalLine, 10), pageFilter, expectUrl };
  }, pageUrl);

  // 过滤器与目标不符（SPA 还没切过来）→ 视为本次未取到，返回空让上层决定是否重试
  if (raw.pageFilter && raw.pageFilter !== pageUrl) {
    return { queries: [], totalRows: 0 };
  }

  const queries: GscQueryRaw[] = raw.rows
    .map((r) => ({
      query: r.query,
      clicks: parseCount(r.clicks),
      impressions: parseCount(r.impressions),
      ctr: parsePercent(r.ctr),
      position: parseFloat2(r.position),
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);

  return { queries, totalRows: Number.isFinite(raw.totalLine) ? raw.totalLine : queries.length };
}

// ─── 单页关键词排名（按需拉取，复用用户的 GSC tab） ──────────────────────────
export async function fetchPageQueries(opts: {
  pageUrl: string;
  resourceId?: string;
  cdpHost?: string;
  cdpPort?: number;
  timeoutMs?: number;
  limit?: number;
}): Promise<{ queries: GscQueryRaw[]; totalRows: number }> {
  const resourceId = opts.resourceId ?? DEFAULT_PROPERTY;
  const host = opts.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts.cdpPort ?? DEFAULT_CDP_PORT;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const limit = opts.limit ?? 25;

  if (!/^https?:\/\//.test(opts.pageUrl)) {
    throw new Error(`fetchPageQueries: pageUrl 必须是完整 URL，收到 "${opts.pageUrl}"`);
  }

  let browser: Browser | null = null;
  try {
    browser = await connectBrowser(host, port);
    const target = await resolveGscTab(browser);
    await target.bringToFront();
    return await navigateAndScrapeQueries(target, resourceId, opts.pageUrl, timeoutMs, limit);
  } finally {
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignore */ }
    }
  }
}

// ─── 全站批量：一次同步抓所有页面的关键词排名 ────────────────────────────────
// 单次 CDP 连接，开 `concurrency` 个后台 tab 跑队列；每个 URL 抓 top `limit`。
// 单页失败（超时 / 过滤错位）重试一次，仍失败记空数组，绝不让整批挂掉。
// 收尾只关掉本函数自己开的 tab，不动用户原有的标签页。
export async function fetchAllPageQueries(
  pageUrls: string[],
  opts?: {
    resourceId?: string;
    cdpHost?: string;
    cdpPort?: number;
    timeoutMs?: number;
    limit?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<{ byUrl: Map<string, GscQueryRaw[]>; failures: string[] }> {
  const resourceId = opts?.resourceId ?? DEFAULT_PROPERTY;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const limit = opts?.limit ?? 25;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));

  const urls = pageUrls.filter((u) => /^https?:\/\//.test(u));
  const byUrl = new Map<string, GscQueryRaw[]>();
  const failures: string[] = [];
  if (urls.length === 0) return { byUrl, failures };

  let browser: Browser | null = null;
  const createdPages: Page[] = [];
  try {
    browser = await connectBrowser(host, port);

    const poolSize = Math.min(concurrency, urls.length);
    for (let i = 0; i < poolSize; i++) {
      createdPages.push(await browser.newPage());
    }

    let cursor = 0;
    let done = 0;
    const total = urls.length;

    const worker = async (page: Page) => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const myIdx = cursor++;
        if (myIdx >= urls.length) break;
        const url = urls[myIdx];
        let got: GscQueryRaw[] | null = null;
        for (let attempt = 0; attempt < 2 && got === null; attempt++) {
          try {
            const { queries } = await navigateAndScrapeQueries(
              page, resourceId, url, timeoutMs, limit
            );
            got = queries;
          } catch {
            got = null; // 重试一次
          }
        }
        if (got === null) {
          failures.push(url);
          byUrl.set(url, []);
        } else {
          byUrl.set(url, got);
        }
        done++;
        opts?.onProgress?.(done, total);
      }
    };

    await Promise.all(createdPages.map((p) => worker(p)));
    return { byUrl, failures };
  } finally {
    // 只关本函数开的 tab
    for (const p of createdPages) {
      try { await p.close(); } catch { /* ignore */ }
    }
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignore */ }
    }
  }
}
