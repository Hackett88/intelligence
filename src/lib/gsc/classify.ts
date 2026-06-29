// GSC 页面分类器（server + client 共用，纯函数无副作用）
//
// 两套分类共用同一组信号（关键词数 + 排名 + 页面类型），逻辑自洽：
//   · 周期档 cadence：决定一个页"多久该重抓一次"（日更 / 周更 / 月更）
//   · 健康态 health：决定一个页"健不健康 / 要不要人去管"
//
// 阈值都集中在这里，调档只改这几个常量。档位线依据 batch#4 实测分布：
// 关键词数 0=128, 1-2=42, 3-5=7(断层), 6-10=19, 11-24=21, ≥25=42 → ≥6 为"多/少"天然分界。

/** 关键词"多"的下限：≥ 此值算核心排名页（日更 / 健康候选）。 */
export const DAILY_KEYWORD_MIN = 6;
/** 健康页的排名上限：avg position ≤ 此值才算"表现好"。 */
export const HEALTHY_POSITION_MAX = 10;

/**
 * 资源文件 / 静态资产 URL 正则 —— 与抽屉"无关键词标注"共用同一判断，避免两份口径漂移。
 * 命中者本不该作为页面被收录（应 noindex/屏蔽），无关键词时归低优先/月更。
 */
export const ASSET_URL_RE = /\.(png|jpe?g|webp|gif|svg|css|js|mjs|pdf|json|xml|ico|woff2?|ttf)(\?|$)/i;

/**
 * "非内容页"类型：无关键词时归月更/低优先（而非周更/待激活）。
 * 只列**聚合/政策/支持**性质的结构页 —— 它们不是内容发力点：
 *   · 博客目录：靠下属文章排名，自身无独立词属正常
 *   · 常见问题 / 关于页：信任支持页，无词正常
 * 反向定义（而非正向列内容页）的好处：未来新增的未知内容类型默认归"内容页/待激活"，
 * 宁可多关注一个有潜力的页，也不要把发力点错划成"低优先"而被忽略。
 */
export const NON_CONTENT_PAGE_TYPES = new Set<string>([
  "博客目录",
  "常见问题",
  "关于页",
  "政策页",
]);

/**
 * 资源文件 / CDN 路径 —— 本不该作为页面被收录。这是**硬性非页面**：
 * 即便 GSC 给它挂了图片搜索词（如 .avif 命中 "show pic"），也不该当内容页去优化，
 * 应 noindex/屏蔽。故健康/周期分类对它无条件低优先/月更，不看关键词数。
 */
export function isAssetUrl(url?: string): boolean {
  if (!url) return false;
  return ASSET_URL_RE.test(url) || /\/cdn\//i.test(url);
}

/**
 * 系统 / 功能页 URL —— 购物车、结账、账户、认证、搜索等。和资源文件一样属"硬性非内容"：
 * 不该被当页面收录/优化（应 noindex），无论有无关键词都低优先/月更。
 */
export const SYSTEM_PAGE_RE =
  /\/(cart|checkout|account|orders?|customer_authentication|customer_identification|wishlist|login|register|password|search)(\/|\?|$)/i;

export function isSystemPage(input: { url?: string; pageType?: string }): boolean {
  if (input.pageType === "系统页") return true;
  return input.url ? SYSTEM_PAGE_RE.test(input.url) : false;
}

/**
 * "硬性非内容页"：资源文件 + 系统/功能页。无条件低优先/月更 —— 这类页本不该是内容页，
 * 即便 GSC 给它挂了词也不该投入优化，应 noindex/屏蔽。优先于关键词数判断。
 */
export function isHardNonContent(input: { url?: string; pageType?: string }): boolean {
  return isAssetUrl(input.url) || isSystemPage(input);
}

/**
 * 一个页是否属于"无关键词时不值得投入的非内容页"。命中任一 → 月更/低优先：
 *   · 资源文件 / CDN 路径（不该被当页面收录）
 *   · 分页 URL（?page= / &page=，聚合分页无独立词）
 *   · 非内容类页面类型（目录 / 常见问题 / 关于）
 * 其余（首页/产品/品类/落地/指南/资讯/对比/工具/博客文章…）都视为正常内容页 → 周更/待激活。
 */
export function isNonContentPage(input: { url?: string; pageType: string }): boolean {
  if (isAssetUrl(input.url)) return true;
  if (input.url && /[?&]page=/.test(input.url)) return true;
  return NON_CONTENT_PAGE_TYPES.has(input.pageType);
}

// ── 周期档 ────────────────────────────────────────────────────────────────────
export type Cadence = "daily" | "weekly" | "monthly";

export function classifyCadence(input: { pageType: string; keywordCount: number; url?: string }): Cadence {
  if (isHardNonContent(input)) return "monthly"; // 资源/系统页：有词也不当内容页，随全量重抓即可
  if (input.keywordCount >= DAILY_KEYWORD_MIN) return "daily"; // 关键词多 → 日更
  if (input.keywordCount >= 1) return "weekly"; // 关键词少 → 周更
  // 无关键词：正常内容页 → 周更（有潜力）；目录/分页/政策页 → 月更
  return isNonContentPage(input) ? "monthly" : "weekly";
}

export const CADENCE_META: Record<
  Cadence,
  { label: string; latin: string; hint: string }
> = {
  daily: {
    label: "日更",
    latin: "COTIDIE",
    hint: "关键词丰富的核心排名页，值得每天盯。",
  },
  weekly: {
    label: "周更",
    latin: "HEBDOMAS",
    hint: "关键词较少或暂无排名的正常内容页，内容会更新、可能逐渐起量，每周看一次。",
  },
  monthly: {
    label: "月更",
    latin: "MENSIS",
    hint: "政策 / 目录 / 工具等结构稳定页，极少新增排名，随月度全量一并重抓即可。",
  },
};

// ── 健康态 ────────────────────────────────────────────────────────────────────
export type HealthState = "healthy" | "improve" | "activate" | "lowpriority";

export function classifyHealth(input: {
  keywordCount: number;
  position: number;
  pageType: string;
  url?: string;
}): HealthState {
  const { keywordCount, position } = input;
  // 资源/系统页：即便挂了搜索词也不该当内容页优化 → 直接低优先（应 noindex/屏蔽）
  if (isHardNonContent(input)) return "lowpriority";
  // 有关键词 + 排名好 → 健康
  if (
    keywordCount >= DAILY_KEYWORD_MIN &&
    position > 0 &&
    position <= HEALTHY_POSITION_MAX
  ) {
    return "healthy";
  }
  // 有关键词但不达健康线（排名靠后 / 关键词少）→ 可优化
  if (keywordCount >= 1) return "improve";
  // 无关键词：正常内容页 → 待激活（发力点）；目录/分页/政策页 → 低优先
  return isNonContentPage(input) ? "lowpriority" : "activate";
}

export const HEALTH_META: Record<
  HealthState,
  { label: string; latin: string; hint: string; color: string }
> = {
  healthy: {
    label: "健康",
    latin: "SANUS",
    hint: "关键词丰富且平均排名进入首页（≤10）——表现良好，保持节奏即可。",
    // 庄园苔绿 —— 与机柜概览 StatusDot / 收录灯同绿，比荧光翡翠绿更沉稳协调
    color: "#7BA67D",
  },
  improve: {
    label: "可优化",
    latin: "AUGENDUS",
    hint: "已有关键词基础，但排名靠后或关键词偏少——有上升空间，值得推一把。",
    // 暖黄铜
    color: "#EFD89A",
  },
  activate: {
    label: "待激活",
    latin: "DORMIENS",
    hint: "已收录、有曝光，却没有任何关键词排名——多为内容待优化的正常页，是发力点。",
    // 琥珀橙
    color: "#F59E0B",
  },
  lowpriority: {
    label: "低优先",
    latin: "INFIMUS",
    hint: "无关键词且为政策 / 目录 / 资源类结构页——正常现象或应 noindex/屏蔽，无需投入。",
    // 冷灰
    color: "#8B8B7A",
  },
};

// ── 页面状态灯（七档统一）─────────────────────────────────────────────────────
// 一条灯同时表达"收录到哪一步（收录态）"和"收录后健不健康（本周 vs 上周趋势）"。
// 与上面的 classifyHealth/HEALTH_META 是两套并存的口径：classifyHealth 按关键词+排名判，
// 本套按 GSC 收录态 + 周环比点击判，状态灯用本套。两者都保留，别处可能各有引用。
export type PageStatus =
  | "unchecked"
  | "undiscovered"
  | "discovered"
  | "crawled"
  | "error"
  | "healthy"
  | "declining";

export const PAGE_STATUS_META: Record<
  PageStatus,
  { label: string; latin?: string; hint: string; color: string; hollow?: boolean }
> = {
  unchecked: {
    label: "未检查",
    latin: "INTACTUS",
    hint: "尚无收录记录（既无 indexed 结果、也无 GSC 覆盖文案）——还没查过这页。",
    color: "#6B6B5E", // 暗灰（空心）
    hollow: true,
  },
  undiscovered: {
    label: "未发现",
    latin: "IGNOTUS",
    hint: "Google 还不知道这个 URL（unknown to Google）——尚未进入抓取队列。",
    color: "#C2C2B6", // 浅灰
  },
  discovered: {
    label: "发现未抓取",
    latin: "REPERTUS",
    hint: "Google 已发现该 URL 但还没抓取（Discovered - currently not indexed）——多为抓取预算/优先级问题。",
    color: "#8E8E80", // 灰
  },
  crawled: {
    label: "抓取未收录",
    latin: "EXPLORATUS",
    hint: "已抓取但未收录（Crawled - currently not indexed），或 noindex / 重复 / 备用页 / 重定向等「抓了故意不收」的情形。",
    color: "#5C5C50", // 深灰
  },
  error: {
    label: "错误",
    latin: "ERRATUM",
    hint: "硬错误（服务器 5xx / 404 未找到等）——页面取不到或返回错误，需排查。",
    color: "#B8453A", // 红
  },
  healthy: {
    label: "收录·健康",
    latin: "SANUS",
    hint: "已收录且未下滑（本周点击 ≥ 上周）——表现良好，保持节奏即可。",
    color: "#7BA67D", // 绿
  },
  declining: {
    label: "收录·需优化",
    latin: "LABENS",
    hint: "已收录但在下滑（本周点击 < 上周，且上周有像样量）——值得人去看一眼。",
    color: "#E8883A", // 橙
  },
};

/**
 * 七档统一状态灯判定。优先级（从硬到软）：
 *   硬错误 → 未发现 → 发现未抓取 → 抓取未收录 → （已收录）下滑?需优化:健康 → 无记录=未检查。
 * coverageText 一律小写 includes 模糊匹配（GSC 是自由文案，绝不全等），中英文都覆盖
 * （口径参考 coverage-loader 的 coverageLabelFromText）。
 *
 * @param indexed          GSC 裁决：true=已收录 / false=未收录 / null=无记录
 * @param coverageText     GSC 覆盖原话（英文 coverageState 或中文裁决整句），可空
 * @param declining        本周点击 < 上周（由调用方算好传入）
 * @param declineComparable 上周是否有像样量（够判趋势；防噪声下限由调用方定）
 */
export function classifyPageStatus(input: {
  indexed: boolean | null;
  coverageText?: string;
  declining: boolean;
  declineComparable: boolean;
}): PageStatus {
  const { indexed, coverageText, declining, declineComparable } = input;
  const t = coverageText ?? "";
  const s = t.toLowerCase();

  // 1) 硬错误：服务器 5xx / 404 / not found（中英覆盖）
  if (
    s.includes("server error") ||
    s.includes("5xx") ||
    s.includes("404") ||
    s.includes("not found") ||
    t.includes("服务器错误") ||
    t.includes("未找到")
  ) {
    return "error";
  }

  // 2) 未发现：Google 不知道这个 URL
  if (s.includes("unknown to google") || t.includes("未发现")) {
    return "undiscovered";
  }

  // 3) 发现未抓取
  if (
    s.includes("discovered - currently not indexed") ||
    (s.includes("discovered") && s.includes("not indexed")) ||
    t.includes("已发现·未收录") ||
    t.includes("已发现")
  ) {
    return "discovered";
  }

  // 4) 抓取未收录 + "抓了故意不收"（noindex / 重复 / 备用 / 重定向）
  if (
    s.includes("crawled - currently not indexed") ||
    (s.includes("crawled") && s.includes("not indexed")) ||
    s.includes("noindex") ||
    s.includes("duplicate") ||
    s.includes("alternate") ||
    s.includes("redirect") ||
    t.includes("已抓取·未收录") ||
    t.includes("已抓取") ||
    t.includes("重复") ||
    t.includes("备用") ||
    t.includes("重定向")
  ) {
    return "crawled";
  }

  // 5) 已收录：看本周 vs 上周趋势
  if (indexed === true) {
    return declining && declineComparable ? "declining" : "healthy";
  }

  // 6) 都不命中且无记录 → 未检查
  return "unchecked";
}
