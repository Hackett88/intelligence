// GSC「Search Analytics API」官方服务账号流量取数器（替代"更新"按钮现在靠本地浏览器
// 抓 GSC 效果报表的做法）。服务端直接拉 per-page 的 clicks/impressions/ctr/position，
// 可选再拉一轮 page×query 挂关键词。
//
// 为什么用官方 API：会话抓取法（CDP 接管已登录 Chrome 读效果报表 DOM）免配置，但易撞软拦截、
// 慢、脆。官方 API 法需服务账号 key（一次性配置），稳、快、可分页拿满全量行——配好后取数首选它。
//
// 鉴权/错误处理刻意与 index-inspection-api-fetcher.ts 同款（同一服务账号 + 同 scope + 同三态返回），
// 让上层能用同一套"未配/授权失败/可用"判断逻辑。
//
// 官方规格：
//   · POST https://searchconsole.googleapis.com/webmasters/v3/sites/{encodeURIComponent(siteUrl)}/searchAnalytics/query
//   · body { startDate, endDate, dimensions, rowLimit: 25000, startRow }
//   · scope webmasters.readonly；服务账号需被 owner 在 GSC UI 加为用户
//   · siteUrl 必须 sc-domain 写法（默认 sc-domain:weslamic.com）
//   · rowLimit 上限 25000：拿满一页就 startRow += 25000 续拉，直到不足一页
//   · 本模块不写任何文件、不碰 DB——纯取数。

import { promises as fs } from "node:fs";
import path from "node:path";
import { JWT } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_SITE_URL = "sc-domain:weslamic.com";
// GSC searchAnalytics 单页行数硬上限 25000；拿满即认为"可能还有"，续拉下一页。
const ROW_LIMIT = 25000;
// withQueries 时每页保留的关键词数（按 clicks 降序 Top N）。
const QUERIES_PER_PAGE = 50;

export interface SAQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SAPageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  // 仅当 withQueries=true 时挂载：该页 Top 50 关键词（按 clicks 降序）。
  queries?: SAQueryRow[];
}

export interface FetchSearchAnalyticsResult {
  configured: boolean;
  error?: string;
  pages: SAPageRow[];
}

// page×date 明细单行（dimensions:["page","date"]，keys[0]=page, keys[1]=date "YYYY-MM-DD"）。
export interface PageDailyRow {
  url: string;
  date: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface FetchPageDailyResult {
  configured: boolean;
  error?: string;
  rows: PageDailyRow[];
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

// GSC 单行返回：keys 顺序对应请求里的 dimensions（["page"] → keys[0]=page；
// ["page","query"] → keys[0]=page, keys[1]=query）。
interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}
interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

/**
 * 是否已配置服务账号（仅看 env 是否存在，不读文件/不联网）。与 inspection fetcher 同口径。
 */
export function isGscApiConfigured(): boolean {
  return Boolean(
    process.env.GSC_SA_KEY_JSON?.trim() || process.env.GSC_SA_KEY_FILE?.trim()
  );
}

// 从 env 解析服务账号凭证：GSC_SA_KEY_JSON（内联 JSON 串）优先，其次 GSC_SA_KEY_FILE（JSON 文件路径）。
// 返回 null = 两者都没配（上层据此走"未配置"）；抛错 = 配了但读不出（坏路径 / 坏 JSON / 缺字段）。
// 与 index-inspection-api-fetcher.ts 的 loadServiceAccount 完全一致。
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

// 从抛出的错误里抽 HTTP 状态码 + 可读消息（gaxios 错误形如 err.response.status / err.response.data.error.message）。
// 与 inspection fetcher 同款。
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

// 把 gaxios 错误归类为鉴权/授权类（整批救不活），用于返回友好提示。与 inspection fetcher 同款。
function classifyAuthError(
  status: number | null,
  message: string
): { kind: "permission" | "auth" | "other"; error: string } {
  const isPermissionDenied =
    status === 403 ||
    (status === null && /permission_denied|permission denied/i.test(message));
  const isAuthFailure =
    status === 401 ||
    (status === null &&
      /invalid_grant|unauthorized|invalid_client|invalid_scope/i.test(message));

  if (isPermissionDenied) {
    return {
      kind: "permission",
      error: "服务账号未被加入 GSC 属性(需在 GSC UI 加为用户)",
    };
  }
  if (isAuthFailure) {
    return {
      kind: "auth",
      error: `服务账号鉴权失败（密钥无效/已撤销，或 scope 不足）：${message}`,
    };
  }
  return { kind: "other", error: `取数失败：${message}` };
}

/**
 * 对单一 dimensions 组合分页拉满全部行：拿满 25000 就 startRow += 25000 续拉，直到不足一页。
 * 任一页请求抛错向上抛（由 fetchSearchAnalytics 统一 catch 归类）。
 */
async function fetchAllRows(
  client: JWT,
  endpoint: string,
  body: { startDate: string; endDate: string; dimensions: string[] }
): Promise<SearchAnalyticsRow[]> {
  const all: SearchAnalyticsRow[] = [];
  let startRow = 0;
  for (;;) {
    const res = await client.request<SearchAnalyticsResponse>({
      url: endpoint,
      method: "POST",
      data: { ...body, rowLimit: ROW_LIMIT, startRow },
    });
    const rows = res.data?.rows ?? [];
    all.push(...rows);
    if (rows.length < ROW_LIMIT) break; // 不足一页 → 已到底
    startRow += ROW_LIMIT;
  }
  return all;
}

// GSC 偶尔回 ctr/position 缺省；统一兜 0，并由 keys[idx] 安全取维度值。
function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 走官方 Search Analytics API 拉某时间窗的 per-page 流量。
 *
 * 返回三态（与 inspection fetcher 对齐）：
 *   · 未配置服务账号        → { configured: false, pages: [] }
 *   · 配了但鉴权/授权失败    → { configured: true, error, pages: [] }
 *   · 配好且可用            → { configured: true, pages }
 *
 * withQueries=true 时**另外**拉一轮 dimensions:["page","query"]（同样分页），按 page 归组，
 * 每页取 Top 50（clicks 降序）挂到对应 SAPageRow.queries。
 */
export async function fetchSearchAnalytics(opts: {
  startDate: string;
  endDate: string;
  withQueries?: boolean;
}): Promise<FetchSearchAnalyticsResult> {
  // 1) 解析凭证：未配置 → configured:false；配了读不出 → configured:true + error。
  let credentials: ServiceAccountKey | null;
  try {
    credentials = await loadServiceAccount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { configured: true, error: `服务账号密钥读取失败：${msg}`, pages: [] };
  }
  if (!credentials) return { configured: false, pages: [] };

  const siteUrl = process.env.GSC_SITE_URL?.trim() || DEFAULT_SITE_URL;
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;

  // JWT 客户端只构造一次；首个 request 自动换取并缓存 access token。
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [SCOPE],
  });

  try {
    // 2) per-page（dimensions:["page"]），分页拉满。
    const pageRows = await fetchAllRows(client, endpoint, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: ["page"],
    });

    const pages: SAPageRow[] = [];
    const pageByUrl = new Map<string, SAPageRow>();
    for (const r of pageRows) {
      const url = r.keys?.[0];
      if (!url) continue;
      const row: SAPageRow = {
        url,
        clicks: num(r.clicks),
        impressions: num(r.impressions),
        ctr: num(r.ctr),
        position: num(r.position),
      };
      pages.push(row);
      pageByUrl.set(url, row);
    }

    // 3) 可选：page×query 再拉一轮，按 page 归组 → 每页 Top 50 挂到 SAPageRow.queries。
    if (opts.withQueries) {
      const pqRows = await fetchAllRows(client, endpoint, {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: ["page", "query"],
      });
      const byPage = new Map<string, SAQueryRow[]>();
      for (const r of pqRows) {
        const url = r.keys?.[0];
        const query = r.keys?.[1];
        if (!url || query == null) continue;
        let arr = byPage.get(url);
        if (!arr) {
          arr = [];
          byPage.set(url, arr);
        }
        arr.push({
          query,
          clicks: num(r.clicks),
          impressions: num(r.impressions),
          ctr: num(r.ctr),
          position: num(r.position),
        });
      }
      for (const [url, qs] of byPage) {
        qs.sort((a, b) => b.clicks - a.clicks);
        const top = qs.slice(0, QUERIES_PER_PAGE);
        const existing = pageByUrl.get(url);
        if (existing) {
          existing.queries = top;
        } else {
          // per-page 没返回但 page×query 返回了（理论少见）→ 由 query 行聚合补一个 page 行，
          // clicks/impressions 求和、ctr/position 按曝光加权还原，保证不丢这页。
          let clicks = 0;
          let impressions = 0;
          let ctrSum = 0;
          let posSum = 0;
          for (const q of qs) {
            clicks += q.clicks;
            impressions += q.impressions;
            ctrSum += q.ctr * q.impressions;
            posSum += q.position * q.impressions;
          }
          const synthesized: SAPageRow = {
            url,
            clicks,
            impressions,
            ctr: impressions > 0 ? ctrSum / impressions : 0,
            position: impressions > 0 ? posSum / impressions : 0,
            queries: top,
          };
          pages.push(synthesized);
          pageByUrl.set(url, synthesized);
        }
      }
    }

    return { configured: true, pages };
  } catch (err) {
    const { status, message } = describeError(err);
    const { error } = classifyAuthError(status, message);
    return { configured: true, error, pages: [] };
  }
}

/**
 * 走官方 Search Analytics API 拉某时间窗的 per-page × date 明细（dimensions:["page","date"]）。
 *
 * 三态返回与 fetchSearchAnalytics 对齐：
 *   · 未配置服务账号        → { configured: false, rows: [] }
 *   · 配了但鉴权/授权失败    → { configured: true, error, rows: [] }
 *   · 配好且可用            → { configured: true, rows }
 *
 * rows 为「每页每天」一行（keys[0]=完整 URL，keys[1]=日期）。归一化 / 落库由上层负责，
 * 本函数只取数。鉴权/分页复用同款 JWT/fetchAllRows。
 */
export async function fetchPageDaily(opts: {
  startDate: string;
  endDate: string;
}): Promise<FetchPageDailyResult> {
  let credentials: ServiceAccountKey | null;
  try {
    credentials = await loadServiceAccount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { configured: true, error: `服务账号密钥读取失败：${msg}`, rows: [] };
  }
  if (!credentials) return { configured: false, rows: [] };

  const siteUrl = process.env.GSC_SITE_URL?.trim() || DEFAULT_SITE_URL;
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;

  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [SCOPE],
  });

  try {
    const raw = await fetchAllRows(client, endpoint, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: ["page", "date"],
    });

    const rows: PageDailyRow[] = [];
    for (const r of raw) {
      const url = r.keys?.[0];
      const date = r.keys?.[1];
      if (!url || !date) continue;
      rows.push({
        url,
        date,
        clicks: num(r.clicks),
        impressions: num(r.impressions),
        position: num(r.position),
      });
    }
    return { configured: true, rows };
  } catch (err) {
    const { status, message } = describeError(err);
    const { error } = classifyAuthError(status, message);
    return { configured: true, error, rows: [] };
  }
}
