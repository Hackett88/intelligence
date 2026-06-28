// 旧站 → 新站重定向映射 —— data/gsc-redirect-map.json
//
// 迁站到 Framer 后，旧站 ~267 个 URL 的真实 GSC 流量（clicks/impressions/...）还在旧快照里，
// 但它们在公网上已"干净 308 永久重定向"到对应新页（实测）。本模块把"旧址 → 新址"的对应关系
// 离线解析出来并落盘，供 coverage-loader 把旧址流量按重定向归并到新页（数据量守恒）。
//
// 口径：
//   key   = oldNorm = normalizeForMatch(旧 fullUrl)
//   value = 新 URL 的 normalizeForMatch；若 404 / 无 Location / 未跳回本站 → null（孤儿流量）
// 解析：对每个旧 URL 用全局 fetch（redirect:"manual"，HEAD 优先、必要时降级 GET）逐跳读
//   Location，相对路径以 origin 补全，最多跟 3 跳，最终落点（2xx）的归一化值即新 norm。
//   单个 URL 解析失败一律记 null、不中断整批（容错）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeForMatch } from "./url-normalize";

const REDIRECT_MAP_PATH = path.join(process.cwd(), "data", "gsc-redirect-map.json");
const ORIGIN = "https://www.weslamic.com";
const MAX_HOPS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_HEADERS = {
  // 与 sitemap.ts 同款 UA，避免部分 CDN 拒空 UA
  "User-Agent": "Mozilla/5.0 (compatible; WeslamicSEOBot/1.0; +https://www.weslamic.com)",
  Accept: "*/*",
};

export interface RedirectMapFile {
  version: 1;
  builtAt: string;
  // oldNorm → 新 URL 的 normalizeForMatch（null = 没跳到本站新页 / 404 / 解析失败）
  byOldUrl: Record<string, string | null>;
}

// ── 持久化 ──────────────────────────────────────────────────────────────────

export async function loadRedirectMap(): Promise<RedirectMapFile> {
  try {
    const raw = await fs.readFile(REDIRECT_MAP_PATH, "utf-8");
    const parsed = JSON.parse(raw) as RedirectMapFile;
    if (parsed?.version === 1 && parsed.byOldUrl) return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[gsc/redirect-map] loadRedirectMap failed:", err);
    }
  }
  // 文件不存在或损坏 → 空映射（下游退化为"全 0"，不报错）
  return { version: 1, builtAt: "", byOldUrl: {} };
}

/** 把 byOldUrl 记录包成文件结构，原子写入 data/gsc-redirect-map.json。 */
export async function saveRedirectMap(
  byOldUrl: Record<string, string | null>
): Promise<RedirectMapFile> {
  const file: RedirectMapFile = {
    version: 1,
    builtAt: new Date().toISOString(),
    byOldUrl,
  };
  const dir = path.dirname(REDIRECT_MAP_PATH);
  await fs.mkdir(dir, { recursive: true });
  const tmp = REDIRECT_MAP_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await fs.rename(tmp, REDIRECT_MAP_PATH);
  return file;
}

// ── 重定向解析 ──────────────────────────────────────────────────────────────

/** host（去前导 www.）是否为本站 weslamic.com。 */
function isOnSite(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "weslamic.com";
  } catch {
    return false;
  }
}

/** 把可能是相对路径的 Location / 旧 URL 解析为绝对 URL（以 base 为基准，默认 origin）。 */
function absolutize(urlOrPath: string, base: string = ORIGIN): string {
  try {
    return new URL(urlOrPath, base).href;
  } catch {
    return urlOrPath;
  }
}

/**
 * 单次不跟随取响应：HEAD 优先（不下载正文）；若 HEAD 被拒（405/501）或抛错，降级 GET 并丢弃正文。
 * 任何网络异常返回 null（由调用方记 null）。
 */
async function fetchNoFollow(url: string): Promise<Response | null> {
  const get = async (): Promise<Response> => {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // 终点 2xx 的 GET 会带正文，主动取消避免连接挂着
    if (res.body) res.body.cancel().catch(() => {});
    return res;
  };
  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (head.status === 405 || head.status === 501) return await get();
    return head;
  } catch {
    try {
      return await get();
    } catch {
      return null;
    }
  }
}

/**
 * 顺着重定向链解析最终落点：最多跟 maxHops 跳。
 * 返回最终 2xx 落点的 normalizeForMatch（本站）；遇 404/5xx/无 Location/跳出本站/超跳数 → null。
 */
async function resolveRedirect(startUrl: string, maxHops = MAX_HOPS): Promise<string | null> {
  let url = absolutize(startUrl);
  // i 计请求数：允许 maxHops 次重定向 + 1 次落点请求
  for (let i = 0; i <= maxHops; i++) {
    const res = await fetchNoFollow(url);
    if (!res) return null;
    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = absolutize(loc, url); // 相对 Location 以当前 URL 为基准补全
      continue;
    }
    if (status >= 200 && status < 300) {
      return isOnSite(url) ? normalizeForMatch(url) : null;
    }
    // 4xx / 5xx → 无对应新页
    return null;
  }
  // 跳数超限仍在重定向 → 放弃
  return null;
}

// ── 批量构建 ────────────────────────────────────────────────────────────────

/**
 * 对每个旧 fullUrl 解析重定向落点，产出 { oldNorm → newNorm|null }。
 * 并发默认 8；单个失败记 null、不中断整批。
 */
export async function buildRedirectMap(
  oldFullUrls: string[],
  opts?: { concurrency?: number }
): Promise<Record<string, string | null>> {
  const concurrency = Math.max(1, opts?.concurrency ?? 8);
  const result: Record<string, string | null> = {};
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= oldFullUrls.length) return;
      const oldUrl = oldFullUrls[i];
      const oldNorm = normalizeForMatch(oldUrl);
      let target: string | null = null;
      try {
        target = await resolveRedirect(absolutize(oldUrl), MAX_HOPS);
      } catch {
        target = null;
      }
      result[oldNorm] = target;
    }
  }

  const workers = Math.min(concurrency, oldFullUrls.length || 1);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return result;
}
