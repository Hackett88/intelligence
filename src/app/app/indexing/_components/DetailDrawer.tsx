"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, ExternalLink, AlertTriangle, Info, Pencil, Check, ChevronDown, Send, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { usePageTrend, PageTrendSection } from "./PageTrendChart";
import type { PageDetail, QueryRow, Ga4Metrics, Ga4Country } from "./_mock";
import { GA4_COUNTRY_BY_LANG, ga4CountryPoolKey } from "./_mock";
import type { TimeWindow } from "./FilterBar";
import { isAssetUrl } from "@/lib/gsc/classify";
import {
  LANG_SITE_LABELS,
  PageTypeChip,
  PAGE_TYPE_ORDER,
  IndexStateChip,
  PageStatusChip,
  coverageLabelColor,
  formatPosition,
  formatCtr,
  formatLargeNumber,
  indexStateLabel,
} from "./_utils";

interface DetailDrawerProps {
  page: PageDetail | null;
  timeWindow: TimeWindow;
  onTimeWindowChange: (v: TimeWindow) => void;
  onClose: () => void;
  syncEnabled?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// 内联子组件：Field / Section / Metric tile / Mini segmented
// ───────────────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-manor-inkDim uppercase tracking-wider leading-none">
        {label}
      </span>
      <div className="text-manor-ink text-sm font-medium leading-snug break-all">
        {value === null || value === undefined || value === ""
          ? <span className="text-manor-inkGhost font-normal">—</span>
          : value}
      </div>
    </div>
  );
}

// 页面类型字段：展示 chip + 铅笔图标；点击铅笔在原位展开「下拉 + 确定/取消」修正框。
// 确定后调 /api/indexing/page-type 落盘修正，再 router.refresh() 让 RSC 重读、把修正
// 后的 pageType 流回 props（与"更新"同步后的刷新机制一致）。修正按 fullUrl 持久化，
// 独立于 GSC 同步 —— 下次同步重新推断也不会盖掉。
function PageTypeField({ fullUrl, pageType }: { fullUrl: string; pageType: string }) {
  // 切换到另一个页面时由父级 key={fullUrl} 重挂载本组件 → 状态自然重置（editing=false、
  // value=新 pageType）；同页内重新打开编辑由铅笔 onClick 重置 value。故无需 effect 同步。
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(pageType);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (value === pageType) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/indexing/page-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl, pageType: value }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) throw new Error(data?.message ?? "保存失败");
      setEditing(false);
      router.refresh(); // RSC 重读 snapshot（已套用修正）→ 新 pageType 流回
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PageTypeChip value={pageType} />
        <button
          type="button"
          onClick={() => { setValue(pageType); setError(null); setEditing(true); }}
          title="修正页面类型"
          aria-label="修正页面类型"
          className="text-manor-brassDim hover:text-manor-brassHi transition-colors shrink-0"
        >
          <Pencil size={11} />
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        className="w-full bg-manor-bg3 border border-manor-brass/40 rounded text-manor-ink text-xs px-1.5 py-1 outline-none focus:border-manor-brassHi/70 disabled:opacity-60"
        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
      >
        {PAGE_TYPE_ORDER.map((t) => (
          <option key={t} value={t} className="bg-manor-bg3 text-manor-ink">
            {t}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-manor-brassHi/55 text-manor-brassHi bg-manor-brassDim/15 hover:bg-manor-brassDim/25 transition-colors disabled:opacity-60"
        >
          <Check size={11} />
          {saving ? "保存中…" : "确定"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); setValue(pageType); }}
          disabled={saving}
          className="px-2 py-0.5 rounded text-[11px] border border-manor-brass/25 text-manor-inkDim hover:text-manor-ink transition-colors disabled:opacity-60"
        >
          取消
        </button>
      </div>
      {error && <span className="text-[10px] text-manor-oxbloodHi">{error}</span>}
    </div>
  );
}

// 请求 Google 索引按钮 —— 仅本地环境、仅未收录页显示。
// 调 POST /api/indexing/request-index 代驾本地浏览器到 GSC 提交该 URL。
function RequestIndexButton({ fullUrl }: { fullUrl: string }) {
  const [loading, setLoading] = React.useState(false);

  const handleRequest = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/indexing/request-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        status?: string;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message || "请求索引失败", { duration: 6000 });
        return;
      }
      switch (data.status) {
        case "requested":
          toast.success("已加入 Google 优先抓取队列，等待重新抓取", {
            duration: 6000,
          });
          break;
        case "already_indexed":
          toast.info("该页已收录，无需请求", { duration: 4000 });
          break;
        case "captcha":
          toast.warning("需在浏览器手动完成验证码后重试", { duration: 8000 });
          break;
        case "quota_exceeded":
          toast.warning(
            "今日 Google 请求索引配额已用尽，请明天再试",
            { duration: 6000 },
          );
          break;
        case "throttled":
          toast.warning(
            "GSC 暂时限流（弹出「请稍后重试」），本页未提交成功，请过一会儿再试",
            { duration: 6000 },
          );
          break;
        case "failed":
          toast.error(data.message || "请求索引失败", { duration: 6000 });
          break;
        default:
          toast.error(data.message || "未知响应", { duration: 6000 });
      }
    } catch (err) {
      toast.error("请求索引失败", {
        description: err instanceof Error ? err.message : "网络错误",
        duration: 6000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRequest}
      disabled={loading}
      title="向 Google 请求优先抓取此页面（需本地浏览器代驾 GSC）"
      className="mt-1 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border border-manor-brassHi/45 text-manor-brassHi bg-manor-brassDim/10 hover:bg-manor-brassDim/20 hover:border-manor-brassHi/65 transition-all disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
      style={{
        fontFamily: "var(--font-sc), 'Cormorant SC', serif",
        letterSpacing: "0.08em",
      }}
    >
      {loading ? (
        <RefreshCw size={11} className="animate-spin" aria-hidden="true" />
      ) : (
        <Send size={11} aria-hidden="true" />
      )}
      {loading ? "请求中…" : "请求 Google 索引"}
    </button>
  );
}

const SECTION_LATIN: Record<string, string> = {
  "基本信息":       "CARTA · PAGINAE",
  "性能指标":       "METRICA · GSC",
  "流量构成":       "FONS · VIAE",
  "进站后表现":     "BEHAVIOR · GA4",
  "流量趋势":       "CURSUS · DIERUM",
  "页面关键词排名":  "QUAERELAE · IN PAGINA",
  "关联词库":       "NEXUS · ARCHIVUM",
};

// 互动时长：秒 → "1分23秒" / "45秒"
function formatEngagementTime(sec: number): string {
  if (!sec || sec <= 0) return "0秒";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// 互动率分档 —— 互动率的门槛（>10s / ≥2 浏览 / 有关键事件）是低位绝对阈值，
// 不随内容长短线性漂移，故可用绝对区间给"好/一般/偏低"判断（与平均时长不同）。
// 阈值依据（research-ga4-engagement-rate-standard-2026-05-27）：Databox 真实账户聚合
// 全行业中位 ~56%、电商 ~64%。原 55/35 偏松（绿灯≈及格线、红线过松）。这里取
// 「通用偏严」版 60/45（站点电商+大量长篇内容混合）。后续接真实 GA4 后，应改为按
// 「页面类型」自校准（用本站同类型页 P50/P25 定线，商品页可收紧到 65/50）。
function engagementTier(rate: number): { label: string; color: string } {
  if (rate >= 0.60) return { label: "良好", color: "#7BA67D" };  // 庄园 sage 绿（manor-sageHi）
  if (rate >= 0.45) return { label: "一般", color: "#D4A574" };  // 庄园琥珀（manor-amber）
  return { label: "偏低", color: "#C46B5A" };                    // 庄园暗红（manor-oxblood）
}

// 真实页近 28 天无 GA4 着陆流量 → 段内诚实空态（替代旧的"示例值"兜底）。
// 文案按会话着陆口径（landing_page）措辞：对真零流量页准确，对"有非入口访问"的页
// 也不误导（tooltip 说明少量非入口访问不计入）。
function Ga4NoDataCallout() {
  return (
    <div
      className="px-3 py-3 rounded text-[11px] leading-relaxed text-manor-inkFaint"
      style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(224,197,122,.14)" }}
    >
      <span
        className="block text-manor-ink/70 mb-0.5"
        title="按 GA4 会话着陆口径（landing_page）统计近 28 天。少量非入口访问（用户从站内其他页跳转到达）不计入此处。"
      >
        近 28 天无 GA4 着陆流量
      </span>
      <span className="text-manor-inkFaint">
        该页在近 28 天内未作为会话着陆页产生访问 —— 故无进站后行为数据。曝光/点击见上方 GSC 指标。
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  extra,
  grid = true,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
  grid?: boolean;
}) {
  const latin = SECTION_LATIN[title] ?? "SECTIO";
  return (
    <div className="glass-panel overflow-hidden relative" style={{ borderRadius: 4 }}>
      <div
        className="px-3 py-2.5 border-b border-manor-brass/35 flex items-center gap-2 relative"
        style={{
          background:
            "linear-gradient(180deg, rgba(26,52,36,.95) 0%, rgba(12,28,18,.97) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(239,216,154,.2), inset 0 -1px 0 rgba(0,0,0,.45)",
        }}
      >
        <span
          aria-hidden="true"
          className="shrink-0"
          style={{
            width: 5,
            height: 5,
            borderRadius: 9999,
            background:
              "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
            boxShadow: "0 0 6px rgba(239,216,154,.65)",
          }}
        />
        <h3
          className="text-brass-gradient font-serif font-semibold leading-none whitespace-nowrap shrink-0"
          style={{
            fontFamily: "var(--font-serif), 'EB Garamond', serif",
            fontSize: 14,
            letterSpacing: "0.03em",
          }}
        >
          {title}
        </h3>
        {/* R108 抽屉降到 420 后窄屏吃紧 → 拉丁副标可隐藏让 divider + extra 优先 */}
        <span
          className="font-sc tracking-[0.32em] text-manor-brassHi leading-none whitespace-nowrap shrink truncate min-w-0"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9.5 }}
        >
          〔{latin}〕
        </span>
        <span className="brass-divider flex-1 min-w-[8px] opacity-60 self-center" />
        {extra && <span className="shrink-0">{extra}</span>}
      </div>
      <div className={grid ? "p-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs" : "p-3 text-xs"}>
        {children}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  latin,
  value,
  subline,
}: {
  label: string;
  latin: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
}) {
  return (
    <div
      className="px-3 py-2.5 relative overflow-hidden"
      style={{
        borderRadius: 4,
        background:
          "linear-gradient(180deg, rgba(20,42,28,.92) 0%, rgba(10,24,16,.96) 100%)",
        border: "1px solid rgba(201, 169, 97, .25)",
        boxShadow:
          "inset 0 1px 0 rgba(224, 197, 122, .15), inset 0 -1px 0 rgba(0, 0, 0, .5)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          aria-hidden="true"
          style={{
            width: 3,
            height: 3,
            transform: "rotate(45deg)",
            background:
              "linear-gradient(135deg, #EFD89A 0%, #A08850 100%)",
            boxShadow: "0 0 4px rgba(239,216,154,.55)",
          }}
        />
        <span
          className="text-manor-brassHi/85 tracking-[0.22em]"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 8.5,
          }}
        >
          {latin}
        </span>
      </div>
      <p
        className="text-brass-gradient font-semibold tabnum leading-none"
        style={{
          fontFamily: "var(--font-serif), 'EB Garamond', serif",
          fontSize: 19,
        }}
      >
        {value}
      </p>
      <p
        className="text-manor-ink/70 mt-1"
        style={{
          fontFamily: "var(--font-serif), 'EB Garamond', serif",
          fontSize: 10.5,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      {subline && (
        <p className="text-manor-inkFaint text-[10px] mt-0.5">{subline}</p>
      )}
    </div>
  );
}

function MiniSegmented({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  // GSC 当前一次同步拉的是 3 个月窗口，7d / 28d 暂时禁用并标注原因。
  const opts: { value: TimeWindow; label: string; disabled?: boolean; reason?: string }[] = [
    { value: "7d",  label: "7d",  disabled: true, reason: "GSC 当前一次同步拉的是 3 个月窗口" },
    { value: "28d", label: "28d", disabled: true, reason: "GSC 当前一次同步拉的是 3 个月窗口" },
    { value: "90d", label: "90d" },
  ];
  return (
    <div
      className="inline-flex items-center border border-manor-brass/30 rounded overflow-hidden"
      style={{ height: 20 }}
    >
      {opts.map((o) => {
        const active = value === o.value;
        const disabled = !!o.disabled;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            title={o.reason}
            onClick={() => { if (!disabled) onChange(o.value); }}
            className={[
              "px-1.5 text-[10px] tracking-wide transition-colors border-r border-manor-brass/15 last:border-r-0",
              disabled
                ? "text-manor-inkFaint/60 cursor-not-allowed opacity-50"
                : active
                ? "text-manor-brassHi bg-manor-brassDim/15"
                : "text-manor-inkDim hover:text-manor-brassHi",
            ].join(" ")}
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// GA4 进站后表现固定取近 28 天窗口（无多档可切）——做成静态徽标，视觉对齐 MiniSegmented
// 的「激活段」（同款边框/圆角/高度/字号/SC 小型大写），摆在段头右上角，与「性能指标」的
// 90d 同位呼应。小写 "28d" 经 Cormorant SC 渲染为小型大写，显示与 90d 一致。
function Ga4WindowBadge() {
  return (
    <span
      title="GA4 全渠道口径 · 固定近 28 天窗口（GSC 性能为 90 天，时间窗待对齐）"
      className="inline-flex items-center border border-manor-brass/30 rounded px-1.5 text-manor-brassHi bg-manor-brassDim/15 tracking-wide"
      style={{ height: 20, fontSize: 10, fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
    >
      28d
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Query rank table (内联 — 不需要 useReactTable 这种重武器)
// ───────────────────────────────────────────────────────────────────────────

// ── 无关键词数据的页面 → 分类标注 ─────────────────────────────────────────────
// GSC 单页 query 视图给不出明细的页分三类（依据 batch#4 实测 128 页分布）：
//   1) 资源文件：命中静态资源/CDN 路径，本不该被当页面收录 → 应 noindex/屏蔽
//   2) 目录/分页页：聚合/分页类，天然无独立关键词 → 正常
//   3) 低曝光被隐藏：有曝光但低于 GSC 隐私阈值，query 被隐藏 → 非问题，月度全量重试
// 资源正则与健康/周期分类共用同一份（classify.ts），避免两处口径漂移。

type NoDataKind = "asset" | "listing" | "lowImpr";
interface NoDataTag {
  kind: NoDataKind;
  label: string; // 短标签（记号）
  latin: string;
  hint: string; // 详细说明
  tone: "warn" | "neutral";
}

function classifyNoKeywordData(page: { fullUrl: string; pageType: string }): NoDataTag {
  if (isAssetUrl(page.fullUrl)) {
    return {
      kind: "asset",
      label: "资源文件 · 建议屏蔽",
      latin: "RES · NON PAGINA",
      hint: "URL 命中静态资源 / CDN 路径，本不该作为页面被收录。建议加 noindex 或在 robots 屏蔽，避免占用抓取预算。",
      tone: "warn",
    };
  }
  if (
    page.pageType === "博客目录" ||
    page.pageType === "品类列表页" ||
    /[?&]page=/.test(page.fullUrl)
  ) {
    return {
      kind: "listing",
      label: "目录/分页页 · 正常无词",
      latin: "INDEX · PAGINARUM",
      hint: "聚合 / 分页类页面，通常没有独立的关键词排名，属正常现象，一般无需处理。",
      tone: "neutral",
    };
  }
  return {
    kind: "lowImpr",
    label: "低曝光 · GSC 暂未提供",
    latin: "INFRA · LIMEN",
    hint: "该页有曝光、但 GSC 未给出关键词明细 —— 多因曝光量低于 Google 的隐私阈值被隐藏，并非页面本身的问题。下次月度全量会自动重试。",
    tone: "neutral",
  };
}

// 段头小记号（一眼识别）
function NoDataChip({ tag }: { tag: NoDataTag }) {
  const warn = tag.tone === "warn";
  return (
    <span
      title={tag.hint}
      className={[
        "inline-flex items-center px-1.5 py-0.5 rounded border text-[9.5px] whitespace-nowrap",
        warn
          ? "border-amber-500/45 text-amber-300/90 bg-amber-500/10"
          : "border-manor-brass/30 text-manor-inkDim",
      ].join(" ")}
    >
      {tag.label}
    </span>
  );
}

// 区块内详细说明
function NoKeywordCallout({ tag }: { tag: NoDataTag }) {
  const warn = tag.tone === "warn";
  const Icon = warn ? AlertTriangle : Info;
  return (
    <div
      className="flex flex-col items-center text-center py-5 px-3 gap-2"
      style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
    >
      <Icon size={18} className={warn ? "text-amber-500/90" : "text-manor-brassHi/70"} />
      <span className="font-sc tracking-[0.2em] text-manor-inkFaint text-[9px]">〔{tag.latin}〕</span>
      <p className="text-manor-inkDim text-[11.5px] leading-snug max-w-[300px]">{tag.hint}</p>
    </div>
  );
}

// 可排序的数值列键（与 QueryRow 数值字段一一对应）
type SortKey = "clicks" | "impressions" | "ctr" | "position";
type SortDir = "desc" | "asc";
type QuerySort = { key: SortKey; dir: SortDir } | null;

// 可排序表头：复用主列表（PageTable）的金色 ▲/▼ 指示风格。
// 提到模块顶层以满足 react-hooks/static-components（render 内创建组件会丢 state）。
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: QuerySort;
  onSort: (k: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={active ? (sort!.dir === "desc" ? "由高到低 · 点击切换升序" : "由低到高 · 点击恢复默认") : "点击按此列由高到低排序"}
      className={[
        "text-right py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30",
        "cursor-pointer select-none whitespace-nowrap transition-colors hover:text-[#F0DEA0]",
        active ? "text-manor-brassHi" : "",
      ].join(" ")}
      style={{ textShadow: active ? "0 0 8px rgba(224,197,122,.55)" : undefined }}
      aria-sort={active ? (sort!.dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {label}
        {active && (
          <span className="text-manor-brassHi" style={{ fontSize: 9 }}>
            {sort!.dir === "desc" ? "▼" : "▲"}
          </span>
        )}
      </span>
    </th>
  );
}

// 默认折叠时只显示前 N 条，其余收在「展开全部」之后 —— 25 条一次铺开太长，
// 先给 10 条够看主词，需要再展开，视觉上更克制。
const QUERY_COLLAPSED_COUNT = 10;

function QueryRankTable({ rows }: { rows: QueryRow[] }) {
  // 排序状态：null = 保持原始顺序（GSC 已按点击降序返回）。
  // 点击同一列循环：默认 → 降序(由高到低) → 升序 → 恢复默认。
  const [sort, setSort] = React.useState<QuerySort>(null);
  // 折叠状态：默认只显示前 QUERY_COLLAPSED_COUNT 条。
  const [expanded, setExpanded] = React.useState(false);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "desc" }; // 首点：由高到低
      if (prev.dir === "desc") return { key, dir: "asc" };        // 再点：由低到高
      return null;                                                 // 三点：恢复默认
    });
  };

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const factor = sort.dir === "desc" ? -1 : 1;
    // slice 防止原地 mutate props
    return rows.slice().sort((a, b) => (a[sort.key] - b[sort.key]) * factor);
  }, [rows, sort]);

  // 折叠时只取前 N 条；展开后全量。隐藏条数 > 0 才显示展开按钮。
  const hiddenCount = sortedRows.length - QUERY_COLLAPSED_COUNT;
  const visibleRows =
    expanded || hiddenCount <= 0
      ? sortedRows
      : sortedRows.slice(0, QUERY_COLLAPSED_COUNT);

  if (rows.length === 0) {
    return (
      <div className="text-center py-6 text-manor-inkFaint"
        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 12 }}
      >
        〔 QUAERELAE · VACUUM 〕<br />
        <span className="text-manor-inkGhost text-[11px]">本页面暂无关键词曝光</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-3 px-3">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-manor-brassHi/85">
            <th className="text-left py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">#</th>
            <th className="text-left py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">查询</th>
            <SortableTh label="点击" sortKey="clicks" sort={sort} onSort={toggleSort} />
            <SortableTh label="曝光" sortKey="impressions" sort={sort} onSort={toggleSort} />
            <SortableTh label="CTR" sortKey="ctr" sort={sort} onSort={toggleSort} />
            <SortableTh label="排名" sortKey="position" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((q, i) => (
            <tr
              key={q.query}
              style={{
                borderBottom: "1px solid rgba(201,169,97,.08)",
                background: i % 2 === 0 ? "rgba(16,32,22,.25)" : "transparent",
              }}
            >
              <td className="py-1.5 px-1.5 text-manor-inkFaint tabular-nums">{i + 1}</td>
              <td className="py-1.5 px-1.5 text-manor-ink truncate max-w-[180px]" title={q.query}>
                {q.query}
              </td>
              <td className="py-1.5 px-1.5 text-right text-manor-ink tabular-nums">
                {q.clicks.toLocaleString()}
              </td>
              <td className="py-1.5 px-1.5 text-right text-manor-inkDim tabular-nums">
                {formatLargeNumber(q.impressions)}
              </td>
              <td className="py-1.5 px-1.5 text-right">{formatCtr(q.ctr)}</td>
              <td className="py-1.5 px-1.5 text-right">{formatPosition(q.position)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 展开 / 收起：折叠时显示前 N 条，点击图标展开全部，再点收起 */}
      {hiddenCount > 0 && (
        <div className="flex justify-center pt-2 pb-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            title={expanded ? "收起" : `展开全部 ${sortedRows.length} 条`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] tracking-wide border border-manor-brass/30 text-manor-brassDim hover:text-manor-brassHi hover:border-manor-brass/55 bg-manor-brassDim/5 hover:bg-manor-brassDim/15 transition-colors"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            <ChevronDown
              size={12}
              className="transition-transform"
              style={{ transform: expanded ? "rotate(180deg)" : "none" }}
            />
            {expanded ? "收起" : `展开全部（还有 ${hiddenCount} 条）`}
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 站点语言 × GA4 来源国 一致性诊断
//   语言版页面（/ar /fr /de /tr…）的主力来源国若不在该语言的预期国家池里，多半是
//   hreflang / 国际化错配（流量被引到了错的语言版）。英语默认站天然全球流量，不评一致性。
//   判定用"是否属于本站点语言的国家池"（GA4_COUNTRY_BY_LANG），不靠 country→单一语言
//   的全局映射——一国可属多语族（摩洛哥=阿/法、瑞士=德/法），单值映射会误判。
//   来源国 Top 10 列优先排两列：左列第 1–5 名、右列第 6–10 名；前 3 名带金/银/铜徽章。
// ───────────────────────────────────────────────────────────────────────────

// 排名徽章：前 3 名 = 金 / 银 / 铜 立体小奖牌（左上高光→基色→暗边 + 同色辉光），
// 4 名及以后 = 朴素序号。三色与奖牌质感呼应庄园主题的"立体玻璃珠"做法。
const RANK_MEDALS: Record<number, { hi: string; base: string; lo: string; ring: string; glow: string; text: string }> = {
  1: { hi: "#FFF1C0", base: "#E8C75A", lo: "#9A7B22", ring: "rgba(154,123,34,.85)", glow: "rgba(232,199,90,.7)",  text: "#4A3A0C" }, // 黄金
  2: { hi: "#FCFCFE", base: "#C9CDD6", lo: "#7E838C", ring: "rgba(126,131,140,.85)", glow: "rgba(201,205,214,.55)", text: "#2E3138" }, // 白银
  3: { hi: "#F2C79E", base: "#C77B3E", lo: "#7A451E", ring: "rgba(122,69,30,.85)", glow: "rgba(199,123,62,.55)",  text: "#3A1E0C" }, // 青铜
};
function RankBadge({ rank }: { rank: number }) {
  const m = RANK_MEDALS[rank];
  if (m) {
    return (
      <span
        aria-label={`第 ${rank} 名`}
        title={`第 ${rank} 名`}
        className="inline-flex items-center justify-center shrink-0 font-semibold tabnum"
        style={{
          width: 15, height: 15, borderRadius: 9999, fontSize: 9, lineHeight: 1,
          color: m.text,
          background: `radial-gradient(circle at 32% 28%, ${m.hi}, ${m.base} 58%, ${m.lo})`,
          boxShadow: `0 0 5px ${m.glow}, inset 0 1px 0 rgba(255,255,255,.45)`,
          border: `0.5px solid ${m.ring}`,
          fontFamily: "var(--font-serif), 'EB Garamond', serif",
        }}
      >
        {rank}
      </span>
    );
  }
  return (
    <span
      aria-label={`第 ${rank} 名`}
      className="inline-flex items-center justify-center shrink-0 text-manor-inkFaint tabnum"
      style={{ width: 15, height: 15, fontSize: 9, lineHeight: 1 }}
    >
      {rank}
    </span>
  );
}

function LangGeoConsistency({
  market,
  topCountries,
}: {
  market: string;
  topCountries: Ga4Metrics["topCountries"];
}) {
  const siteCode = (market || "").toLowerCase();
  const siteLangLabel = LANG_SITE_LABELS[siteCode] ?? (market ? market.toUpperCase() : "—");
  const poolKey = ga4CountryPoolKey(siteCode);
  const sitePool = GA4_COUNTRY_BY_LANG[poolKey] ?? [];
  const isEnglishDefault = poolKey === "us";
  const isForeign = (country: string) => !isEnglishDefault && !sitePool.includes(country);
  const dominant = topCountries[0];
  const mismatch = !isEnglishDefault && !!dominant && isForeign(dominant.country);

  const verdict = isEnglishDefault
    ? { text: "英语站 · 全球流量正常", color: "#C9A961", warn: false }
    : mismatch
    ? { text: "疑似 hreflang 不一致", color: "#E0A33A", warn: true }
    : { text: "语言一致", color: "#7BA67D", warn: false };

  const max = Math.max(...topCountries.map((r) => r.activeUsers), 1);
  const rows = topCountries.slice(0, 10);
  const left = rows.slice(0, 5);    // 第 1–5 名
  const right = rows.slice(5, 10);  // 第 6–10 名

  const renderCell = (r: Ga4Country, rank: number) => {
    const foreign = isForeign(r.country);
    return (
      <div
        key={r.country}
        title={`#${rank} ${r.country} · ${r.activeUsers.toLocaleString()} 活跃用户`}
        className="flex flex-col gap-1 px-2 py-1.5 rounded overflow-hidden"
        style={{
          background: foreign ? "rgba(224,163,58,.12)" : "rgba(16,32,22,.5)",
          border: `1px solid ${foreign ? "rgba(224,163,58,.45)" : "rgba(201,169,97,.22)"}`,
        }}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1 min-w-0">
            <RankBadge rank={rank} />
            <span
              className={`text-[10px] leading-tight truncate ${foreign ? "text-amber-300/90" : "text-manor-inkDim"}`}
            >
              {r.country}
            </span>
          </span>
          <span
            className={`text-[12px] tabnum leading-none shrink-0 ${foreign ? "text-amber-300" : "text-manor-brassHi"}`}
          >
            {r.activeUsers.toLocaleString()}
          </span>
        </div>
        <span className="h-[3px] rounded-sm overflow-hidden bg-manor-bg2">
          <span
            className="block h-full"
            style={{
              width: `${(r.activeUsers / max) * 100}%`,
              background: foreign
                ? "linear-gradient(90deg, #8A5A2A, #E0A33A)"
                : "linear-gradient(90deg, #A08850, #EFD89A)",
            }}
          />
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-manor-inkDim uppercase tracking-wider leading-none">
          站点语言 × 来源国
        </span>
        <span
          title={
            mismatch
              ? "该语言版页面的主力来源国不在本语言的预期国家里，可能 hreflang 配置错误 / 国际化失血"
              : isEnglishDefault
              ? "英语默认站，来源国全球分布属正常，不评一致性"
              : "主力来源国与站点语言一致"
          }
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] whitespace-nowrap border"
          style={{ borderColor: `${verdict.color}66`, background: `${verdict.color}1a`, color: verdict.color }}
        >
          {verdict.warn && <AlertTriangle size={9} />}
          {verdict.text}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-manor-inkDim">站点语言</span>
        <span className="text-manor-brassHi">{siteLangLabel}</span>
        <span className="text-manor-inkGhost">·</span>
        <span className="text-manor-inkFaint text-[10px]">GA4 全渠道来源国 Top 10</span>
      </div>
      {rows.length > 0 ? (
        // 列优先两列：左列第 1–5 名、右列第 6–10 名（用两个竖向 stack 保证分列顺序）
        <div className="flex gap-1.5 items-start">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            {left.map((r, i) => renderCell(r, i + 1))}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            {right.map((r, i) => renderCell(r, i + 6))}
          </div>
        </div>
      ) : (
        <span className="text-manor-inkGhost text-xs">—</span>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Main drawer
// ───────────────────────────────────────────────────────────────────────────

export function DetailDrawer({
  page,
  timeWindow,
  onTimeWindowChange,
  onClose,
  syncEnabled,
}: DetailDrawerProps) {
  // 流量趋势 hook — 放在 return null 之前以遵守 hooks 规则（不可条件调用）。
  // page 为 null 时传 null url，hook 内部跳过请求。
  const trend = usePageTrend(
    page?.url ?? null,
    page?.isSynthetic ?? false,
  );

  if (!page) return null;

  // 主关键词：页面级抓取拿不到（GSC 网页视图无 query 维度），用已加载的关键词
  // 排名第一条兜底补上 —— 抓到了就显示，没抓到/加载中仍回落到 page.topQuery。
  const effectiveTopQuery =
    page.queries[0]?.query ??
    (page.topQuery && page.topQuery !== "—" ? page.topQuery : null);

  // 真实页 + 无关键词数据 → 分类标注（资源页 / 目录页 / 低曝光被隐藏）
  const noDataTag =
    !page.isSynthetic && page.queries.length === 0
      ? classifyNoKeywordData(page)
      : null;

  const langSiteLabel = page.market
    ? LANG_SITE_LABELS[page.market.toLowerCase()] ?? page.market.toUpperCase()
    : null;

  // GA4 指标：真实数据从 page.ga4 取（同步时按 landing_page 口径写入）。
  // 合成目录节点无 GA4 概念 → 不展示该段；真实页若无 GA4 着陆流量 → 段内走诚实空态。
  const ga4: Ga4Metrics | null = page.isSynthetic ? null : page.ga4 ?? null;
  const showGa4Section = !page.isSynthetic; // 真实页恒展示该段（有数据→指标，无数据→空态）

  return (
    <div className="flex flex-col min-w-[400px]">
      {/* 面板顶部 */}
      <div className="px-5 py-4 border-b border-manor-brass/25 sticky top-0 bg-manor-bg3 z-10 flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-3">
          <div
            className="font-sc tracking-[0.28em] text-manor-brassHi/80 mb-1.5"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
          >
            ◆ INSPICIO · 页面详情
          </div>
          <h2
            className="text-brass-gradient font-serif font-semibold leading-tight break-all"
            style={{
              fontFamily: "var(--font-serif), 'EB Garamond', serif",
              fontSize: 16,
              letterSpacing: "0.02em",
            }}
            title={page.fullUrl}
          >
            {page.url}
          </h2>
          <p
            className="text-manor-brassDim text-[10px] mt-2 tabnum tracking-[0.18em]"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            卷号 № {page.id.replace("pg_", "")}
            <span className="mx-2 text-manor-inkGhost">·</span>
            <a
              href={page.fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-manor-brassHi transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              访问页面
              <ExternalLink size={10} />
            </a>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-manor-brassDim hover:text-manor-brassHi transition-colors mt-0.5 shrink-0"
          aria-label="关闭抽屉"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* 基本信息 */}
        <Section title="基本信息">
          <Field label="站点语言" value={langSiteLabel} />
          <Field label="页面类型" value={<PageTypeField key={page.fullUrl} fullUrl={page.fullUrl} pageType={page.pageType} />} />
          <Field label="主关键词" value={effectiveTopQuery} />
          <Field label="页面状态" value={<PageStatusChip pageStatus={page.pageStatus} weekTrend={page.weekTrend} />} />
          <Field
            label="收录状态"
            value={
              <span className="flex flex-col gap-1">
                <IndexStateChip state={page.indexState} />
                {page.coverageLabel ? (
                  <span className="flex flex-col gap-0.5">
                    <span className={`text-[11px] font-medium ${coverageLabelColor(page.coverageLabel)}`}>
                      {page.coverageLabel}
                    </span>
                    {page.coverageText && (
                      <span
                        className="text-[10px] text-manor-inkFaint leading-snug"
                        title={`Google 原话：${page.coverageText}`}
                      >
                        {page.coverageText}
                      </span>
                    )}
                  </span>
                ) : page.indexState !== "indexed" ? (
                  <span className="text-[10px] text-manor-inkFaint">待检查</span>
                ) : null}
                {page.indexState !== "indexed" && syncEnabled && (
                  <RequestIndexButton fullUrl={page.fullUrl} />
                )}
              </span>
            }
          />
          <div className="col-span-2">
            <Field
              label="URL"
              value={
                <a
                  href={page.fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-manor-ink hover:text-manor-brassHi underline decoration-manor-brass/30 underline-offset-2 text-xs break-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  {page.fullUrl}
                </a>
              }
            />
          </div>
        </Section>

        {/* 性能指标 */}
        <Section
          title="性能指标"
          grid={false}
          extra={
            <MiniSegmented value={timeWindow} onChange={onTimeWindowChange} />
          }
        >
          {(() => {
            // 整版数据有效性：indexed / discovered 才显示真实数字（0 也显示）；
            // excluded / error 整面 "—" 并提示状态。
            const hasData =
              page.indexState === "indexed" || page.indexState === "discovered";
            return (
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label="总点击次数"
              latin="CLICKS"
              value={hasData ? page.clicks.toLocaleString() : "—"}
            />
            <MetricTile
              label="总曝光次数"
              latin="VISUS"
              value={hasData ? formatLargeNumber(page.impressions) : "—"}
            />
            <MetricTile
              label="点击率"
              latin="PROPORTIO"
              value={hasData ? `${(page.ctr * 100).toFixed(1)}%` : "—"}
            />
            <MetricTile
              label="平均排名"
              latin="POSITIO"
              value={hasData && page.position > 0 ? page.position.toFixed(1) : "—"}
              subline={
                hasData && page.position > 0
                  ? page.position <= 3 ? "1-3 首位"
                    : page.position <= 10 ? "4-10 首页"
                    : page.position <= 20 ? "11-20 第二页"
                    : "21+ 深页"
                  : indexStateLabel(page.indexState)
              }
            />
          </div>
            );
          })()}
        </Section>

        {/* GA4 · 进站后表现 —— 经多视角评审后只保留对单页 SEO 决策真正可行动的信号：
            互动率(hero,带分档判断) + 活跃用户/互动时长(中性上下文) + 语言×来源国(hreflang诊断)。
            浏览/事件/新用户/会话/关键事件/购买/收入均已裁（冗余/恒零/归因错配，营收归 FRUCTUS）。 */}
        {showGa4Section && (
          <Section title="进站后表现" grid={false} extra={<Ga4WindowBadge />}>
            {!ga4 ? (
              // 真实页但近 28 天无 GA4 着陆流量 —— 诚实空态，不再编造示例值
              <Ga4NoDataCallout />
            ) : (
            <div className="flex flex-col gap-3">
              {/* 互动率 —— 唯一带"好/坏"判断的 hero 指标（门槛为低位绝对阈值，跨页类型可比） */}
              {(() => {
                const tier = engagementTier(ga4.engagementRate);
                return (
                  <div
                    className="px-3 py-2.5 relative overflow-hidden"
                    style={{
                      borderRadius: 4,
                      background:
                        "linear-gradient(180deg, rgba(20,42,28,.92) 0%, rgba(10,24,16,.96) 100%)",
                      border: `1px solid ${tier.color}55`,
                      boxShadow:
                        "inset 0 1px 0 rgba(224,197,122,.12), inset 0 -1px 0 rgba(0,0,0,.5)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          style={{
                            width: 3, height: 3, transform: "rotate(45deg)",
                            background: "linear-gradient(135deg, #EFD89A 0%, #A08850 100%)",
                          }}
                        />
                        <span
                          className="text-manor-brassHi/85 tracking-[0.22em]"
                          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                        >
                          IMPLICATIO · 互动率
                        </span>
                      </div>
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px]"
                        style={{ background: `${tier.color}1a`, color: tier.color, border: `1px solid ${tier.color}55` }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: 9999, background: tier.color, boxShadow: `0 0 5px ${tier.color}` }} />
                        {tier.label}
                      </span>
                    </div>
                    <p
                      className="font-semibold tabnum leading-none mt-1.5"
                      style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 24, color: tier.color }}
                    >
                      {(ga4.engagementRate * 100).toFixed(1)}%
                    </p>
                    <p className="text-manor-ink/70 mt-1.5 text-[10.5px] leading-snug">
                      落地是否接住点击（互动会话÷总会话 ≈ 1−跳出率）。偏低 = 落地即走，多为意图错配或落地体验差。
                    </p>
                  </div>
                );
              })()}

              {/* 活跃用户 + 互动时长 —— 中性上下文，不做好坏判断 */}
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="活跃用户"
                  latin="ACTIVI"
                  value={ga4.activeUsers.toLocaleString()}
                  subline="全渠道去重 · 非纯自然搜索"
                />
                <MetricTile
                  label="平均互动时长"
                  latin="TEMPUS"
                  value={formatEngagementTime(ga4.avgEngagementTime)}
                  subline="每次会话 · 对照同类型页基准（待上线）"
                />
              </div>

              {/* 站点语言 × 来源国 一致性（hreflang 诊断） */}
              <LangGeoConsistency market={page.market} topCountries={ga4.topCountries} />
            </div>
            )}
          </Section>
        )}

        {/* 流量趋势 — 每日+累计（曝光/点击分图）。替换旧 12 月趋势占位。
            合成目录节点不拉数据，不显示此段。 */}
        {!page.isSynthetic && (
          <Section title="流量趋势" grid={false}>
            <PageTrendSection
              data={trend.data}
              loading={trend.loading}
              error={trend.error}
            />
          </Section>
        )}

        {/* 页面关键词排名 */}
        <Section
          title="页面关键词排名"
          grid={false}
          extra={noDataTag ? <NoDataChip tag={noDataTag} /> : undefined}
        >
          {noDataTag ? (
            <NoKeywordCallout tag={noDataTag} />
          ) : (
            <QueryRankTable rows={page.queries} />
          )}
        </Section>

        {/* 关联词库 */}
        <Section title="关联词库" grid={false}>
          {page.poolMatches > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-manor-ink text-xs">
                <span className="text-brass-gradient font-semibold tabular-nums text-sm">
                  {page.poolMatches}
                </span>
                <span className="text-manor-inkDim ml-1.5">条 query 命中 keywords_pool</span>
              </span>
              <span className="text-[10px] text-manor-inkFaint">点击查询以联动词库视图（即将上线）</span>
            </div>
          ) : (
            <span className="text-manor-inkGhost text-xs">该页面尚未与词库关联</span>
          )}
        </Section>
      </div>
    </div>
  );
}
