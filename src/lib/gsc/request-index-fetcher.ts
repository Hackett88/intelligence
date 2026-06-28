// GSC「请求编入索引 / Request indexing」代驾器（用户工作流：新建页面后让 Google 立即抓取）。
//
// 工作前提：用户的 Chrome 已登录 GSC，并以 `--remote-debugging-port=9222` 启动。
// 本模块通过 CDP 接管这个浏览器实例，不另起 Chromium，收尾只 disconnect 不 close。
// —— 连接原语复用 cdp.ts；导航/检查框/裁决等待逻辑镜像 index-inspection-fetcher.ts
//    （那些 helper 在该文件里是私有的、不可 import，本任务边界又限定"只新增本文件"，故在此
//     按同一套已实测的写法镜像一份，只在末尾加"点请求编入索引"这一步）。
//
// 为什么必须走 UI 而非官方 API：URL Inspection API 是只读的（只能查收录状态），官方没有
// 公开的「为任意网页请求编入索引」接口（Indexing API 仅限 JobPosting/BroadcastEvent 结构化
// 数据）。要对普通页面触发"请求编入索引"，只能驱动 GSC 网址检查页的按钮——这正是本模块存在的理由。
//
// 流程（镜像 index-inspection-fetcher 的前半段 + 新增点击）：
//   1) CDP 连本地 Chrome（9222）→ 复用已有 GSC 标签（无则新开并 goto GSC 首页）。
//   2) 顶栏检查框输入完整 URL → Enter → 等结果页切换（&id 变新值）→ 等检查完成（裁决/请求按钮出现）。
//   3) 若已收录 → 直接判 already_indexed（不点，省每日配额）。
//   4) 否则找「请求编入索引 / Request indexing」可点元素并点击。
//   5) 等结果：已请求编入索引/Indexing requested → requested；实时测试对话框出现亦视为 requested
//      （点击已生效、请求流程已启动）；配额用尽 → quota_exceeded；可见 reCAPTCHA → captcha；
//      识别不到按钮/超时 → failed（如实，绝不假装成功）。
//
// reCAPTCHA 判定与 index-inspection-fetcher 一致：顶层常挂 v3 隐形徽标（anchor）不算阻断；
// 只有可见的交互式挑战 iframe（api2/bframe）才算阻断。

import { type Browser, type Page } from "puppeteer-core";
import { DEFAULT_CDP_HOST, DEFAULT_CDP_PORT, connectBrowser } from "./cdp";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";
const INSPECT_BOX_SELECTOR = 'input[role="combobox"]';

// 各阶段超时（单 URL 操作，故可给得比批量检查宽裕）。
const COMBOBOX_TIMEOUT_MS = 15_000;
const NEW_RESULT_TIMEOUT_MS = 20_000;
const VERDICT_TIMEOUT_MS = 60_000; // 等"检查完成"（裁决/请求按钮出现），GSC 实时查询常 20-50s
const BUTTON_POLL_TIMEOUT_MS = 10_000; // 裁决出现后再等请求按钮渲染
// 点击「请求编入索引」后，GSC 跑实时测试 + 入队，最终弹「已请求编入索引」对话框——整个过程
// 常需 15-90s（实测 /help ≈ 20s+）。故统一用一个宽裕的长轮询等终态，不靠"是否先看到进度对话框"
// 来决定要不要继续等（GSC 进度文案不稳，曾因没匹配上而过早放弃）。
const OUTCOME_TIMEOUT_MS = 120_000;

// 裁决主文案候选（中 / 英）——用于"等检查完成"。与 index-inspection-fetcher 对齐并补"未知"态。
const VERDICT_PHRASES = [
  "网址已收录到 Google",
  "此网址已显示在 Google 搜索结果中，但有问题",
  "URL is on Google, but has issues",
  "URL is on Google",
  "网址未收录到 Google",
  "网址不在 Google 上",
  "URL is not on Google",
  "URL is not available to Google",
  "Google 无法识别此网址",
  "URL is unknown to Google",
];

// 「请求编入索引」可点元素的文案（中 / 英，小写匹配）。
const REQUEST_PHRASES = ["请求编入索引", "request indexing"];

export interface RequestIndexResult {
  url: string;
  status: "requested" | "already_indexed" | "captcha" | "quota_exceeded" | "failed";
  message: string;
}

export interface RequestIndexOptions {
  resourceId?: string;
  cdpHost?: string;
  cdpPort?: number;
  verdictTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 优先复用已存在的 GSC tab（用户多半已登录、看过数据），没有则新开并 goto GSC 首页。
// 镜像 index-inspection-fetcher.resolveGscTab。
async function resolveGscTab(
  browser: Browser,
  resourceId: string
): Promise<{ page: Page; opened: boolean }> {
  const pages = await browser.pages();
  const existing = pages.find((p) =>
    p.url().includes("search.google.com/search-console")
  );
  if (existing) return { page: existing, opened: false };
  const page = await browser.newPage();
  await page.goto(
    `https://search.google.com/search-console/overview?resource_id=${encodeURIComponent(resourceId)}`,
    { waitUntil: "domcontentloaded", timeout: 45_000 }
  );
  return { page, opened: true };
}

// 读 URL 当前的结果 id（每次实时查询 GSC 会写一个新的 &id=<opaque>）。镜像 index-inspection-fetcher。
async function currentId(page: Page): Promise<string> {
  return page.evaluate(
    () => new URLSearchParams(location.search).get("id") || ""
  );
}

// 聚焦检查框 → 全选删空 → 输入完整 URL → Enter。镜像 index-inspection-fetcher。
async function typeAndSubmit(page: Page, url: string): Promise<void> {
  await page.click(INSPECT_BOX_SELECTOR);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(INSPECT_BOX_SELECTOR, url, { delay: 15 });
  await page.keyboard.press("Enter");
}

// 等"结果页切换"：URL 的 id 变成新值。镜像 index-inspection-fetcher。
async function waitNewResult(
  page: Page,
  prevId: string,
  timeoutMs: number
): Promise<void> {
  await page.waitForFunction(
    (prev: string) => {
      const id = new URLSearchParams(location.search).get("id") || "";
      return id !== "" && id !== prev;
    },
    { timeout: timeoutMs, polling: 500 },
    prevId
  );
}

// 等"检查完成"：裁决文案出现 OR「请求编入索引」按钮出现 OR 可见 reCAPTCHA 挑战。
// 用"按钮出现"作主就绪信号——它在已收录/未收录两种状态下都会渲染，最贴近"可以动手了"。
async function waitInspectionReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    (args: { verdictPhrases: string[]; requestPhrases: string[] }) => {
      const text = (document.body && document.body.innerText) || "";

      // 「请求编入索引」可点元素是否已出现
      const phr = args.requestPhrases;
      const els = Array.from(
        document.querySelectorAll('a,button,[role="button"],span,div')
      );
      const hasButton = els.some((el) => {
        const t = (el.textContent || "").trim();
        if (!t || t.length > 40) return false;
        const tl = t.toLowerCase();
        return phr.some((p) => tl.includes(p));
      });
      if (hasButton) return true;

      // 裁决文案是否出现
      if (args.verdictPhrases.some((p) => text.includes(p))) return true;

      // 可见 reCAPTCHA 交互挑战（bframe）
      const bframe = Array.from(document.querySelectorAll("iframe")).find((f) =>
        /recaptcha\/api2\/bframe/.test(f.getAttribute("src") || "")
      );
      if (bframe) {
        let visible = true;
        let el: Element | null = bframe;
        for (let i = 0; i < 5 && el; i++) {
          const s = getComputedStyle(el);
          if (
            s.visibility === "hidden" ||
            s.display === "none" ||
            parseFloat(s.opacity || "1") === 0
          ) {
            visible = false;
            break;
          }
          el = el.parentElement;
        }
        if (visible) {
          const rect = bframe.getBoundingClientRect();
          if (rect.width >= 50 && rect.height >= 50) return true;
        }
      }

      return false;
    },
    { timeout: timeoutMs, polling: 800 },
    { verdictPhrases: VERDICT_PHRASES, requestPhrases: REQUEST_PHRASES }
  );
}

// 读检查页状态：是否已收录、是否有请求按钮、是否撞可见挑战。
async function readInspectionState(page: Page): Promise<{
  indexedTrue: boolean;
  hasButton: boolean;
  challenge: boolean;
}> {
  return page.evaluate((requestPhrases: string[]) => {
    const text = (document.body && document.body.innerText) || "";
    const lower = text.toLowerCase();

    // 已收录裁决（仅判 true 即可短路 already_indexed；其余一律进入"请求"流程）
    const indexedTrue =
      text.includes("网址已收录到 Google") ||
      text.includes("已显示在 Google 搜索结果中") ||
      lower.includes("url is on google");

    // 请求按钮是否存在
    const els = Array.from(
      document.querySelectorAll('a,button,[role="button"],span,div')
    );
    const hasButton = els.some((el) => {
      const t = (el.textContent || "").trim();
      if (!t || t.length > 40) return false;
      const tl = t.toLowerCase();
      return requestPhrases.some((p) => tl.includes(p));
    });

    // 可见 reCAPTCHA 挑战
    let challenge = false;
    const bframe = Array.from(document.querySelectorAll("iframe")).find((f) =>
      /recaptcha\/api2\/bframe/.test(f.getAttribute("src") || "")
    );
    if (bframe) {
      challenge = true;
      let el: Element | null = bframe;
      for (let i = 0; i < 5 && el; i++) {
        const s = getComputedStyle(el);
        if (
          s.visibility === "hidden" ||
          s.display === "none" ||
          parseFloat(s.opacity || "1") === 0
        ) {
          challenge = false;
          break;
        }
        el = el.parentElement;
      }
      if (challenge) {
        const rect = bframe.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) challenge = false;
      }
    }

    return { indexedTrue, hasButton, challenge };
  }, REQUEST_PHRASES);
}

// 找到「请求编入索引」可点元素并点击。返回是否点到。
// 取文案最短的命中元素（= 最贴近叶子的真链接），再向上找最近的 a/button/[role=button] 祖先点击，
// 找不到祖先则点叶子本身（click 事件会冒泡到 Material 的处理器）。
async function clickRequestButton(page: Page): Promise<boolean> {
  return page.evaluate((requestPhrases: string[]) => {
    const els = Array.from(
      document.querySelectorAll('a,button,[role="button"],span,div')
    );
    let best: Element | null = null;
    let bestLen = Infinity;
    for (const el of els) {
      const t = (el.textContent || "").trim();
      if (!t || t.length > 40) continue;
      const tl = t.toLowerCase();
      if (requestPhrases.some((p) => tl.includes(p))) {
        if (t.length < bestLen) {
          best = el;
          bestLen = t.length;
        }
      }
    }
    if (!best) return false;

    // 向上找最近的可点祖先
    let target: Element | null = best;
    for (let i = 0; i < 6 && target; i++) {
      const tag = target.tagName ? target.tagName.toLowerCase() : "";
      const role = target.getAttribute ? target.getAttribute("role") : null;
      if (tag === "a" || tag === "button" || role === "button") break;
      target = target.parentElement;
    }
    (target || best).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    return true;
  }, REQUEST_PHRASES);
}

// 读点击后的结果态：成功 / 配额用尽 / 实时测试对话框（中间态）/ 可见挑战。
// 检测逻辑集中在此一处，waitRequestOutcome 反复调用它（避免把判定分散进多个 waitForFunction 谓词）。
// 取文本时显式并入 cdk-overlay / [role=dialog] 内容——「已请求编入索引」成功文案渲染在浮层对话框里，
// 不能只看 body.innerText（实测它确实出现在浮层，故并入以求稳）。
async function readRequestOutcome(page: Page): Promise<{
  success: boolean;
  quota: boolean;
  dialog: boolean;
  challenge: boolean;
}> {
  return page.evaluate(() => {
    const bodyText = (document.body && document.body.innerText) || "";
    const overlays = Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container, [role="dialog"], [role="alertdialog"]'
      )
    );
    let overlayText = "";
    for (const o of overlays) overlayText += "\n" + ((o as HTMLElement).innerText || "");
    const text = bodyText + "\n" + overlayText;
    const lower = text.toLowerCase();

    // 成功："已请求编入索引" / "Indexing requested" / "已添加到优先抓取队列"
    const success =
      text.includes("已请求编入索引") ||
      text.includes("已添加到优先抓取队列") ||
      text.includes("已加入优先抓取队列") ||
      lower.includes("indexing requested") ||
      lower.includes("priority crawl queue");

    // 配额用尽（GSC 每日 request indexing 限额）——文案多变，用"配额/quota + 触发词"复合判定。
    const quota =
      (text.includes("配额") &&
        (text.includes("超出") ||
          text.includes("改日") ||
          text.includes("上限") ||
          text.includes("已用完") ||
          text.includes("明天") ||
          text.includes("达到"))) ||
      (lower.includes("quota") &&
        (lower.includes("exceed") ||
          lower.includes("reached") ||
          lower.includes("tomorrow") ||
          lower.includes("limit") ||
          lower.includes("run out")));

    // 实时测试 / 请求进行中对话框（中间态）：点击已生效、请求流程已启动。
    const dialog =
      text.includes("正在请求编入索引") ||
      text.includes("正在测试网址") ||
      text.includes("正在测试此网址") ||
      text.includes("正在检查网址") ||
      lower.includes("requesting indexing") ||
      lower.includes("testing if live") ||
      lower.includes("testing whether");

    // 可见 reCAPTCHA 挑战
    let challenge = false;
    const bframe = Array.from(document.querySelectorAll("iframe")).find((f) =>
      /recaptcha\/api2\/bframe/.test(f.getAttribute("src") || "")
    );
    if (bframe) {
      challenge = true;
      let el: Element | null = bframe;
      for (let i = 0; i < 5 && el; i++) {
        const s = getComputedStyle(el);
        if (
          s.visibility === "hidden" ||
          s.display === "none" ||
          parseFloat(s.opacity || "1") === 0
        ) {
          challenge = false;
          break;
        }
        el = el.parentElement;
      }
      if (challenge) {
        const rect = bframe.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) challenge = false;
      }
    }

    return { success, quota, dialog, challenge };
  });
}

// 点击后等终态：轮询直到 成功/配额/可见挑战 命中，或超时。
// 全程记录是否一度出现过"进度对话框"（sawDialog）——仅用于超时兜底：若终态没等到、但确实见过
// 请求进度对话框，则判定请求已触发（requested，但如实标注未捕获最终文案）。
async function waitRequestOutcome(
  page: Page,
  timeoutMs: number
): Promise<{ success: boolean; quota: boolean; challenge: boolean; sawDialog: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let sawDialog = false;
  while (Date.now() < deadline) {
    const o = await readRequestOutcome(page);
    if (o.dialog) sawDialog = true;
    if (o.success || o.quota || o.challenge) {
      return { success: o.success, quota: o.quota, challenge: o.challenge, sawDialog };
    }
    await sleep(1000);
  }
  return { success: false, quota: false, challenge: false, sawDialog };
}

/**
 * 对单个 URL 在 GSC 网址检查页执行「请求编入索引」。
 *
 * - 单次 CDP 连接；复用已有 GSC 标签（无则新开并 goto GSC 首页）。
 * - 已收录 → already_indexed（不点击，省每日配额）。
 * - 撞可见 reCAPTCHA → captcha（提示人工去浏览器完成验证码）。
 * - 配额用尽 → quota_exceeded。
 * - 找不到按钮 / 各阶段超时 → failed（如实记录原因，绝不假装成功）。
 * - 永不抛：所有已知失败都收敛为 status:"failed" 的结构化结果（含 9222 连不上）；finally 只
 *   disconnect 不 close，且只关本函数自己新开的标签。
 */
export async function requestIndexing(
  url: string,
  opts?: RequestIndexOptions
): Promise<RequestIndexResult> {
  if (!/^https?:\/\//.test(url)) {
    return { url, status: "failed", message: "无效 URL（需以 http(s):// 开头）" };
  }

  const resourceId = opts?.resourceId ?? DEFAULT_PROPERTY;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const verdictTimeoutMs = opts?.verdictTimeoutMs ?? VERDICT_TIMEOUT_MS;

  let browser: Browser | null = null;
  let openedPage: Page | null = null;
  try {
    try {
      browser = await connectBrowser(host, port);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return {
        url,
        status: "failed",
        message: `无法连接本地 Chrome 调试端口（${host}:${port}）：${reason}。请确认 Chrome 已以 --remote-debugging-port=${port} 启动并已登录 GSC。`,
      };
    }

    const { page, opened } = await resolveGscTab(browser, resourceId);
    if (opened) openedPage = page;
    await page.bringToFront();

    // ── 提交检查 + 确认结果页切换（镜像 index-inspection-fetcher 的智能重试） ──
    await page.waitForSelector(INSPECT_BOX_SELECTOR, { timeout: COMBOBOX_TIMEOUT_MS });
    let prevId = await currentId(page);
    await typeAndSubmit(page, url);
    try {
      await waitNewResult(page, prevId, NEW_RESULT_TIMEOUT_MS);
    } catch {
      // 没切换 = 提交没生效 → 重提交一次
      prevId = await currentId(page);
      await typeAndSubmit(page, url);
      await waitNewResult(page, prevId, NEW_RESULT_TIMEOUT_MS);
    }

    // ── 等检查完成（裁决/请求按钮出现）；首轮超时不重提交，对同一在飞查询再等一轮（覆盖慢页） ──
    try {
      await waitInspectionReady(page, verdictTimeoutMs);
    } catch {
      await waitInspectionReady(page, verdictTimeoutMs);
    }
    await sleep(400); // 结果区轻微 settle

    const state = await readInspectionState(page);

    if (state.challenge) {
      return {
        url,
        status: "captcha",
        message:
          "检查页出现 reCAPTCHA 人机验证挑战，无法自动请求编入索引。请到浏览器手动完成验证码后重试。",
      };
    }

    if (state.indexedTrue) {
      return {
        url,
        status: "already_indexed",
        message: "该网址已收录到 Google，无需请求编入索引。",
      };
    }

    // ── 找请求按钮（裁决出现后可能略晚渲染，给一小段轮询预算） ──
    let hasButton = state.hasButton;
    if (!hasButton) {
      const deadline = Date.now() + BUTTON_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(600);
        const s = await readInspectionState(page);
        if (s.challenge) {
          return {
            url,
            status: "captcha",
            message:
              "检查页出现 reCAPTCHA 人机验证挑战，无法自动请求编入索引。请到浏览器手动完成验证码后重试。",
          };
        }
        if (s.indexedTrue) {
          return {
            url,
            status: "already_indexed",
            message: "该网址已收录到 Google，无需请求编入索引。",
          };
        }
        if (s.hasButton) {
          hasButton = true;
          break;
        }
      }
    }

    if (!hasButton) {
      return {
        url,
        status: "failed",
        message:
          "未在检查页找到「请求编入索引 / Request indexing」按钮（可能检查未完成、GSC 改版，或该页状态不支持请求）。",
      };
    }

    // ── 点击请求按钮 ──
    const clicked = await clickRequestButton(page);
    if (!clicked) {
      return {
        url,
        status: "failed",
        message: "定位到请求按钮但点击未生效，未能触发请求编入索引。",
      };
    }

    // ── 等结果：单个长轮询等终态（成功/配额/挑战）；GSC 实时测试+入队常 15-90s ──
    const outcome = await waitRequestOutcome(page, OUTCOME_TIMEOUT_MS);

    if (outcome.challenge) {
      return {
        url,
        status: "captcha",
        message:
          "点击请求编入索引后出现 reCAPTCHA 人机验证挑战。请到浏览器手动完成验证码后重试。",
      };
    }
    if (outcome.quota) {
      return {
        url,
        status: "quota_exceeded",
        message:
          "已超出 GSC「请求编入索引」每日配额（每属性约 12 次/天），请改日再试。",
      };
    }
    if (outcome.success) {
      return {
        url,
        status: "requested",
        message: "已成功请求编入索引（网址已加入 Google 优先抓取队列）。",
      };
    }
    if (outcome.sawDialog) {
      // 进度对话框出现过、但未在预算内捕获最终文案：点击已生效、请求流程已启动 → 记 requested，
      // 但如实标注未捕获最终确认文案，提示去浏览器确认。
      return {
        url,
        status: "requested",
        message:
          "已触发请求编入索引（请求进度对话框已出现），但未在超时内捕获到「已请求编入索引」最终文案。请到浏览器确认结果。",
      };
    }

    // 点击后既无对话框也无结果文案 → 如实记 failed，不假装成功。
    return {
      url,
      status: "failed",
      message:
        "点击「请求编入索引」后未观测到进度对话框或结果文案（可能按钮未真正触发或 GSC 改版），无法确认是否已提交。",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { url, status: "failed", message: `请求编入索引过程出错：${reason}` };
  } finally {
    // 只关本函数自己新开的 tab；不动用户已有标签；只 disconnect 不 close 浏览器。
    if (openedPage) {
      try {
        await openedPage.close();
      } catch {
        /* ignore */
      }
    }
    if (browser) {
      try {
        await browser.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
