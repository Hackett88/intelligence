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
