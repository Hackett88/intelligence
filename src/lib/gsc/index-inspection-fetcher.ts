// GSC「网址检查 / URL Inspection」逐页实时收录状态取数器（用户工作流）。
//
// 工作前提：用户的 Chrome 已登录 GSC，并以 `--remote-debugging-port=9222` 启动。
// 本模块通过 CDP 接管这个浏览器实例，不另起 Chromium，收尾只 disconnect 不 close。
// —— 连接原语复用 cdp.ts，骑会话思路镜像 fetcher.ts / ga4-fetcher.ts。
//
// 为什么用 UI 驱动而非内部 batchexecute：URL Inspection 的耗时卡在 Google 实时查
// 索引（每页约 20-50s），与是否硬调内部接口无关；驱动 GSC 顶栏「检查框」UI 再读结
// 果 DOM 与硬调 API 同速，但更稳、更像真人，reCAPTCHA 风险更低（轮 07 Sean 拍板）。
//
// 行为（已在 Sean 浏览器实测）：
//   · 检查框 = 顶栏唯一的 `input[role="combobox"]`（aria-label 形如「检查 … 中的任何网址」）。
//   · 聚焦→清空→输入完整 URL→Enter；提交后页面 URL 变为
//     `…/inspect?resource_id=…&id=<opaque>`（每次查询一个新 id），主面板出现裁决文案。
//   · 裁决主文案（判 indexed）：
//       已收录："网址已收录到 Google" / "此网址已显示在 Google 搜索结果中，但有问题"
//       未收录："网址未收录到 Google" / "网址不在 Google 上"
//   · 子行「网页索引编制」→ 值如「网页已编入索引」（coverage 细节）。
//   · 「上次成功抓取时间：2026年6月28日 01:02:14」在折叠的子面板里——但折叠态下文本
//     仍在 DOM 的 textContent 中（只是不在 innerText），故无需展开、直接 textContent 取。
//   · reCAPTCHA：顶层始终挂着 v3 隐形徽标 iframe（api2/anchor），不算阻断；只有可见的
//     交互式挑战 iframe（api2/bframe）才算阻断 → 置 captchaBlocked 并停止后续。

import { type Browser, type Page } from "puppeteer-core";
import { DEFAULT_CDP_HOST, DEFAULT_CDP_PORT, connectBrowser } from "./cdp";

const DEFAULT_PROPERTY = "sc-domain:weslamic.com";
const INSPECT_BOX_SELECTOR = 'input[role="combobox"]';
// 连续这么多页取不到裁决 → 判定疑似限流/软拦截，熔断停止（避免对全批各磨满超时）。
const SOFT_BLOCK_FAILS = 3;

// 裁决主文案候选（中 / 英），顺序无关——同状态各变体互斥。
const VERDICT_PHRASES = [
  // indexed = true
  "网址已收录到 Google",
  "此网址已显示在 Google 搜索结果中，但有问题",
  "URL is on Google, but has issues",
  "URL is on Google",
  // indexed = false
  "网址未收录到 Google",
  "网址不在 Google 上",
  "URL is not on Google",
  "URL is not available to Google",
];

export interface IndexInspectionResult {
  url: string;
  indexed: boolean | null; // null = 本次未取到 / 失败
  coverageText: string;
  pageIndexingText: string;
  lastCrawled: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 优先复用已存在的 GSC tab（用户多半已登录、看过数据），没有则新开并 goto GSC 首页。
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

// 由裁决主文案映射收录状态。先判"未收录"（其文案也含 Google，避免误命中"已收录"）。
function mapIndexed(coverageText: string): boolean | null {
  const t = coverageText ?? "";
  const falsePhrases = [
    "网址未收录到 Google",
    "网址不在 Google 上",
    "URL is not on Google",
    "URL is not available to Google",
  ];
  const truePhrases = [
    "网址已收录到 Google",
    "已显示在 Google 搜索结果中",
    "URL is on Google",
  ];
  if (falsePhrases.some((p) => t.includes(p))) return false;
  if (truePhrases.some((p) => t.includes(p))) return true;
  return null;
}

// 在页面上下文读裁决结果。该函数体被序列化进浏览器 —— 只能用浏览器内可用 API。
async function readResult(
  page: Page,
  phrases: string[]
): Promise<{
  coverageText: string;
  pageIndexingText: string;
  lastCrawled: string | null;
  challenge: boolean;
}> {
  return await page.evaluate((verdictPhrases: string[]) => {
    const innerText = document.body?.innerText ?? "";
    const textContent = document.body?.textContent ?? "";

    // 主裁决文案
    let coverageText = "";
    for (const p of verdictPhrases) {
      if (innerText.includes(p)) {
        coverageText = p;
        break;
      }
    }

    // 「网页索引编制」子行：标签行的下一非空行即其值（如「网页已编入索引」）
    let pageIndexingText = "";
    const lines = innerText.split("\n").map((l) => l.trim());
    const idx = lines.findIndex(
      (l) => l === "网页索引编制" || l === "Page indexing"
    );
    if (idx >= 0) {
      for (let j = idx + 1; j < lines.length && j <= idx + 3; j++) {
        if (lines[j]) {
          pageIndexingText = lines[j];
          break;
        }
      }
    }

    // 「上次成功抓取时间」——折叠态也在 textContent 中（不在 innerText），直接 textContent 取。
    // 注意：折叠面板各字段在 textContent 里无分隔符相连（如 "…01:02:14当时所用的用户代理…"），
    // 故必须把捕获精确收束到"日期(+时间)"本身，不能用贪婪的 [^，,。\n]*。
    let lastCrawled: string | null = null;
    const m =
      textContent.match(
        /上次(?:成功)?抓取(?:时间|日期)?[：:]\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日(?:\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/
      ) ||
      textContent.match(
        /Last craw(?:l|led)(?:\s*time)?[：:]\s*([A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4}(?:,?\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*[AP]M)?)/i
      );
    if (m && m[1]) lastCrawled = m[1].trim();

    // 可见的 reCAPTCHA 交互挑战（bframe）才算阻断；v3 隐形徽标（anchor）忽略。
    let challenge = false;
    const frames = Array.from(document.querySelectorAll("iframe"));
    const bframe = frames.find((f) =>
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

    return { coverageText, pageIndexingText, lastCrawled, challenge };
  }, phrases);
}

// 读 URL 当前的结果 id（每次实时查询 GSC 会写一个新的 &id=<opaque>）。
async function currentId(page: Page): Promise<string> {
  return page.evaluate(
    () => new URLSearchParams(location.search).get("id") || ""
  );
}

// 聚焦检查框 → 全选删空 → 输入完整 URL → Enter。
async function typeAndSubmit(page: Page, url: string): Promise<void> {
  await page.click(INSPECT_BOX_SELECTOR);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(INSPECT_BOX_SELECTOR, url, { delay: 15 });
  await page.keyboard.press("Enter");
}

// 等"结果页切换"：URL 的 id 变成新值。提交后 GSC 立刻导航到新 id 并显示加载态，故很快（几秒）。
// 这一步是"规避读到上个 URL 旧裁决"的关键闸门——它先确认我们确实站在新结果页上。
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

// 等"裁决文案出现"或"可见 reCAPTCHA 挑战"。前置：已 waitNewResult 确认在新结果页，故这里
// 只看内容、不再校验 id —— 这样首轮超时后可对【同一在飞查询】继续等待，而非重新提交白等。
async function waitVerdictOrChallenge(
  page: Page,
  timeoutMs: number
): Promise<void> {
  await page.waitForFunction(
    (verdictPhrases: string[]) => {
      const text = document.body?.innerText ?? "";
      const hasVerdict = verdictPhrases.some((p) => text.includes(p));

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

      return hasVerdict || challenge;
    },
    { timeout: timeoutMs, polling: 1000 },
    VERDICT_PHRASES
  );
}

// 单个 URL：聚焦检查框→清空→输入→Enter→确认结果页切换→等裁决文案/挑战。等不到则抛（由上层记 null）。
// 内置两处"更聪明的重试"（取代盲目重提交）：
//   ① 结果页没切换(id 没变)=提交没生效 → 重新提交一次；
//   ② 裁决文案首轮超时 → 不重提交、对同一在飞查询再多等一轮（GSC 实时查询常 20-50s，偶尔 >60s，
//      重提交会丢掉已等的进度、且可能撞 id 去重而永久停滞）。
// 这样一个"慢但能出结果"的页最多获得 2×perUrlTimeoutMs 的等待，而不是被无意义地重查两次。
async function inspectOne(
  page: Page,
  url: string,
  perUrlTimeoutMs: number
): Promise<{
  coverageText: string;
  pageIndexingText: string;
  lastCrawled: string | null;
  challenge: boolean;
}> {
  await page.waitForSelector(INSPECT_BOX_SELECTOR, { timeout: 15_000 });

  // 提交 + 确认结果页切换；没切换说明提交没生效 → 重提交一次，仍不切换则抛。
  let prevId = await currentId(page);
  await typeAndSubmit(page, url);
  try {
    await waitNewResult(page, prevId, 20_000);
  } catch {
    prevId = await currentId(page);
    await typeAndSubmit(page, url);
    await waitNewResult(page, prevId, 20_000);
  }

  // 等裁决；首轮超时不重提交，只对同一在飞查询再等一轮（覆盖 >60s 的慢页）。
  try {
    await waitVerdictOrChallenge(page, perUrlTimeoutMs);
  } catch {
    await waitVerdictOrChallenge(page, perUrlTimeoutMs);
  }

  await sleep(300); // 结果区轻微 settle

  // 「上次成功抓取时间」在折叠子面板里，渲染略晚于主裁决——做一次有界的尽力等待（≤2.5s）
  // 把它等出来；等不到不报错（best-effort，lastCrawled 允许为 null）。新鲜查询几乎都能等到，
  // 仅"秒回的缓存结果/确实没有该字段"的页会走满这点预算后以 null 收场。
  try {
    await page.waitForFunction(
      () => {
        const tc = document.body?.textContent ?? "";
        return /上次(?:成功)?抓取(?:时间|日期)?[：:]/.test(tc) || /Last craw/i.test(tc);
      },
      { timeout: 2_500, polling: 300 }
    );
  } catch {
    /* 该页未在预算内暴露抓取时间 → lastCrawled 留 null */
  }

  return await readResult(page, VERDICT_PHRASES);
}

/**
 * 逐 URL 走 GSC「网址检查」取真实收录状态。
 * - 单次 CDP 连接；复用已有 GSC 标签（无则新开并 goto GSC 首页）；串行逐个检查。
 * - 单页内置智能重试（提交没生效则重提交一次；裁决超时则对同一在飞查询再等一轮，给慢页
 *   最多 2×perUrlTimeoutMs）；仍失败 → indexed=null、coverageText 记原因，续下一个（绝不整批抛）。
 * - 每个 URL 之间 sleep throttleMs 节流。
 * - 撞到"可见 reCAPTCHA 挑战"，或连续 SOFT_BLOCK_FAILS 页取不到裁决（疑似限流/软拦截）
 *   → captchaBlocked=true 并停止后续，返回已得结果（让上层提示用户去浏览器手动解一次再重试）。
 * - finally：只 disconnect 不 close；只关本函数自己新开的标签，不动用户原标签。
 */
export async function inspectUrls(
  urls: string[],
  opts?: {
    resourceId?: string;
    throttleMs?: number;
    perUrlTimeoutMs?: number;
    cdpHost?: string;
    cdpPort?: number;
    onProgress?: (done: number, total: number, last: IndexInspectionResult) => void;
  }
): Promise<{ results: IndexInspectionResult[]; captchaBlocked: boolean }> {
  const resourceId = opts?.resourceId ?? DEFAULT_PROPERTY;
  const throttleMs = opts?.throttleMs ?? 4_000;
  const perUrlTimeoutMs = opts?.perUrlTimeoutMs ?? 60_000;
  const host = opts?.cdpHost ?? DEFAULT_CDP_HOST;
  const port = opts?.cdpPort ?? DEFAULT_CDP_PORT;

  const targets = urls.filter((u) => /^https?:\/\//.test(u));
  const results: IndexInspectionResult[] = [];
  let captchaBlocked = false;
  if (targets.length === 0) return { results, captchaBlocked };

  let browser: Browser | null = null;
  let openedPage: Page | null = null;
  try {
    browser = await connectBrowser(host, port);
    const { page, opened } = await resolveGscTab(browser, resourceId);
    if (opened) openedPage = page;
    await page.bringToFront();

    const total = targets.length;
    // 软拦截熔断：GSC 在会话被限流(reCAPTCHA v3 低分)时，提交后结果面板保持空白、裁决永不渲染，
    // 表现为连续多页超时取不到（无可见挑战）。连续失败达到阈值即判定"疑似限流/软拦截"，置 blocked
    // 并停止——避免对全部 57 页各磨 2×timeout 才得到一片 null（也契合"停下+提示人工"的设计意图）。
    let consecutiveFail = 0;
    for (let i = 0; i < targets.length; i++) {
      const url = targets[i];

      // 重试已内置于 inspectOne（重提交一次 + 在飞查询再等一轮），这里单次调用即可；
      // 抛错 = 内置重试也没救回来 → 记 null、续下一个，绝不让整批挂掉。
      let got: Awaited<ReturnType<typeof inspectOne>> | null = null;
      let lastErr: unknown = null;
      try {
        got = await inspectOne(page, url, perUrlTimeoutMs);
      } catch (e) {
        lastErr = e;
        got = null;
      }

      let result: IndexInspectionResult;
      if (got === null) {
        const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
        consecutiveFail++;
        const softBlocked = consecutiveFail >= SOFT_BLOCK_FAILS;
        result = {
          url,
          indexed: null,
          coverageText: softBlocked
            ? `失败：${reason}；连续 ${consecutiveFail} 页取不到裁决，疑似 Google 限流/reCAPTCHA 软拦截，已停止（请到浏览器手动检查一个网址通过验证后再重试）`
            : `失败：${reason}`,
          pageIndexingText: "",
          lastCrawled: null,
        };
        results.push(result);
        opts?.onProgress?.(results.length, total, result);
        if (softBlocked) {
          captchaBlocked = true;
          break;
        }
      } else if (got.challenge) {
        // 撞到可见 reCAPTCHA 挑战：本页取不到可靠结果，置 blocked 并停止后续。
        result = {
          url,
          indexed: null,
          coverageText: "reCAPTCHA 人机验证挑战出现，已停止采集（请到浏览器手动通过一次再重试）",
          pageIndexingText: "",
          lastCrawled: null,
        };
        results.push(result);
        opts?.onProgress?.(results.length, total, result);
        captchaBlocked = true;
        break;
      } else {
        consecutiveFail = 0; // 成功一页即清零，确保熔断只对"连续"失败生效
        result = {
          url,
          indexed: mapIndexed(got.coverageText),
          coverageText: got.coverageText || "未识别裁决文案（可能 GSC 改版或仍在加载）",
          pageIndexingText: got.pageIndexingText,
          lastCrawled: got.lastCrawled,
        };
        results.push(result);
        opts?.onProgress?.(results.length, total, result);
      }

      // 节流：除最后一个外，每个 URL 之间停一下，降低 reCAPTCHA 风险。
      if (i < targets.length - 1) await sleep(throttleMs);
    }

    return { results, captchaBlocked };
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
