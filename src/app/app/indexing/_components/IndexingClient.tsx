"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SummaryBar } from "./SummaryBar";
import {
  FilterBar,
  DEFAULT_INDEXING_FILTERS,
  type IndexingFilterState,
  type TimeWindow,
} from "./FilterBar";
import { PageTable } from "./PageTable";
import { PageTreeView, type Scope, scopeMatches } from "./PageTreeView";
import { DetailDrawer } from "./DetailDrawer";
import { List, Network, RefreshCw, X } from "lucide-react";
import {
  type PageRow,
  type IndexingStats,
  type PageDetail,
  getMockPageDetail,
} from "./_mock";
import { LANG_SITE_LABELS, positionBucket, comparePageType, resolvePageStatus } from "./_utils";
import type { LastSyncMeta, SyncModeStatus } from "./IndexingWrapper";
import { classifyCadence, CADENCE_META, type Cadence, type HealthState } from "@/lib/gsc/classify";

type SyncMode = "full" | "weekly" | "daily";

interface IndexingClientProps {
  initialData: PageRow[];
  stats: IndexingStats;
  lastSyncMeta?: LastSyncMeta;
  syncStatus?: SyncModeStatus;
  syncEnabled?: boolean;
}

type SyncResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  hint?: string;
  durationMs?: number;
  property?: string;
  fetchedAt?: string;
  freshnessText?: string;
  mode?: SyncMode;
  requestedMode?: SyncMode;
  pagesQueried?: number;
  queryFetched?: number;
  queryFailures?: number;
  stats?: {
    totalPages: number;
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
    top10Pages: number;
  };
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (Number.isNaN(diff)) return iso;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  return `${day} 天前`;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

type ViewMode = "tree" | "list";

// ─── 列表视图顶部面包屑 — 显示 scope 的祖先链 + 一键回到任意上层 ───
function ScopeBreadcrumb({
  scope,
  onChange,
  byId,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
  byId: Map<string, PageRow>;
}) {
  const serif = "var(--font-serif), 'EB Garamond', serif";
  const sep = (
    <span className="text-manor-inkGhost mx-1" aria-hidden="true">›</span>
  );

  // 从 scope.pageId 向上沿 parentId 链回溯，组装出 [root, ..., scope] 顺序
  const chain: PageRow[] = (() => {
    if (scope.kind === "all") return [];
    const out: PageRow[] = [];
    let cur = byId.get(scope.pageId);
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  })();

  return (
    <div
      className="px-4 py-2 flex items-center gap-1.5 border-b border-manor-brass/15 bg-manor-bg2 shrink-0 overflow-x-auto"
      style={{ fontFamily: serif, fontSize: 11.5 }}
    >
      <Network size={12} className="text-manor-brassDim shrink-0" />
      <button
        type="button"
        onClick={() => onChange({ kind: "all" })}
        className={[
          "shrink-0 transition-colors",
          scope.kind === "all"
            ? "text-manor-brassHi font-semibold cursor-default"
            : "text-manor-inkDim hover:text-manor-brassHi",
        ].join(" ")}
      >
        全部页面
      </button>
      {chain.map((page, i) => {
        const isLast = i === chain.length - 1;
        return (
          <span key={page.id} className="inline-flex items-center shrink-0">
            {sep}
            {isLast ? (
              <span className="text-manor-brassHi font-semibold inline-flex items-center gap-1">
                {page.isPillar && (
                  <span
                    aria-hidden="true"
                    title="枢纽页 PILLAR"
                    style={{
                      width: 6,
                      height: 6,
                      transform: "rotate(45deg)",
                      background: "linear-gradient(135deg, #F8E6B0 0%, #A08850 100%)",
                      boxShadow: "0 0 6px rgba(239,216,154,.65)",
                    }}
                  />
                )}
                {page.url || "/"}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onChange({ kind: "subtree", pageId: page.id })}
                className="text-manor-inkDim hover:text-manor-brassHi transition-colors"
              >
                {page.url || "/"}
              </button>
            )}
          </span>
        );
      })}
      <span className="flex-1" />
      {scope.kind !== "all" && (
        <button
          type="button"
          onClick={() => onChange({ kind: "all" })}
          title="清除范围筛选"
          className="shrink-0 inline-flex items-center gap-1 text-[10.5px] text-manor-inkFaint hover:text-manor-brassHi transition-colors px-1.5 py-0.5 rounded border border-manor-brass/20 hover:border-manor-brass/50"
        >
          <X size={10} />
          清除
        </button>
      )}
    </div>
  );
}

export function IndexingClient({
  initialData,
  stats,
  lastSyncMeta,
  syncStatus,
  syncEnabled = true,
}: IndexingClientProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>("daily");
  const SYNC_MODE_LABEL: Record<SyncMode, string> = { full: "全量", weekly: "周更", daily: "日更" };
  const handleSync = async (mode: SyncMode) => {
    if (syncing) return;
    setSyncMenuOpen(false);
    setSyncing(true);
    const toastId = toast.loading(`正在${SYNC_MODE_LABEL[mode]}同步 GSC 数据…`, {
      description:
        mode === "full"
          ? "全量抓取页面指标 + 逐页关键词（约 250+ 页，需数分钟，请勿关闭浏览器）"
          : "抓取该档页面的关键词排名，请勿关闭浏览器",
    });
    try {
      const res = await fetch("/api/indexing/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = (await res.json()) as SyncResponse;
      if (!res.ok || !body.ok) {
        toast.error(body.message || "同步失败", {
          id: toastId,
          description: body.hint || body.code,
          duration: 8000,
        });
        return;
      }
      const s = body.stats;
      const kwPart =
        typeof body.queryFetched === "number"
          ? ` · 关键词 ${body.queryFetched} 页${body.queryFailures ? `（${body.queryFailures} 页失败）` : ""}`
          : "";
      const modeLabel = body.mode ? SYNC_MODE_LABEL[body.mode] ?? body.mode : "";
      toast.success(`${modeLabel}同步完成`, {
        id: toastId,
        description: s
          ? `共 ${s.totalPages} 页 · 本次爬 ${body.pagesQueried ?? "?"} 页${kwPart} · 用时 ${Math.round((body.durationMs ?? 0) / 1000)}s`
          : `用时 ${Math.round((body.durationMs ?? 0) / 1000)}s`,
        duration: 6000,
      });
      router.refresh();
    } catch (err) {
      toast.error("同步请求失败", {
        id: toastId,
        description: err instanceof Error ? err.message : "网络错误",
        duration: 8000,
      });
    } finally {
      setSyncing(false);
    }
  };

  // 是否为真实 GSC 数据（mock 模式不去 GSC 抓 query，沿用 mock 样本）
  const isRealData = lastSyncMeta?.source === "gsc";

  // 同步页数 / 耗时预估 —— 口径严格对齐 sync/route：
  //   · 只统计"有曝光的真实页"（impressions>0）；合成节点 + 零曝光页都不导航、不计入。
  //   · 分档同 classifyCadence（关键词数 + 页面类型）；full 档 = 三档之和（全爬有曝光页）。
  //   · 耗时不能按页数线性外推：无关键词页要等满 table-wait（~20s/页），有关键词页较快
  //     （~5s/页），并发 4。分别累加再除并发，避免"全量大量无数据页"被严重低估。
  const SYNC_CONCURRENCY = 4;
  const SEC_NO_DATA = 20;
  const SEC_HAS_DATA = 5;
  const syncEst = useMemo(() => {
    const z = () => ({ pages: 0, seconds: 0 });
    const byCadence: Record<Cadence, { pages: number; seconds: number }> = {
      daily: z(),
      weekly: z(),
      monthly: z(),
    };
    const full = z();
    for (const p of initialData) {
      if (p.isSynthetic || p.impressions <= 0) continue;
      const kc = p.queries?.length ?? 0;
      const sec = kc > 0 ? SEC_HAS_DATA : SEC_NO_DATA;
      const cad = classifyCadence({ pageType: p.pageType, keywordCount: kc, url: p.fullUrl });
      byCadence[cad].pages += 1;
      byCadence[cad].seconds += sec;
      full.pages += 1;
      full.seconds += sec;
    }
    const toMin = (s: number) => Math.max(1, Math.ceil(s / SYNC_CONCURRENCY / 60));
    return {
      daily: { pages: byCadence.daily.pages, minutes: toMin(byCadence.daily.seconds) },
      weekly: { pages: byCadence.weekly.pages, minutes: toMin(byCadence.weekly.seconds) },
      full: { pages: full.pages, minutes: toMin(full.seconds) },
    } as Record<SyncMode, { pages: number; minutes: number }>;
  }, [initialData]);

  // 弹窗里三档的展示元信息（顺序：日更 → 周更 → 全量）。
  const SYNC_OPTIONS: { mode: SyncMode; title: string; latin: string; hint: string }[] = [
    { mode: "daily", title: "日更", latin: CADENCE_META.daily.latin, hint: CADENCE_META.daily.hint },
    { mode: "weekly", title: "周更", latin: CADENCE_META.weekly.latin, hint: CADENCE_META.weekly.hint },
    {
      mode: "full",
      title: "全量",
      latin: "OMNIA",
      hint: "重抓全部有曝光页并刷新关键词基准；日更/周更的分档以最近一次全量为准，建议每月一次。",
    },
  ];
  const lastSyncOf = (mode: SyncMode): string | undefined =>
    (syncStatus?.[mode] ?? undefined) || undefined;

  const [filters, setFilters] = useState<IndexingFilterState>({ ...DEFAULT_INDEXING_FILTERS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Deep-link：?focus=<pageId>（从选题工作台「收录索引命中」跳转而来）→ 选中并打开对应页抽屉。
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus && initialData.some((p) => p.id === focus)) {
      setSelectedId(focus);
      setDrawerOpen(true);
    }
    // 仅 mount 执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  // 抽屉里的时间窗与 FilterBar 的时间窗解耦：FilterBar 控的是整张表格的全局
  // 口径，抽屉里控的是单个 URL 的性能切片，两者语义不同、用户预期独立。
  const [drawerTimeWindow, setDrawerTimeWindow] = useState<TimeWindow>("90d");
  // 视图切换：树视图（默认，逐层点开导航）/ 列表视图（按 scope 显示内容）
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  // scope = 树视图中"当前选中的范围"；列表视图只显示该范围内的页面
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  // 树视图全景弹层开关 —— 弹层打开时不应自动切到列表视图（防止 modal 一点就关）
  const [treeExpanded, setTreeExpanded] = useState(false);
  // 列表→树过渡微提示：在 list→tree 切换的瞬间标记"刚才看的是哪个 page"
  // 优先用最近 detail 抽屉的 selectedId（更精确），fallback 到 scope.pageId
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null);
  const prevViewMode = useRef<ViewMode>("tree");
  useEffect(() => {
    if (prevViewMode.current === "list" && viewMode === "tree") {
      const target = selectedId ?? (scope.kind === "subtree" ? scope.pageId : null);
      if (target) setFlashNodeId(target);
    }
    prevViewMode.current = viewMode;
  }, [viewMode, selectedId, scope]);

  // 数据 fingerprint 变化 → reset 客户端状态
  // 触发场景：用户点"更新"后 router.refresh()，RSC 重读 snapshot 文件，传进来
  // 全新的 initialData。React 不卸载这个组件，所以 useState 里的 selectedId /
  // filter / scope 会残留 —— stale 的 ID 在新数据里查不到，导致抽屉空、filter
  // 异常预选等问题。用 lastSync 做 fingerprint，变化时清零所有客户端状态。
  const prevFingerprint = useRef(stats.lastSync);
  useEffect(() => {
    if (prevFingerprint.current !== stats.lastSync) {
      setSelectedId(null);
      setDrawerOpen(false);
      setFilters({ ...DEFAULT_INDEXING_FILTERS });
      setScope({ kind: "all" });
      setCurrentPage(1);
      setFlashNodeId(null);
      setTreeExpanded(false);
      prevFingerprint.current = stats.lastSync;
    }
  }, [stats.lastSync]);

  // 当前选中的真实页行（synthetic / 找不到 → null）
  const selectedRow = useMemo(
    () => (selectedId ? initialData.find((p) => p.id === selectedId) ?? null : null),
    [selectedId, initialData]
  );

  // 派生选项（市场 / 页面类型）
  const { marketOptions, pageTypeOptions } = useMemo(() => {
    const markets = new Set<string>();
    const types = new Set<string>();
    initialData.forEach((p) => {
      if (p.market) markets.add(p.market);
      if (p.pageType) types.add(p.pageType);
    });
    return {
      marketOptions: [...markets].sort().map((m) => ({
        value: m,
        label: LANG_SITE_LABELS[m.toLowerCase()] ?? m.toUpperCase(),
      })),
      // 按真实用户进入网站的路径排序（首页→品类→产品→落地→内容→辅助），见 _utils.PAGE_TYPE_ORDER
      pageTypeOptions: [...types].sort(comparePageType).map((t) => ({ value: t, label: t })),
    };
  }, [initialData]);

  // 经 FilterBar 过滤的全集 —— 喂给树视图（用户需要看到完整层级以便导航）
  const filtered = useMemo(() => {
    return initialData.filter((p) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hitUrl = p.url.toLowerCase().includes(q) || p.fullUrl.toLowerCase().includes(q);
        const hitQuery = p.topQuery.toLowerCase().includes(q);
        if (!hitUrl && !hitQuery) return false;
      }
      if (filters.market.length > 0 && !filters.market.includes(p.market)) return false;
      if (filters.pageType.length > 0 && !filters.pageType.includes(p.pageType)) return false;
      // 健康筛选：合成目录节点豁免（保树视图骨架不断层），真实页按健康态过滤
      if (filters.health.length > 0 && !p.isSynthetic) {
        const kind = resolvePageStatus(p).kind;
        if (!filters.health.includes(kind as HealthState)) return false;
      }
      if (filters.position.length > 0) {
        const b = positionBucket(p.position);
        if (b === "none" || !filters.position.includes(b)) return false;
      }
      return true;
    });
  }, [initialData, filters]);

  // 全量 byId（用于 scope 沿 parentId 上溯；不能用 filtered，否则被过滤掉的祖先会断链）
  const allById = useMemo(
    () => new Map(initialData.map((p) => [p.id, p])),
    [initialData]
  );

  // 再叠加 scope 过滤 —— 喂给树视图（含合成目录节点，做聚合 + 父子结构）
  const scoped = useMemo(
    () => filtered.filter((p) => scopeMatches(scope, p, allById)),
    [filtered, scope, allById]
  );

  // 列表视图与分页用 —— 不显示合成的虚拟目录节点（它们不是被 GSC 索引的真实页）
  const scopedReal = useMemo(
    () => scoped.filter((p) => !p.isSynthetic),
    [scoped]
  );

  // 顶部 SummaryBar 跟随当前"发亮卡片"(scope) 实时变动：
  //   · scope=all   → 用权威全站汇总（snapshot.summary 口径，与原行为一致）
  //   · scope=子树  → 按该子树的真实页 (scopedReal) 实时重算，口径与列表视图完全一致，
  //                   也与树视图发亮卡片的 CLK/IMP/CTR(=点击/曝光) 对应。
  const scopedStats: IndexingStats = useMemo(() => {
    if (scope.kind === "all") return stats;
    const rows = scopedReal;
    const n = rows.length;
    const totalClicks = rows.reduce((s, p) => s + p.clicks, 0);
    const totalImpressions = rows.reduce((s, p) => s + p.impressions, 0);
    return {
      totalPages: n,
      totalClicks,
      totalImpressions,
      // CTR 用加权口径（总点击/总曝光），与发亮卡片 CTR、GSC 全站 CTR 同义
      avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      // 平均排名沿用 transform 的简单均值口径
      avgPosition: n
        ? parseFloat((rows.reduce((s, p) => s + p.position, 0) / n).toFixed(1))
        : 0,
      top10Pages: rows.filter((p) => p.position > 0 && p.position <= 10).length,
      lastSync: stats.lastSync,
    };
  }, [scope, scopedReal, stats]);

  useEffect(() => {
    setCurrentPage(1);
  }, [scopedReal]);

  const totalCount = scopedReal.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(
    () => scopedReal.slice((safePage - 1) * pageSize, safePage * pageSize),
    [scopedReal, safePage, pageSize]
  );
  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, totalCount);

  const handleRowClick = (page: PageRow) => {
    setSelectedId(page.id);
    setDrawerOpen(true);
  };

  const handleClose = () => {
    setDrawerOpen(false);
  };

  // 抽屉数据：
  //   · 真实 GSC 数据 → queries 已随每次同步批量抓好、随页行一起带进来（selectedRow.queries），
  //     抽屉直接读，不再逐次点击发请求。
  //   · mock 模式 → 用 mock 样本（getMockPageDetail 自带 query 明细）。
  const selectedDetail: PageDetail | null = useMemo(() => {
    if (!selectedId) return null;
    if (selectedRow) {
      if (isRealData) {
        return { ...selectedRow, queries: selectedRow.queries ?? [], poolMatches: 0 };
      }
      return getMockPageDetail(selectedId) ?? { ...selectedRow, queries: [], poolMatches: 0 };
    }
    return getMockPageDetail(selectedId);
  }, [selectedId, selectedRow, isRealData]);

  const btnCls = (disabled: boolean) =>
    [
      "h-6 w-6 flex items-center justify-center rounded border text-xs transition-all",
      disabled
        ? "border-manor-brass/15 text-manor-inkGhost cursor-not-allowed"
        : "border-manor-brass/40 text-manor-brassDim hover:border-manor-brassHi hover:text-manor-brassHi hover:shadow-[0_0_8px_-2px_rgba(224,197,122,.65)]",
    ].join(" ");

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 左侧主区 */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        {/* 标题栏 */}
        {/* R106 抽屉打开后顶栏被压窄 → 中文按钮 / 标签竖排成"更\n新"。
            统一加 whitespace-nowrap 防字符堆叠；右侧工具区 shrink-0 不被挤压；
            标题区里只有"GSC · 性能数据 · weslamic.com"这条 italic 副标题允许在最窄时截断隐藏。 */}
        <div className="px-5 py-3 border-b border-manor-brass/25 bg-manor-bg2 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-baseline gap-3 min-w-0">
            <span
              className="font-sc tracking-[0.32em] text-manor-brassHi/80 whitespace-nowrap shrink-0"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 10 }}
            >
              ◆ OFFICINA
            </span>
            <h1
              className="text-brass-gradient font-serif font-semibold leading-none whitespace-nowrap shrink-0"
              style={{
                fontFamily: "var(--font-serif), 'EB Garamond', serif",
                fontSize: 22,
                letterSpacing: "0.04em",
                filter:
                  "drop-shadow(0 0 5px rgba(239,216,154,.22)) drop-shadow(0 1px 0 rgba(0,0,0,.55))",
              }}
            >
              收录与索引
            </h1>
            <span
              className="font-sc tracking-[0.24em] text-manor-brassHi whitespace-nowrap shrink-0 hidden 2xl:inline"
              style={{
                fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                fontSize: 10,
                textShadow:
                  "0 0 8px rgba(239,216,154,.5), 0 0 2px rgba(224,197,122,.7)",
              }}
            >
              〔INDEX · ACCEPTATIO〕
            </span>
            <span
              className="text-manor-ink/65 italic truncate min-w-0 hidden 2xl:inline"
              style={{
                fontFamily: "var(--font-serif), 'EB Garamond', serif",
                fontSize: 11,
                textShadow: "0 0 4px rgba(239,216,154,.18)",
              }}
            >
              GSC · 性能数据 · weslamic.com
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* 数据源 + 上次同步 + 同步按钮 */}
            <div
              className="flex items-center gap-2 text-[10.5px] text-manor-inkDim whitespace-nowrap"
              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
            >
              {lastSyncMeta?.source === "mock" ? (
                <span
                  className="px-1.5 py-0.5 rounded border border-manor-brass/25 text-manor-inkFaint"
                  title={`当前展示 mock 数据，点击右侧"更新"按钮可拉取真实 GSC 数据`}
                >
                  MOCK
                </span>
              ) : (
                <>
                  <span className="text-manor-brassDim">上次同步</span>
                  <span className="text-manor-brassHi tabnum">
                    {formatRelative(lastSyncMeta?.fetchedAt)}
                  </span>
                  {lastSyncMeta?.freshnessText && (
                    <>
                      <span className="text-manor-inkFaint">·</span>
                      <span
                        className="text-manor-inkDim"
                        title="GSC 自身的数据延迟，不是我们 sync 的时间"
                      >
                        GSC {lastSyncMeta.freshnessText}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSyncMenuOpen((o) => !o)}
                disabled={syncing}
                title={syncing ? "正在抓取…" : "选择更新范围，从本地浏览器的 GSC 抓取"}
                className={[
                  "h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-[11px] whitespace-nowrap",
                  "border transition-all",
                  syncing
                    ? "border-manor-brass/25 text-manor-inkDim cursor-wait"
                    : "border-manor-brass/45 text-manor-brassHi hover:border-manor-brassHi hover:shadow-[0_0_10px_-2px_rgba(239,216,154,.65)] hover:bg-manor-brassDim/10",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.12em" }}
              >
                <RefreshCw
                  size={12}
                  className={syncing ? "animate-spin" : ""}
                  aria-hidden="true"
                />
                <span>{syncing ? "同步中" : "更新"}</span>
                {!syncing && (
                  <span className="text-manor-brassDim text-[9px] -mr-0.5" aria-hidden="true">▾</span>
                )}
              </button>

              {syncMenuOpen && !syncing && (
                <>
                  {/* 点击遮罩关闭 */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setSyncMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute right-0 mt-2 w-[290px] z-50 rounded-lg border border-manor-brass/30 shadow-[0_12px_40px_-8px_rgba(0,0,0,.7)] overflow-hidden"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(20,42,28,.98) 0%, rgba(8,20,13,.99) 100%)",
                    }}
                    role="dialog"
                    aria-label="选择更新范围"
                  >
                    <div
                      className="px-3.5 py-2.5 border-b border-manor-brass/15 text-[11px] text-manor-brassHi"
                      style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.1em" }}
                    >
                      选择更新范围 · SYNC SCOPE
                    </div>

                    {!syncEnabled ? (
                      // 部署/非本地环境：无本地 Chrome，禁用抓取并提示联系管理员
                      <div className="px-3.5 py-4 text-[11.5px] text-manor-inkDim leading-relaxed"
                        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                      >
                        <p className="text-manor-brassDim mb-1.5">当前为部署环境</p>
                        <p>
                          GSC 抓取依赖本地浏览器（调试端口 9222），线上无法运行。
                          如需刷新数据，<span className="text-manor-brassHi">请联系管理员</span>在本地执行同步。
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="py-1.5">
                          {SYNC_OPTIONS.map((opt) => {
                            const active = syncMode === opt.mode;
                            const { pages, minutes } = syncEst[opt.mode];
                            const last = lastSyncOf(opt.mode);
                            return (
                              <button
                                key={opt.mode}
                                type="button"
                                onClick={() => setSyncMode(opt.mode)}
                                className={[
                                  "w-full text-left px-3.5 py-2 flex items-start gap-2.5 transition-colors",
                                  active ? "bg-manor-brassDim/12" : "hover:bg-manor-brassDim/6",
                                ].join(" ")}
                              >
                                {/* 单选点 */}
                                <span
                                  className={[
                                    "mt-0.5 w-3 h-3 rounded-full border shrink-0 flex items-center justify-center",
                                    active ? "border-manor-brassHi" : "border-manor-brass/40",
                                  ].join(" ")}
                                  aria-hidden="true"
                                >
                                  {active && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-manor-brassHi" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-baseline justify-between gap-2">
                                    <span
                                      className={active ? "text-manor-brassHi text-[12.5px]" : "text-manor-ink text-[12.5px]"}
                                      style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.08em" }}
                                    >
                                      {opt.title}
                                      <span className="text-manor-inkGhost text-[9px] ml-1.5 tracking-[0.18em]">
                                        {opt.latin}
                                      </span>
                                    </span>
                                    <span className="text-manor-brassDim text-[10.5px] tabnum shrink-0">
                                      约 {pages} 页 · ≈{minutes} 分
                                    </span>
                                  </span>
                                  <span
                                    className="block text-[10.5px] text-manor-inkDim mt-0.5 leading-snug"
                                    style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                                  >
                                    {opt.hint}
                                  </span>
                                  <span className="block text-[10px] text-manor-inkFaint mt-1">
                                    上次{opt.title}：
                                    <span className="text-manor-brassDim tabnum">
                                      {last ? formatRelative(last) : "未运行过"}
                                    </span>
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="px-3.5 py-2.5 border-t border-manor-brass/15 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSyncMenuOpen(false)}
                            className="h-7 px-3 rounded text-[11px] border border-manor-brass/25 text-manor-inkDim hover:text-manor-ink hover:border-manor-brass/45 transition-colors"
                            style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSync(syncMode)}
                            className="h-7 px-3.5 rounded text-[11px] border border-manor-brassHi/60 text-manor-brassHi bg-manor-brassDim/15 hover:bg-manor-brassDim/25 hover:shadow-[0_0_10px_-2px_rgba(239,216,154,.65)] transition-all"
                            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.1em" }}
                          >
                            确定更新
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <Input
              className="w-32 lg:w-44 xl:w-56 h-7 bg-manor-void/60 border-manor-brass/30 text-manor-ink placeholder:text-manor-inkFaint text-xs focus-visible:ring-manor-brass focus-visible:border-manor-brass min-w-0"
              placeholder="搜索 URL / 关键词..."
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
          </div>
        </div>

        {/* 统计指标 */}
        <div className="px-5 py-3 border-b border-manor-brass/15 bg-manor-bg2 shrink-0">
          <SummaryBar
            stats={scopedStats}
            onCardClick={(key) => {
              // 联动筛选：top10 → position 1-10；其它卡先不联动
              if (key === "top10Pages") {
                setFilters({ ...filters, position: ["top3", "top10"] });
              } else if (key === "totalPages") {
                setFilters({ ...DEFAULT_INDEXING_FILTERS });
              }
            }}
          />
        </div>

        {/* 筛选行：视图切换 + FilterBar */}
        <div className="px-4 py-2 border-b border-manor-brass/15 bg-manor-bg2 shrink-0 flex items-center gap-3 min-w-0">
          {/* 视图切换 — 树（默认，导航）/ 列表（按 scope 显示） */}
          <div
            className="h-8 shrink-0 inline-flex items-center border border-manor-brass/30 rounded-md overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(224,197,122,.18), inset 0 -1px 0 rgba(0,0,0,.45)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              title="树视图：逐层点开导航，选中后切换列表查看"
              className={[
                "h-full px-2.5 inline-flex items-center gap-1.5 text-[11px] transition-colors border-r border-manor-brass/15",
                viewMode === "tree"
                  ? "text-manor-brassHi bg-manor-brassDim/15"
                  : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
              ].join(" ")}
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              <Network size={12} />
              <span className="tracking-wide">结构</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              title="列表视图：仅显示当前 scope 范围内的页面"
              className={[
                "h-full px-2.5 inline-flex items-center gap-1.5 text-[11px] transition-colors",
                viewMode === "list"
                  ? "text-manor-brassHi bg-manor-brassDim/15"
                  : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
              ].join(" ")}
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              <List size={12} />
              <span className="tracking-wide">列表</span>
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <FilterBar
              filters={filters}
              onFilterChange={setFilters}
              marketOptions={marketOptions}
              pageTypeOptions={pageTypeOptions}
            />
          </div>
        </div>

        {/* 主体：树（导航） / 列表（按 scope 显示） */}
        <div className="flex-1 overflow-auto bg-manor-bg2 flex flex-col min-h-0">
          {viewMode === "list" && (
            <ScopeBreadcrumb scope={scope} onChange={setScope} byId={allById} />
          )}
          <div className="flex-1 min-h-0">
            {viewMode === "list" ? (
              <PageTable data={paginated} onRowClick={handleRowClick} />
            ) : (
              <PageTreeView
                data={filtered}
                scope={scope}
                onScopeChange={(s) => {
                  // 仅同步 scope（高亮/面包屑），不再自动切列表。
                  // 防误触：单击节点 = 探索（下钻 / 旋转聚焦），切到列表只能由显式 CTA 触发。
                  setScope(s);
                }}
                onPageOpen={handleRowClick}
                onRequestListView={(pageId) => {
                  // 显式 CTA — 用户主动点"查看网址列表 →"才会落到列表视图。
                  setScope({ kind: "subtree", pageId });
                  setViewMode("list");
                  setTreeExpanded(false);
                }}
                expanded={treeExpanded}
                onExpandedChange={setTreeExpanded}
                flashNodeId={flashNodeId}
                onFlashConsumed={() => setFlashNodeId(null)}
              />
            )}
          </div>
        </div>

        {/* 分页 — 仅列表视图显示（分组视图自带折叠节奏，不分页） */}
        {viewMode === "list" && (
        <div className="px-4 py-2 border-t border-manor-brass/25 bg-manor-bg2 shrink-0 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 shrink-0">
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
              className="font-sc tracking-[0.26em] text-manor-brassHi/80 leading-none"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
            >
              PAGINATIO
            </span>
            <span
              className="h-px w-5"
              style={{
                background:
                  "linear-gradient(90deg, rgba(212,179,111,.4), transparent)",
              }}
            />
          </span>

          <span className="text-manor-inkDim tabnum">
            {(() => {
              const realTotal = initialData.filter((p) => !p.isSynthetic).length;
              return totalCount !== realTotal
                ? `已筛选 ${totalCount} / ${realTotal} 条`
                : `共 ${totalCount} 条`;
            })()}
          </span>

          <span className="flex-1" />

          <div className="flex items-center gap-1.5 text-manor-inkDim">
            <span>每页</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="h-6 border border-manor-brass/40 rounded px-1.5 text-xs text-manor-brassHi bg-manor-bg2 focus:outline-none focus:border-manor-brassHi cursor-pointer hover:border-manor-brassHi transition-colors"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>条</span>
          </div>

          <span className="text-manor-brassDim tabnum">
            {rangeStart}–{rangeEnd} / {totalCount}
          </span>

          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage(1)} disabled={safePage === 1} className={btnCls(safePage === 1)} title="第一页">«</button>
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className={btnCls(safePage === 1)} title="上一页">‹</button>
            <span className="inline-flex items-center gap-1.5 px-2.5 select-none">
              <span
                aria-hidden="true"
                className="brass-dot"
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 9999,
                  background:
                    "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
                  boxShadow: "0 0 6px rgba(239,216,154,.7)",
                }}
              />
              <span className="text-manor-brassHi tabnum num-breath">{safePage}</span>
              <span className="text-manor-inkFaint">/</span>
              <span className="text-manor-inkDim tabnum">{totalPages}</span>
            </span>
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className={btnCls(safePage >= totalPages)} title="下一页">›</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={safePage >= totalPages} className={btnCls(safePage >= totalPages)} title="最后一页">»</button>
          </div>
        </div>
        )}
      </div>

      {/* 右侧详情抽屉 */}
      <div
        style={{ scrollbarGutter: "stable" }}
        className={[
          "flex-shrink-0 border-l border-manor-line bg-manor-bg overflow-y-auto",
          "transition-[width] duration-300 ease-in-out",
          drawerOpen ? "w-[420px]" : "w-0 overflow-hidden",
        ].join(" ")}
      >
        {selectedDetail && (
          <DetailDrawer
            page={selectedDetail}
            timeWindow={drawerTimeWindow}
            onTimeWindowChange={setDrawerTimeWindow}
            onClose={handleClose}
          />
        )}
      </div>
    </div>
  );
}
