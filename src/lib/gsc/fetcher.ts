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

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";
const DEFAULT_CDP_HOST = "127.0.0.1";
const DEFAULT_CDP_PORT = 9222;

const performanceUrl = (resourceId: string) =>
  `https://search.google.com/search-console/performance/search-analytics?` +
  `resource_id=${encodeURIComponent(resourceId)}` +
  `&breakdown=page&metrics=CLICKS%2CIMPRESSIONS%2CCTR%2CPOSITION`;

// 解析 Chrome 的 wsEndpoint。
//
// Chrome 148+ 默认禁用了 HTTP discovery 端点（/json/version 返回 404），puppeteer
// 的传统 `browserURL` 拿 wsEndpoint 的方式就失效了。但 Chrome 启动时仍会把当前
// 的 wsPath 写到 `<user-data-dir>/DevToolsActivePort`，格式：
//   9222
//   /devtools/browser/<uuid>
// 我们直接读该文件构造 ws URL，跳过 HTTP discovery。
function chromeUserDataDir(): string[] {
  // 允许通过环境变量覆盖；按 OS 给默认路径，多个候选都试一遍。
  const env = process.env.CHROME_USER_DATA_DIR;
  if (env) return [env];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(local, "Google", "Chrome", "User Data"),
      path.join(local, "Google", "Chrome Beta", "User Data"),
      path.join(local, "Chromium", "User Data"),
    ];
  }
  if (process.platform === "darwin") {
    const home = os.homedir();
    return [
      path.join(home, "Library", "Application Support", "Google", "Chrome"),
      path.join(home, "Library", "Application Support", "Chromium"),
    ];
  }
  // linux
  const home = os.homedir();
  return [
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".config", "chromium"),
  ];
}

async function resolveBrowserWSEndpoint(host: string, port: number): Promise<string> {
  // 先尝试老的 HTTP discovery（Chrome 旧版 / 非默认安全策略下还可用）
  try {
    const res = await fetch(`http://${host}:${port}/json/version`, {
      headers: { Host: "localhost" },
    });
    if (res.ok) {
      const data = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (data?.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    }
  } catch {
    // 不输出，继续走 DevToolsActivePort
  }

  // Fallback：读 DevToolsActivePort
  const candidates = chromeUserDataDir().map((d) => path.join(d, "DevToolsActivePort"));
  for (const file of candidates) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const [portLine, wsPath] = content.split("\n");
      const filePort = parseInt(portLine?.trim() || "", 10);
      if (filePort !== port) continue; // 跨 profile 时端口可能不一致
      if (!wsPath?.startsWith("/devtools/browser/")) continue;
      return `ws://${host}:${port}${wsPath.trim()}`;
    } catch {
      // 该文件不存在 / 没权限，试下一个
    }
  }
  throw new Error(
    `无法解析 Chrome wsEndpoint：${host}:${port} 的 /json/version 不响应，且 DevToolsActivePort 文件未找到。` +
      `请确认 Chrome 已以 --remote-debugging-port=${port} 启动，或设置环境变量 CHROME_USER_DATA_DIR。`
  );
}

export type GscPageRaw = {
  fullUrl: string;
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
    const browserWSEndpoint = await resolveBrowserWSEndpoint(host, port);
    browser = await puppeteer.connect({ browserWSEndpoint, defaultViewport: null });

    // 优先复用已存在的 GSC tab（用户可能已经在那里登录、在那里看过数据）
    const pages = await browser.pages();
    let target: Page | undefined = pages.find((p) =>
      p.url().includes("search.google.com/search-console")
    );
    if (!target) target = await browser.newPage();

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
