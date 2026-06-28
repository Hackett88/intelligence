// GSC「网页索引编制 > 已编入索引」抓取器（用户工作流）。
//
// 工作前提：用户的 Chrome 已登录 GSC，并以 `--remote-debugging-port=9222` 启动。
// 本模块通过 CDP 接管这个浏览器实例，不会另起 Chromium，收尾也只 disconnect 不 close。
// —— 结构镜像 fetcher.ts(效果表)，连接原语复用 cdp.ts。
//
// 数据来源页：
//   /index/drilldown?resource_id=...&pages=ALL_URLS
// 实测：GSC 一次把全部已编入索引行（约 255 行）渲染到 `<table.i3WFpf tbody tr>`，
// "每页行数"只是 visual paging，DOM 已全员到齐，直接遍历 tbody 即可，无需翻页/滚动。
// 每行 2 个 td：td[0]=网址(纯文本含 https://，可能混入图标 a11y 文字)、td[1]=上次抓取日期。

import { type Browser, type Page } from "puppeteer-core";
import {
  DEFAULT_CDP_HOST,
  DEFAULT_CDP_PORT,
  connectBrowser,
} from "./cdp";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";

const drilldownUrl = (resourceId: string) =>
  `https://search.google.com/search-console/index/drilldown?` +
  `resource_id=${encodeURIComponent(resourceId)}&pages=ALL_URLS`;

// 优先复用已存在的 GSC tab（用户多半已经登录、看过数据），没有就新开一个。
async function resolveGscTab(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const existing = pages.find((p) =>
    p.url().includes("search.google.com/search-console")
  );
  return existing ?? (await browser.newPage());
}

export interface IndexedUrlRow {
  url: string;
  lastCrawled: string;
}

export async function fetchIndexedUrls(opts?: {
  resourceId?: string;
  cdpHost?: string;
  cdpPort?: number;
  timeoutMs?: number;
}): Promise<IndexedUrlRow[]> {
  const resourceId = opts?.resourceId ?? DEFAULT_PROPERTY;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  let browser: Browser | null = null;
  try {
    browser = await connectBrowser(host, port);
    const target = await resolveGscTab(browser);

    await target.bringToFront();
    await target.goto(drilldownUrl(resourceId), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // 等表格渲染：table.i3WFpf tbody 存在且有 tr
    await target.waitForFunction(
      () => {
        const tbody = document.querySelector("table.i3WFpf tbody");
        return !!tbody && tbody.children.length > 0;
      },
      { timeout: timeoutMs, polling: 500 }
    );

    // 遍历表格所有行
    const rows = await target.evaluate(() => {
      const tbody = document.querySelector("table.i3WFpf tbody");
      const trs = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
      return trs
        .map((tr) => {
          const tds = Array.from(tr.querySelectorAll("td"));
          // td[0] 的 textContent 可能把"复制网址 / 新标签页打开 / 检查网址"等
          // hover icon 的 a11y 文字一并塞进来 → 正则取第一个 http(s) URL（截到首个空白）。
          const cell0 = tds[0] ? tds[0].textContent || "" : "";
          const matched = cell0.match(/https?:\/\/\S+/);
          const url = matched ? matched[0] : "";
          const lastCrawled = tds[1] ? (tds[1].textContent || "").trim() : "";
          return { url, lastCrawled };
        })
        .filter((r) => /^https?:\/\//.test(r.url));
    });

    if (rows.length === 0) {
      throw new Error(
        `fetchIndexedUrls: 抓到 0 行已编入索引的 URL。请确认：` +
          `① Chrome 已以 --remote-debugging-port=${port} 启动；` +
          `② 已登录 GSC 且有 ${resourceId} 的访问权限；` +
          `③ 「网页索引编制 > 已编入索引」drilldown 报告(table.i3WFpf)可正常打开。`
      );
    }

    return rows;
  } finally {
    // 仅 disconnect，不 close —— 这是用户自己的 Chrome，留着别动
    if (browser) {
      try {
        await browser.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
