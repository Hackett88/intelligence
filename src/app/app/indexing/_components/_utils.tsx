"use client";

import * as React from "react";
import type { IndexState, ClusterKey, QueryRow } from "./_mock";
import { classifyHealth, HEALTH_META, type HealthState } from "@/lib/gsc/classify";

// ───────────────────────────────────────────────────────────────────────────
// 收录状态点 — 4 档：indexed(绿) / discovered(琥珀) / excluded(灰) / error(红)
// ───────────────────────────────────────────────────────────────────────────

const INDEX_STATE_META: Record<IndexState, { label: string; latin: string; dot: string; ring: string }> = {
  indexed: {
    label: "已收录",
    latin: "AGNITUS",
    dot: "radial-gradient(circle at 30% 30%, #BDE6B1, #7BA67D 55%, #3D5C46)",
    ring: "rgba(189,230,177,.65)",
  },
  discovered: {
    label: "已发现",
    latin: "INVENTUS",
    dot: "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
    ring: "rgba(239,216,154,.65)",
  },
  excluded: {
    label: "已排除",
    latin: "EXCLUSUS",
    dot: "radial-gradient(circle at 30% 30%, #777, #444 55%, #222)",
    ring: "rgba(120,120,120,.4)",
  },
  error: {
    label: "异常",
    latin: "ERRATUM",
    dot: "radial-gradient(circle at 30% 30%, #F0B3A5, #C46B5A 55%, #6F2A1F)",
    ring: "rgba(240,179,165,.7)",
  },
};

export function indexStateLabel(state: IndexState): string {
  return INDEX_STATE_META[state].label;
}

export function IndexStateDot({ state, size = 8 }: { state: IndexState; size?: number }) {
  const meta = INDEX_STATE_META[state];
  return (
    <span
      aria-label={`${meta.label} · ${meta.latin}`}
      title={`${meta.label} · ${meta.latin}`}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 9999,
        background: meta.dot,
        boxShadow: `0 0 6px ${meta.ring}`,
      }}
    />
  );
}

export function IndexStateChip({ state }: { state: IndexState }) {
  const meta = INDEX_STATE_META[state];
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10.5px] border border-manor-line bg-manor-bg2">
      <IndexStateDot state={state} size={6} />
      <span className="text-manor-ink/85">{meta.label}</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 健康灯 —— "状态"列从单纯的"收录态"升级为"健康/可优化/待激活/低优先"业务态。
//   背景：真实 GSC 数据里几乎所有页都是 indexed，旧绿灯一片绿、不传达任何信息。
//   新逻辑：indexed/discovered 的页按 classifyHealth(关键词数+排名+类型) 分 4 档；
//          excluded/error 这两种收录态本身就是结论，沿用旧收录灯（真实数据极少出现）；
//          合成目录节点没有页面数据 → 中性灯（不评健康）。
// ───────────────────────────────────────────────────────────────────────────

type StatusKind = HealthState | "excluded" | "error" | "directory";

export interface PageStatusInput {
  indexState: IndexState;
  queries?: QueryRow[];
  position: number;
  pageType: string;
  fullUrl?: string; // 资源/分页 URL 识别用，无关键词页据此区分"待激活"与"低优先"
  isSynthetic?: boolean;
}

interface ResolvedStatus {
  kind: StatusKind;
  label: string;
  latin: string;
  color: string;
  hint: string;
}

const STATUS_EXTRA_META: Record<"excluded" | "error" | "directory", Omit<ResolvedStatus, "kind">> = {
  excluded: {
    label: "未收录",
    latin: "EXCLUSUS",
    color: "#8B8B7A",
    hint: "GSC 未收录该页（已排除），无法评估健康度。",
  },
  error: {
    label: "异常",
    latin: "ERRATUM",
    color: "#C46B5A",
    hint: "GSC 报告该页处于异常状态，需排查抓取 / 收录问题。",
  },
  directory: {
    label: "目录",
    latin: "INDEX",
    color: "#5C6B5E",
    hint: "合成的目录层级节点，本身不是真实页，不评估健康度。",
  },
};

export function resolvePageStatus(page: PageStatusInput): ResolvedStatus {
  if (page.isSynthetic) return { kind: "directory", ...STATUS_EXTRA_META.directory };
  if (page.indexState === "excluded") return { kind: "excluded", ...STATUS_EXTRA_META.excluded };
  if (page.indexState === "error") return { kind: "error", ...STATUS_EXTRA_META.error };
  const h = classifyHealth({
    keywordCount: page.queries?.length ?? 0,
    position: page.position,
    pageType: page.pageType,
    url: page.fullUrl,
  });
  return { kind: h, ...HEALTH_META[h] };
}

/** 健康灯小圆点 —— 复刻机柜概览 StatusDot 的"立体玻璃珠"质感：
 *  左上高光 → 基色(55%) → 暗边 三段径向渐变 + 同色辉光。
 *  颜色仍由健康度 m.color 决定（健康绿/可优化黄/待激活橙/低优先灰…），
 *  用 color-mix 从单色自动派生亮/暗两端，无需为每档手调三色。
 *  directory（合成目录节点，不评健康）保持弱化：单色 + 半透明、无光晕。 */
export function HealthDot({ page, size = 9 }: { page: PageStatusInput; size?: number }) {
  const m = resolvePageStatus(page);
  const muted = m.kind === "directory";
  const c = m.color;
  const hi = `color-mix(in srgb, ${c} 42%, #ffffff)`; // 高光（提亮）
  const lo = `color-mix(in srgb, ${c} 62%, #000000)`; // 暗边（压暗）
  return (
    <span
      aria-label={`${m.label} · ${m.latin}`}
      title={`${m.label} · ${m.latin} —— ${m.hint}`}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 9999,
        background: muted
          ? c
          : `radial-gradient(circle at 30% 30%, ${hi}, ${c} 55%, ${lo})`,
        opacity: muted ? 0.5 : 1,
        boxShadow: muted ? "none" : `0 0 6px ${c}b3`,
      }}
    />
  );
}

/** 健康态 chip —— 抽屉里用，灯 + 中文标签 + 拉丁副名。 */
export function HealthChip({ page }: { page: PageStatusInput }) {
  const m = resolvePageStatus(page);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10.5px] border"
      title={m.hint}
      style={{ borderColor: `${m.color}55`, background: `${m.color}14` }}
    >
      <HealthDot page={page} size={7} />
      <span className="text-manor-ink/90">{m.label}</span>
      <span className="text-manor-inkGhost text-[9px] tracking-[0.16em]">{m.latin}</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 页面类型 chip — 12 类（SEO 行业通行的 page template 分类）
// 配色策略：4 tier 分层
//   T1 金主突出  → 全站枢纽 / 头部商业（首页 / PDP）
//   T2 金次/暖色 → 核心商业转化（PLP / Tool / Landing）
//   T3 特殊高亮  → 长青内容（Guide 琥珀 / Comparison 暗红决策型）
//   T4 中性弱化  → 辅助页（Blog / Article / FAQ / About / Blog Index）
// 同色微差异（border 透明度）可接受，与语义层级一致。
// ───────────────────────────────────────────────────────────────────────────

// ─── 色彩设计规则 ───
// 所有 chip 必须"浮在"卡片背景之上 → 用 manor-bg3（中深）作底，绝不用 manor-bg（最深，会下沉成"墨印章"）
// T4 弱化层级保留：靠"字色饱和度 + 边框透明度" 区分，不靠"全黑+灰字"
// 字色统一走 brass 系（古铜金），与庄园主题一致；T4 用 brassDim/60-70 透明度自然弱化
const PAGE_TYPE_COLOR: Record<string, string> = {
  // T1 — 最强金光
  "首页":       "bg-manor-brassDim/15 text-manor-brassHi border-manor-brassHi/60",
  "产品详情页": "bg-manor-bg3 text-manor-brassHi border-manor-brassDim/55",
  // T2 — 主路径
  "品类列表页": "bg-manor-bg3 text-manor-brassDim border-manor-brassDim/45",
  "工具页":     "bg-manor-bg3 text-manor-gold border-manor-goldDim/50",
  "落地页":     "bg-manor-bg3 text-manor-amber border-manor-amberDim/50",
  // T3 — 辅助引流
  "指南教程":   "bg-manor-bg3 text-manor-amber border-manor-amberDim/40",
  "对比页":     "bg-manor-bg3 text-manor-oxbloodHi border-manor-oxbloodDim/50",
  // T4 — 弱化（古铜淡金"安静铭牌"，不再墨黑下沉）
  "博客文章":   "bg-manor-bg3 text-manor-brassDim/85 border-manor-brassDim/30",
  "资讯新闻":   "bg-manor-bg3 text-manor-brassDim/75 border-manor-brassDim/25",
  "博客目录":   "bg-manor-bg3 text-manor-brassDim/85 border-manor-brassDim/30",
  "常见问题":   "bg-manor-bg3 text-manor-brassDim/80 border-manor-brassDim/30",
  "关于页":     "bg-manor-bg3 text-manor-brassDim/75 border-manor-brassDim/25",
  "政策页":     "bg-manor-bg3 text-manor-brassDim/70 border-manor-brassDim/25",
  // T5 — 非内容 / noindex 候选（最弱化，冷灰，与内容页拉开）
  "资源文件":   "bg-manor-bg3 text-manor-inkDim/70 border-manor-line",
  "系统页":     "bg-manor-bg3 text-manor-inkDim/70 border-manor-line",
};
const NEUTRAL_BADGE = "bg-manor-bg3 text-manor-brassDim/70 border-manor-brassDim/25";

// ─── 页面类型 — 真实用户进入网站的顺序 ───
// 排序依据：用户从入口到深度的典型路径 + 商业漏斗优先级
//   入口主路径   → 首页 → 品类 → 产品（电商核心漏斗）
//   营销/获客    → 落地页（付费/活动入口）
//   内容获客     → 指南教程 / 博客目录 / 博客文章 / 资讯新闻（SEO 长尾入口）
//   决策辅助     → 对比页 / 工具页
//   信任与支持   → 常见问题 / 关于页
// 用于 FilterBar 下拉、表格分组等任何需要"按重要性 / 路径"展示页面类型的场景
export const PAGE_TYPE_ORDER: string[] = [
  "首页",
  "品类列表页",
  "产品详情页",
  "落地页",
  "指南教程",
  "博客目录",
  "博客文章",
  "资讯新闻",
  "对比页",
  "工具页",
  "常见问题",
  "关于页",
  "政策页",
  // 非内容 / noindex 候选 —— 排最后（最低优先级）
  "资源文件",
  "系统页",
];

export function comparePageType(a: string, b: string): number {
  const ia = PAGE_TYPE_ORDER.indexOf(a);
  const ib = PAGE_TYPE_ORDER.indexOf(b);
  // 不在表里的（未来新增类型）排在最后，按字母兜底
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export function PageTypeChip({ value, size = "md" }: { value: string | null; size?: "sm" | "md" }) {
  if (!value) return <span className="text-manor-inkGhost">—</span>;
  const cls = PAGE_TYPE_COLOR[value] ?? NEUTRAL_BADGE;
  // sm —— 用在密度高的小卡上（如树视图棱面），尺寸约为 md 的 0.85x
  const sizeCls = size === "sm" ? "px-1 py-0 text-[10px] leading-[14px]" : "px-1.5 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center rounded border ${sizeCls} ${cls}`}>
      {value}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 排名分桶 — Position 1-3 / 4-10 / 11-20 / 21+
// ───────────────────────────────────────────────────────────────────────────

export type PositionBucket = "top3" | "top10" | "page2" | "deep" | "none";

export function positionBucket(pos: number): PositionBucket {
  if (!pos || pos <= 0) return "none";
  if (pos <= 3) return "top3";
  if (pos <= 10) return "top10";
  if (pos <= 20) return "page2";
  return "deep";
}

const POSITION_BUCKET_LABEL: Record<PositionBucket, string> = {
  top3: "1-3 首位",
  top10: "4-10 首页",
  page2: "11-20 第二页",
  deep: "21+ 深页",
  none: "无排名",
};

export function positionBucketLabel(b: PositionBucket): string {
  return POSITION_BUCKET_LABEL[b];
}

// indexState 可选参数：当页面是 excluded / error（没进 GSC 数据）时整列显"—"；
// indexed / discovered 即使指标=0 也按真值显示（GSC 里曝光极低 / 长尾排名页）。
type IndexStateLite = "indexed" | "discovered" | "excluded" | "error";

export function formatPosition(pos: number, indexState?: IndexStateLite): React.ReactNode {
  if (indexState === "excluded" || indexState === "error") {
    return <span className="text-manor-inkGhost">—</span>;
  }
  if (!pos || pos <= 0) return <span className="text-manor-inkGhost">—</span>;
  const b = positionBucket(pos);
  const color =
    b === "top3"  ? "text-manor-brassHi" :
    b === "top10" ? "text-manor-brassDim" :
    b === "page2" ? "text-manor-inkDim" :
                    "text-manor-oxbloodHi";
  return (
    <span className={`${color} text-xs tabular-nums font-medium`}>
      {pos.toFixed(1)}
    </span>
  );
}

export function formatCtr(ctr: number, indexState?: IndexStateLite): React.ReactNode {
  if (indexState === "excluded" || indexState === "error") {
    return <span className="text-manor-inkGhost">—</span>;
  }
  // 此处不再用 ctr<=0 兜底成"—"；ctr=0（有曝光无点击）应真实展示为 "0.0%"
  const pct = (ctr || 0) * 100;
  const color =
    pct >= 5   ? "text-manor-brassHi" :
    pct >= 2   ? "text-manor-brassDim" :
    pct >= 0.5 ? "text-manor-inkDim"  :
                 "text-manor-inkFaint";
  return (
    <span className={`${color} text-xs tabular-nums`}>
      {pct.toFixed(1)}%
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 站点语言标签 — 「收录与索引」模块的「站点语言」列 / 筛选 / 详情共用
//
// 底层 market 值是 inferMarket(transform.ts) 按 URL 语言/地区前缀推断的代码
// （无前缀 → us）。这里按各前缀「代表的语言版本」显示，而非国家 —— GA4 已证实
// 流量来源国家与 URL 前缀并不对应（无前缀英文页主力是巴基斯坦而非美国），故此
// 列表达的是「站点语言版本」，且不挂国旗，以免重新引入「这是某国流量」的暗示。
// ───────────────────────────────────────────────────────────────────────────

export const LANG_SITE_LABELS: Record<string, string> = {
  us: "英语",      // 无前缀 / 默认英文站
  sa: "阿拉伯语",   // /ar/
  fr: "法语",      // /fr/
  de: "德语",      // /de/
  tr: "土耳其语",   // /tr/
  es: "西班牙语",   // /es/
  br: "葡萄牙语",   // /pt/
  id: "印尼语",    // /id/
  my: "马来语",    // /ms/
  pk: "乌尔都语",   // /ur/
  jp: "日语",      // /ja/
  cn: "中文",      // /zh/
  // 其它国家代码若出现，回落到对应语言
  uk: "英语", gb: "英语", au: "英语", ca: "英语", ng: "英语",
  ae: "阿拉伯语", eg: "阿拉伯语", ma: "阿拉伯语", bd: "孟加拉语",
};

export function LangSiteCell({ market }: { market: string | null }) {
  if (!market) return <span className="text-manor-inkGhost">—</span>;
  const label = LANG_SITE_LABELS[market.toLowerCase()] ?? market.toUpperCase();
  return <span className="text-xs text-manor-inkDim">{label}</span>;
}

// ───────────────────────────────────────────────────────────────────────────
// 数字格式化
// ───────────────────────────────────────────────────────────────────────────

export function formatLargeNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

export function formatTimeHHMM(date: Date | string | null): string {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ───────────────────────────────────────────────────────────────────────────
// 内容集群中文名映射 — 用于「分组视图」的二级折叠标签
// ───────────────────────────────────────────────────────────────────────────

// WESLAMIC 业务集群中文名 — 与 _mock.ts 中的 ClusterKey 一一对应
export const CLUSTER_LABELS: Record<ClusterKey, string> = {
  "brand":             "品牌站点",
  "zikr-ring":         "智能指环",
  "islamic-jewelry":   "伊斯兰饰品",
  "tasbih":            "念珠系列",
  "necklace":          "定制项链",
  "itasbih-app":       "iTASBIH App",
  "tools":             "伊斯兰工具",
  "scene-gift":        "礼赠场景",
  "scene-night":       "夜间仪式",
  "scene-slow":        "慢生活",
  "knowledge-dhikr":   "Dhikr 知识",
};

export function clusterLabel(key: string): string {
  return CLUSTER_LABELS[key as ClusterKey] ?? key;
}
