// GSC「URL Inspection API」官方服务账号取数器（替代 index-inspection-fetcher.ts 的会话抓取法）。
//
// 为什么并存而非替换：会话抓取法（CDP 接管已登录 Chrome 读 DOM）免配置、能跑实时测试，
// 但易撞 reCAPTCHA 软拦截、单页 20-60s。官方 API 法需服务账号 key（一次性配置），但稳、快
// （~120ms/页）、无验证码——配好后批量收录检查首选它，没配则路由自动回退会话法。
//
// 产出刻意与会话法同形（IndexInspectionResult），让 inspect-coverage/route.ts 能无缝切换数据源。
//
// 官方规格（详见 执行日志/research/gsc-url-inspection-api-setup.md）：
//   · POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
//   · body { inspectionUrl, siteUrl: "sc-domain:weslamic.com", languageCode? }
//   · 响应 inspectionResult.indexStatusResult.{ verdict, coverageState, robotsTxtState,
//     indexingState, lastCrawlTime }
//   · scope webmasters.readonly；服务账号需被人工 owner 在 GSC UI 加为 Full User
//   · 配额：每属性 2000/天、600/分钟 → 串行 + ~120ms 间隔守住分钟配额
//   · 坑：siteUrl 必须 sc-domain 写法；coverageState 是自由文案，用 includes 模糊匹配别全等

import { promises as fs } from "node:fs";
import path from "node:path";
import { JWT } from "google-auth-library";
import type { IndexInspectionResult } from "./index-inspection-fetcher";

const ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_SITE_URL = "sc-domain:weslamic.com";
const DEFAULT_LANGUAGE = "en-US";
// 守 600/分钟配额：串行逐页，每页之间停 ~120ms（≈500/分钟，留余量）。
const THROTTLE_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

// 官方响应里我们用到的字段（其余字段忽略，结构按需收窄）。
interface IndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
}
interface InspectApiResponse {
  inspectionResult?: { indexStatusResult?: IndexStatusResult };
}

/**
 * 是否已配置服务账号（仅看 env 是否存在，不读文件/不联网）。
 * 路由用它在「取数前」决定批量上限（API 法可放大到 50/批）。
 */
export function isGscApiConfigured(): boolean {
  return Boolean(
    process.env.GSC_SA_KEY_JSON?.trim() || process.env.GSC_SA_KEY_FILE?.trim()
  );
}

// 从 env 解析服务账号凭证：GSC_SA_KEY_JSON（内联 JSON 串）优先，其次 GSC_SA_KEY_FILE（JSON 文件路径）。
// 返回 null = 两者都没配（上层据此走降级）；抛错 = 配了但读不出（坏路径 / 坏 JSON / 缺字段）。
async function loadServiceAccount(): Promise<ServiceAccountKey | null> {
  const inline = process.env.GSC_SA_KEY_JSON?.trim();
  const file = process.env.GSC_SA_KEY_FILE?.trim();

  let raw: string;
  if (inline) {
    raw = inline;
  } else if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    raw = await fs.readFile(abs, "utf-8");
  } else {
    return null; // 未配置
  }

  const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("service account JSON 缺少 client_email / private_key 字段");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

// 由官方 verdict + coverageState 映射收录状态。coverageState 是自由文案 → 一律小写 includes
// 模糊匹配，绝不全等（官方坑）。判定【不依赖 verdict===FAIL】：只要 Google 给了实质答复且不是
// "已收录"文案，即判未收录(false)；null 仅留给"真·没答复"（这与会话抓取法语义对齐，也契合用户
// 诉求——"discovered/crawled - currently not indexed"就是未收录，不该落成"未知"）。
//
// 优先级：
//   1) verdict===PASS                                  → true（已收录）
//   2) coverage 含 "indexed" 且不含 "not indexed"       → true（已收录文案，verdict 无关；覆盖
//      "Submitted and indexed"、"Indexed, not submitted in sitemap"、PARTIAL 带已收录文案）
//   3) 拿到实质答复（coverageState 非空，或 verdict ∈ {FAIL,NEUTRAL,PARTIAL}）→ false
//      （覆盖 discovered/crawled - currently not indexed、excluded、redirect、alternate、
//        duplicate、blocked、404、"URL is unknown to Google" 等一切非收录答复）
//   4) 真·没答复（无 verdict 且 coverageState 为空）     → null
// 导出：供 scripts/recheck-not-indexed.ts 复用，保证"实时复核"与正常落盘的判定口径完全一致。
export function mapIndexed(
  verdict: string | undefined,
  coverageState: string | undefined
): boolean | null {
  const v = (verdict ?? "").toUpperCase();
  const cs = (coverageState ?? "").toLowerCase();

  // 1) 已收录裁决
  if (v === "PASS") return true;
  // 2) 已收录文案（verdict 无关）
  if (cs.includes("indexed") && !cs.includes("not indexed")) return true;

  // 3) 有实质答复但非"已收录" → 未收录
  const hasVerdict = v === "FAIL" || v === "NEUTRAL" || v === "PARTIAL";
  if (cs.trim().length > 0 || hasVerdict) return false;

  // 4) 真·没答复
  return null;
}

// 从抛出的错误里抽 HTTP 状态码 + 可读消息（gaxios 错误形如 err.response.status / err.response.data.error.message）。
function describeError(err: unknown): { status: number | null; message: string } {
  const e = err as {
    response?: {
      status?: number;
      data?: { error?: { message?: string; status?: string } };
    };
    message?: string;
  };
  const status = typeof e?.response?.status === "number" ? e.response.status : null;
  const apiMessage = e?.response?.data?.error?.message;
  const message = apiMessage || e?.message || String(err);
  return { status, message };
}

/**
 * 走官方 URL Inspection API 逐页查收录状态。
 *
 * 返回三态：
 *   · 未配置服务账号           → { results: [], configured: false }（路由据此回退会话法）
 *   · 配了但鉴权/授权失败       → { results: [], configured: true, error: "..." }（路由 4xx 提示用户）
 *   · 配好且可用               → { results, configured: true }（results 与会话法同形）
 *
 * 容错：
 *   · 凭证读不出（坏路径/坏 JSON/缺字段）→ configured:true + error
 *   · 403 / PERMISSION_DENIED → 整批终止，error 提示"加 Full User"
 *   · 401 / invalid_grant 等鉴权失败 → 整批终止（密钥无效/scope 不足，重试无意义）
 *   · 单条网络抖动 / 5xx → 该条 indexed:null（coverageText 记原因），续下一个，绝不整批挂
 */
export async function inspectUrlsViaApi(
  urls: string[],
  opts?: { languageCode?: string }
): Promise<{ results: IndexInspectionResult[]; configured: boolean; error?: string }> {
  const targets = urls.filter((u) => /^https?:\/\//.test(u));

  // 1) 解析凭证：未配置 → 降级；配了读不出 → 报错（让路由提示用户改 env / 修 key 路径）。
  let credentials: ServiceAccountKey | null;
  try {
    credentials = await loadServiceAccount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { results: [], configured: true, error: `服务账号密钥读取失败：${msg}` };
  }
  if (!credentials) return { results: [], configured: false };

  if (targets.length === 0) return { results: [], configured: true };

  const siteUrl = process.env.GSC_SITE_URL?.trim() || DEFAULT_SITE_URL;
  const languageCode = opts?.languageCode ?? DEFAULT_LANGUAGE;

  // JWT 客户端只构造一次；首个 request 自动换取并缓存 access token，后续复用至过期。
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [SCOPE],
  });

  const results: IndexInspectionResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    try {
      const res = await client.request<InspectApiResponse>({
        url: ENDPOINT,
        method: "POST",
        data: { inspectionUrl: url, siteUrl, languageCode },
      });
      const isr = res.data?.inspectionResult?.indexStatusResult ?? {};
      results.push({
        url,
        indexed: mapIndexed(isr.verdict, isr.coverageState),
        coverageText: isr.coverageState ?? "",
        pageIndexingText: isr.indexingState ?? "",
        lastCrawled: isr.lastCrawlTime ?? null,
      });
    } catch (err) {
      const { status, message } = describeError(err);
      // HTTP 错误一律按状态码判定（确定性）；message 正则仅作「无状态码」错误（如 token 换取/
      // 签名失败，没有 response.status）的兜底——避免普通 5xx 文案里偶含 "permission"/"unauthorized"
      // 被误判为鉴权类而错误地整批终止。
      const isPermissionDenied =
        status === 403 ||
        (status === null && /permission_denied|permission denied/i.test(message));
      const isAuthFailure =
        status === 401 ||
        (status === null &&
          /invalid_grant|unauthorized|invalid_client|invalid_scope/i.test(message));

      // 鉴权/授权类错误 = 整批都救不活 → 立即终止并带提示返回（让前端 toast 指引）。
      if (isPermissionDenied) {
        return {
          results: [],
          configured: true,
          error: "服务账号未被加入 GSC 属性(需在 GSC UI 加为 Full User)",
        };
      }
      if (isAuthFailure) {
        return {
          results: [],
          configured: true,
          error: `服务账号鉴权失败（密钥无效/已撤销，或 scope 不足）：${message}`,
        };
      }

      // 其余（网络抖动 / 5xx / 单条异常）→ 该条 null，续下一个。
      results.push({
        url,
        indexed: null,
        coverageText: `失败：${message}`,
        pageIndexingText: "",
        lastCrawled: null,
      });
    }

    // 节流：除最后一个外，每页之间停一下，守住 600/分钟配额。
    if (i < targets.length - 1) await sleep(THROTTLE_MS);
  }

  return { results, configured: true };
}
