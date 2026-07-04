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
import { PageTrendSection, type TrendData } from "./PageTrendChart";
import { Clock, Globe, List, Maximize2, Minimize2, Network, RefreshCw, Send, Wrench, X } from "lucide-react";
import { SchedulerSettingsDialog } from "./SchedulerSettingsDialog";
import {
  type PageRow,
  type IndexingStats,
  type PageDetail,
  getMockPageDetail,
} from "./_mock";
import { LANG_SITE_LABELS, positionBucket, comparePageType, PAGE_TYPE_ORDER } from "./_utils";
import type { LastSyncMeta, SyncModeStatus } from "./IndexingWrapper";
import { type PageStatus } from "@/lib/gsc/classify";

interface IndexingClientProps {
  initialData: PageRow[];
  stats: IndexingStats;
  lastSyncMeta?: LastSyncMeta;
  syncStatus?: SyncModeStatus;
  syncEnabled?: boolean;
  trafficApiConfigured?: boolean;
  windowDays?: number;
}

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

/** 服务端 windowDays (7/28/90) → 客户端 TimeWindow ("7d"/"28d"/"90d") */
function daysToTimeWindow(d: number): TimeWindow {
  if (d === 7) return "7d";
  if (d === 28) return "28d";
  return "90d";
}

export function IndexingClient({
  initialData,
  stats,
  lastSyncMeta,
  syncStatus: _syncStatus,
  syncEnabled = true,
  trafficApiConfigured = false,
  windowDays = 90,
}: IndexingClientProps) {
  const router = useRouter();

  // ── 时间窗切换（URL searchParam 驱动，服务端重算）──
  const activeWindow: TimeWindow = daysToTimeWindow(windowDays);
  const handleWindowNavigate = (tw: TimeWindow) => {
    if (tw === activeWindow) return; // 已选中，不重复导航
    const days = tw === "7d" ? 7 : tw === "28d" ? 28 : 90;
    const params = new URLSearchParams(window.location.search);
    params.set("window", String(days));
    router.push(`/app/indexing?${params.toString()}`);
  };

  const [syncing, setSyncing] = useState(false);
  const [inspectingMode, setInspectingMode] = useState<"on-demand" | "all" | null>(null);
  const inspecting = inspectingMode !== null;
  const [rescanning, setRescanning] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  // ── 批量请求索引：对当前范围内的未收录页逐个代驾 GSC「请求编入索引」──
  const [batchRequesting, setBatchRequesting] = useState(false);
  const [batchArmed, setBatchArmed] = useState(false); // 两步确认：首点武装、再点执行
  const batchArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (batchArmTimer.current) clearTimeout(batchArmTimer.current);
    },
    []
  );

  // ── 刷新收录状态：调 /api/indexing/inspect-coverage，按需分级查收录 ──
  // on-demand（默认）：按需分级——没查过的立即查、未收录24h复查、已收录7天兜底复查。
  const handleInspectCoverage = async () => {
    if (inspecting || batchRequesting) return; // 与批量请求互斥：两者都代驾同一本地 Chrome
    setInspectingMode("on-demand");
    const toastId = toast.loading("正在检查收录状态…", {
      description: "按需分级查 GSC「网址检查」（每批上限 12 页，受 Google 限流，请勿关闭浏览器）",
    });
    try {
      const res = await fetch("/api/indexing/inspect-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "on-demand" }),
      });
      const body = (await res.json()) as {
        ok: boolean; code?: string; message?: string; hint?: string;
        inspected?: number; indexed?: number; notIndexed?: number; failed?: number;
        captchaBlocked?: boolean; remainingUnchecked?: number; durationMs?: number;
        mode?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.message || "收录检查失败", {
          id: toastId,
          description: body.hint || body.code,
          duration: 8000,
        });
        return;
      }
      const remain = body.remainingUnchecked ?? 0;
      if (body.captchaBlocked) {
        toast.warning("被 Google 限流（reCAPTCHA）", {
          id: toastId,
          description: `本次已查 ${body.inspected ?? 0} 页（已收录 ${body.indexed ?? 0}）。请在浏览器的 GSC 手动检查任意一个网址、通过 reCAPTCHA 后，再点"刷新收录"续跑。还剩 ${remain} 页待检查。`,
          duration: 12000,
        });
      } else if ((body.inspected ?? 0) === 0) {
        // 所有页面都在新鲜期内 → 给明确反馈
        toast.success("收录状态已是最新", {
          id: toastId,
          description:
            "所有页面都在新鲜期内（已收录 7 天内、未收录 24 小时内都已检查过），无需重复调用 API。到期页会由「定时」自动按需复查。",
          duration: 7000,
        });
      } else {
        toast.success("收录刷新完成", {
          id: toastId,
          description: `本次检查 ${body.inspected ?? 0} 页 · 已收录 ${body.indexed ?? 0}${body.notIndexed ? ` · 未收录 ${body.notIndexed}` : ""}${body.failed ? ` · 未取到 ${body.failed}` : ""}${remain > 0 ? ` · 还剩 ${remain} 页待检查` : ""} · 用时 ${Math.round((body.durationMs ?? 0) / 1000)}s`,
          duration: 8000,
        });
      }
      router.refresh();
    } catch (err) {
      toast.error("收录检查请求失败", {
        id: toastId,
        description: err instanceof Error ? err.message : "网络错误",
        duration: 8000,
      });
    } finally {
      setInspectingMode(null);
    }
  };

  // ── 重新扫描站点地图：触发 RSC 重新加载（sitemap 在 RSC 阶段实时抓取） ──
  const handleRescanSitemap = () => {
    if (rescanning) return;
    setRescanning(true);
    router.refresh();
    setTimeout(() => {
      setRescanning(false);
      toast.success("站点地图已重新扫描", {
        description: "页面数据已重新加载，新增或移除的页面已同步更新",
        duration: 4000,
      });
    }, 1500);
  };

  // 是否为真实 GSC 数据（mock 模式不去 GSC 抓 query，沿用 mock 样本）
  const isRealData = lastSyncMeta?.source === "gsc";

  // ── 更新流量：调 /api/indexing/update-traffic（官方 API，生产可跑） ──
  const handleUpdateTraffic = async () => {
    if (syncing) return;
    setSyncing(true);
    const toastId = toast.loading("正在更新流量数据…", {
      description: "通过官方 API 拉取最近 60 天 per-page 流量",
    });
    try {
      const res = await fetch("/api/indexing/update-traffic", { method: "POST" });
      const body = (await res.json()) as {
        ok: boolean; code?: string; message?: string;
        pages?: number; totalClicks?: number; totalImpressions?: number;
        retiredThisRun?: number; retiredTotal?: number; durationMs?: number; via?: string;
      };
      if (!res.ok || !body.ok) {
        const desc =
          body.code === "GSC_API_NOT_CONFIGURED"
            ? "未配置官方 API（GSC_SA_KEY_JSON）"
            : body.message || "更新失败";
        toast.error(desc, { id: toastId, duration: 8000 });
        return;
      }
      toast.success("流量已更新", {
        id: toastId,
        description: `本次 ${body.pages ?? 0} 页 · ${body.totalClicks ?? 0} 点击 · ${body.totalImpressions ?? 0} 曝光${body.retiredThisRun ? ` · 退休旧址 ${body.retiredThisRun}` : ""}`,
        duration: 6000,
      });
      router.refresh();
    } catch (err) {
      toast.error("更新请求失败", {
        id: toastId,
        description: err instanceof Error ? err.message : "网络错误",
        duration: 8000,
      });
    } finally {
      setSyncing(false);
    }
  };

  const [filters, setFilters] = useState<IndexingFilterState>({ ...DEFAULT_INDEXING_FILTERS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Deep-link（从选题工作台「收录索引命中」跳转而来）：
  //   · ?focusUrl=<完整线上 URL>（首选）—— 按 URL 精确定位，数据重排/重新同步也不丢；
  //   · ?focus=<pageId>（旧链接兼容）—— 按位置编号定位。
  // 命中后：切「列表视图」+ single 作用域（列表里只留这一条）+ 选中并打开它的数据抽屉；
  // 同时把筛选清回默认，避免目标页恰好被某条默认筛选挡掉而列表空白。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focusUrl = params.get("focusUrl");
    const focusId = params.get("focus");
    const target = focusUrl
      ? initialData.find((p) => p.fullUrl === focusUrl)
      : focusId
        ? initialData.find((p) => p.id === focusId)
        : undefined;
    if (target) {
      setFilters({ ...DEFAULT_INDEXING_FILTERS });
      setViewMode("list");
      setScope({ kind: "single", pageId: target.id });
      setSelectedId(target.id);
      setDrawerOpen(true);
    }
    // 仅 mount 执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  // ─── 批量修改页面类型（列表视图勾选，2026-07-04）───
  // key = fullUrl（跨排序/分页稳定）；操作后清空并 router.refresh()。
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [batchTypeValue, setBatchTypeValue] = useState("");   // 操作条下拉当前选的类型，"" = 未选
  const [batchTypeBusy, setBatchTypeBusy] = useState(false);
  // ─── 功能菜单 / 批量模式 / 全屏（2026-07-04 R2：勾选列平时不显示）───
  // batchMode=false 时 PageTable 不传勾选 props → 勾选列整列不渲染；
  // 经筛选行右侧「功能 → 批量页面修改」开启，再点一次关闭（并清空已选）。
  const [batchMode, setBatchMode] = useState(false);
  const [funcMenuOpen, setFuncMenuOpen] = useState(false);
  const funcMenuRef = useRef<HTMLDivElement>(null);
  // 全屏：隐藏标题栏 + 统计卡，纵向空间全部让给表格；同一位置按钮变「返回」，Esc 亦可退出。
  const [fullscreen, setFullscreen] = useState(false);
  // ─── 批量增量趋势（2026-07-04 R3）：勾选一批页 → 弹窗看合并每日曝光/点击增量曲线 ───
  const [trendOpen, setTrendOpen] = useState(false);
  const [batchTrend, setBatchTrend] = useState<{
    data: TrendData | null;
    loading: boolean;
    error: string | null;
    pages: number;
  }>({ data: null, loading: false, error: null, pages: 0 });
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
      setSelectedUrls(new Set());
      prevFingerprint.current = stats.lastSync;
    }
  }, [stats.lastSync]);

  // 功能菜单：点击外部关闭
  useEffect(() => {
    if (!funcMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (funcMenuRef.current?.contains(e.target as Node)) return;
      setFuncMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [funcMenuOpen]);

  // 全屏时按 Esc 退出（与「返回」按钮等效）
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // 增量趋势弹窗按 Esc 关闭
  useEffect(() => {
    if (!trendOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTrendOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trendOpen]);

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
      // 页面状态筛选：合成目录节点豁免（保树视图骨架不断层），真实页按 pageStatus 过滤
      if (filters.health.length > 0 && !p.isSynthetic) {
        const ps = p.pageStatus as PageStatus | undefined;
        if (!ps || !filters.health.includes(ps)) return false;
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

  // 当前范围（FilterBar + scope 过滤后）内的未收录页 —— 批量请求索引的作用对象。
  // 口径与详情抽屉里「请求 Google 索引」按钮一致（indexState !== "indexed"）。
  const notIndexedInScope = useMemo(
    () => scopedReal.filter((p) => p.indexState !== "indexed"),
    [scopedReal]
  );

  // ─── 批量修改页面类型：勾选行 → 操作条选类型确定 / 恢复自动推断（2026-07-04）───
  const toggleSelectRow = (fullUrl: string, checked: boolean) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fullUrl);
      else next.delete(fullUrl);
      return next;
    });
  };
  const toggleSelectPage = (fullUrls: string[], checked: boolean) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      for (const u of fullUrls) {
        if (checked) next.add(u);
        else next.delete(u);
      }
      return next;
    });
  };
  // pageType 非空 = 批量设为该类型；空串 = 批量恢复自动推断（与单条 API 同语义）。
  const handleBatchPageType = async (pageType: string) => {
    if (batchTypeBusy || selectedUrls.size === 0) return;
    const urls = [...selectedUrls];
    setBatchTypeBusy(true);
    const toastId = toast.loading(
      pageType ? `批量设置页面类型 → ${pageType}` : "批量恢复自动推断…",
      { description: `共 ${urls.length} 页` }
    );
    try {
      const res = await fetch("/api/indexing/page-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, pageType }),
      });
      const body = (await res.json()) as { ok?: boolean; count?: number; message?: string };
      if (!res.ok || !body.ok) {
        toast.error("批量修改失败", {
          id: toastId,
          description: body.message || `HTTP ${res.status}`,
          duration: 8000,
        });
        return;
      }
      toast.success(
        pageType
          ? `已把 ${body.count ?? urls.length} 页设为「${pageType}」`
          : `已恢复 ${body.count ?? urls.length} 页为自动推断`,
        { id: toastId, duration: 5000 }
      );
      setSelectedUrls(new Set());
      setBatchTypeValue("");
      router.refresh();
    } catch (err) {
      toast.error("批量修改请求失败", {
        id: toastId,
        description: err instanceof Error ? err.message : "网络错误",
        duration: 8000,
      });
    } finally {
      setBatchTypeBusy(false);
    }
  };

  // ─── 批量增量趋势：把当前已选页发给 /pages-trend，弹窗展示合并每日增量曲线 ───
  const openBatchTrend = async () => {
    if (selectedUrls.size === 0) return;
    const urls = [...selectedUrls];
    setTrendOpen(true);
    setBatchTrend({ data: null, loading: true, error: null, pages: urls.length });
    try {
      const res = await fetch("/api/indexing/pages-trend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        startDate?: string | null;
        pages?: number;
        series?: { date: string; clicks: number; impressions: number }[];
        message?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setBatchTrend({
        data: { ok: true, startDate: body.startDate ?? null, series: body.series ?? [] },
        loading: false,
        error: null,
        pages: body.pages ?? urls.length,
      });
    } catch (err) {
      setBatchTrend({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "加载失败",
        pages: urls.length,
      });
    }
  };

  // 批量「请求编入索引」：对 notIndexedInScope 逐个串行代驾 GSC（复用单页 /request-index 接口）。
  // 设计吸取实测教训：① 串行 + 每次间隔，绝不并发；② 撞配额/验证码立即停；③ 连续 2 次失败
  // （多为 GSC 短时限流「糟糕！出了点问题·请稍后重试」）自动暂停，不无谓 hammering；
  // ④ 全程进度 toast，末尾如实汇总（已请求 / 已收录 / 失败 / 未处理）。
  const handleBatchRequestIndex = async () => {
    if (batchRequesting || inspecting) return;
    const targets = notIndexedInScope;
    if (targets.length === 0) return;
    setBatchRequesting(true);
    const toastId = toast.loading("批量请求索引中…", {
      description: `共 ${targets.length} 个未收录页 · 逐个提交（本地浏览器代驾 GSC，受 Google 限流，请勿关闭浏览器）`,
    });
    let requested = 0;
    let already = 0;
    let throttled = 0;
    let failed = 0;
    let done = 0;
    let consecutiveFail = 0;
    let stopped: { reason: string; desc: string } | null = null;
    try {
      for (let i = 0; i < targets.length; i++) {
        const page = targets[i];
        toast.loading("批量请求索引中…", {
          id: toastId,
          description: `${done}/${targets.length} 完成 · 正在提交：${page.url}`,
        });
        let status = "failed";
        try {
          const res = await fetch("/api/indexing/request-index", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: page.fullUrl }),
          });
          const data = (await res.json()) as { ok?: boolean; status?: string; message?: string };
          status = res.ok ? data.status ?? "failed" : "failed";
        } catch {
          status = "failed";
        }

        // 撞配额 / 人机验证 → 继续也没用，立即停下等人工。
        if (status === "quota_exceeded") {
          stopped = { reason: "配额用尽", desc: "今日 Google「请求索引」配额已用尽，请明天再试剩余页。" };
          break;
        }
        if (status === "captcha") {
          stopped = { reason: "撞人机验证", desc: "请到浏览器 GSC 手动完成 reCAPTCHA 后，再续跑剩余页。" };
          break;
        }

        done++;
        if (status === "requested") {
          requested++;
          consecutiveFail = 0;
        } else if (status === "already_indexed") {
          already++;
          consecutiveFail = 0;
        } else if (status === "throttled") {
          // 撞 GSC 短时限流「请稍后重试」→ 继续也是撞墙，立即暂停等冷却（比等 2 连败更早）。
          throttled++;
          stopped = {
            reason: "GSC 限流",
            desc: "GSC 暂时限流（弹出「请稍后重试」），已暂停，请过一会儿再试剩余页。",
          };
          break;
        } else {
          failed++;
          consecutiveFail++;
        }

        // 连续 2 次失败多为 GSC 短时限流 → 暂停，避免继续 hammering 触发更长封锁 / reCAPTCHA。
        if (consecutiveFail >= 2) {
          stopped = { reason: "连续报错已暂停", desc: "GSC 连续返回错误（多为短时限流），已暂停，请稍后再试剩余页。" };
          break;
        }

        // 节流：逐个之间留间隔，末个不等。
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 2500));
      }

      const remaining = targets.length - done;
      const summary =
        `已请求 ${requested}` +
        (already ? ` · 已收录 ${already}` : "") +
        (throttled ? ` · 限流 ${throttled}` : "") +
        (failed ? ` · 失败 ${failed}` : "") +
        (remaining > 0 ? ` · 未处理 ${remaining}` : "");

      if (stopped) {
        toast.warning(`批量请求已暂停：${stopped.reason}`, {
          id: toastId,
          description: `${summary}。${stopped.desc}`,
          duration: 10000,
        });
      } else if (requested === 0 && already > 0 && failed === 0) {
        toast.info("这些页都已收录，无需请求", { id: toastId, description: summary, duration: 6000 });
      } else if (requested === 0 && failed > 0) {
        toast.error("批量请求未成功", {
          id: toastId,
          description: `${summary}。可稍后重试，或到浏览器手动点单页按钮。`,
          duration: 9000,
        });
      } else {
        toast.success("批量请求索引完成", {
          id: toastId,
          description: `${summary}（已加入 Google 优先抓取队列）· 稍后可点「刷新收录」复查状态`,
          duration: 8000,
        });
      }
    } finally {
      setBatchRequesting(false);
    }
  };

  // 两步确认：首点"武装"（4s 内有效、按钮变红），再点才真正执行——防误触烧当日配额。
  const armOrRunBatch = () => {
    if (batchRequesting || inspecting || notIndexedInScope.length === 0) return;
    if (batchArmTimer.current) clearTimeout(batchArmTimer.current);
    if (!batchArmed) {
      setBatchArmed(true);
      batchArmTimer.current = setTimeout(() => setBatchArmed(false), 4000);
      return;
    }
    setBatchArmed(false);
    void handleBatchRequestIndex();
  };

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
    // 平均排名口径与服务端 coverage-loader 完全对齐：只对"有曝光"的页求均值
    // （position=0 表示无曝光/未上榜，计入会把均值往下拉 → 点根节点时全站口径对不上，
    //  曾出现 9.3→7.0 的漂移）。
    const withImpr = rows.filter((p) => p.impressions > 0);
    return {
      totalPages: n,
      totalClicks,
      totalImpressions,
      // CTR 用加权口径（总点击/总曝光），与发亮卡片 CTR、GSC 全站 CTR 同义
      avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      avgPosition: withImpr.length
        ? parseFloat((withImpr.reduce((s, p) => s + p.position, 0) / withImpr.length).toFixed(1))
        : 0,
      top10Pages: rows.filter((p) => p.position > 0 && p.position <= 10).length,
      lastSync: stats.lastSync,
      // 已收录数：scope 内 indexState==="indexed" 的真实页数。缺了这个字段，SummaryBar 的
      // AGNITI 卡片读 (indexedCount ?? 0) 会恒显 0 —— 点结构树任意节点（含根节点）即触发。
      indexedCount: rows.filter((p) => p.indexState === "indexed").length,
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

  // 增量趋势弹窗尺寸：宽 ≈ 94vw(上限 1240)，图宽 = 弹窗内宽（ssr:false 组件，window 恒可用，仍留兜底）
  const trendModalW = Math.min(1240, (typeof window !== "undefined" ? window.innerWidth : 1280) * 0.94);
  const trendChartW = Math.max(370, Math.floor(trendModalW) - 56);

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
        <div className={fullscreen ? "hidden" : "px-5 py-3 border-b border-manor-brass/25 bg-manor-bg2 flex items-center justify-between gap-4 shrink-0"}>
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
            {/* 刷新收录状态 —— 按需分级查收录 */}
            <div
              className={[
                "h-7 inline-flex items-center border rounded overflow-hidden shrink-0 transition-all",
                inspecting ? "border-manor-brass/25" : "border-manor-brass/45",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={handleInspectCoverage}
                disabled={inspecting || batchRequesting}
                title={inspecting ? "正在检查收录…" : "按需分级：没查过的立即查 · 未收录24h复查 · 已收录7天兜底"}
                className={[
                  "h-full inline-flex items-center gap-1.5 px-2.5 text-[11px] whitespace-nowrap transition-all",
                  inspecting
                    ? "text-manor-inkDim cursor-wait"
                    : "text-manor-brassHi hover:bg-manor-brassDim/10",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.12em" }}
              >
                <RefreshCw size={12} className={inspectingMode === "on-demand" ? "animate-spin" : ""} aria-hidden="true" />
                <span>{inspectingMode === "on-demand" ? "检查中" : "刷新收录"}</span>
              </button>
            </div>
            {/* 重新扫描站点地图 —— 触发 RSC 重新加载 sitemap 数据 */}
            <button
              type="button"
              onClick={handleRescanSitemap}
              disabled={rescanning}
              title="重新加载站点地图数据，把新增或移除的页面纳入"
              className={[
                "h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-[11px] whitespace-nowrap shrink-0",
                "border transition-all",
                rescanning
                  ? "border-manor-brass/25 text-manor-inkDim cursor-wait"
                  : "border-manor-brass/35 text-manor-brassDim hover:text-manor-brassHi hover:border-manor-brass/55 hover:bg-manor-brassDim/10",
              ].join(" ")}
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.1em" }}
            >
              <Globe size={12} className={rescanning ? "animate-spin" : ""} aria-hidden="true" />
              <span>{rescanning ? "扫描中" : "扫描地图"}</span>
            </button>
            {/* 定时收录设置 */}
            <button
              type="button"
              onClick={() => setSchedulerOpen(true)}
              title="设置定时自动检查收录状态"
              className={[
                "h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-[11px] whitespace-nowrap shrink-0",
                "border transition-all",
                "border-manor-brass/35 text-manor-brassDim hover:text-manor-brassHi hover:border-manor-brass/55 hover:bg-manor-brassDim/10",
              ].join(" ")}
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.1em" }}
            >
              <Clock size={12} aria-hidden="true" />
              <span>定时</span>
            </button>
            {/* 批量请求索引 —— 对当前范围内未收录页逐个代驾 GSC「请求编入索引」。
                仅本地（syncEnabled）显示：依赖本地浏览器 9222，与详情抽屉里的单页按钮同一引擎。
                两步确认（首点武装 4s → 再点执行）防误触烧当日配额。 */}
            {syncEnabled && (
              <button
                type="button"
                onClick={armOrRunBatch}
                disabled={batchRequesting || inspecting || notIndexedInScope.length === 0}
                title={
                  notIndexedInScope.length === 0
                    ? "当前范围内没有未收录页"
                    : batchRequesting
                      ? "正在批量请求索引…"
                      : `对当前范围内 ${notIndexedInScope.length} 个未收录页逐个请求 Google 抓取（本地浏览器代驾 GSC · 受每日配额限制）`
                }
                className={[
                  "h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-[11px] whitespace-nowrap shrink-0",
                  "border transition-all",
                  batchRequesting
                    ? "border-manor-brass/25 text-manor-inkDim cursor-wait"
                    : notIndexedInScope.length === 0
                      ? "border-manor-brass/15 text-manor-inkGhost cursor-not-allowed"
                      : batchArmed
                        ? "border-manor-oxbloodHi/70 text-manor-oxbloodHi bg-manor-oxbloodHi/15 hover:bg-manor-oxbloodHi/25"
                        : "border-manor-brass/45 text-manor-brassHi hover:border-manor-brassHi hover:shadow-[0_0_10px_-2px_rgba(239,216,154,.65)] hover:bg-manor-brassDim/10",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.1em" }}
              >
                <Send size={12} className={batchRequesting ? "animate-pulse" : ""} aria-hidden="true" />
                <span>
                  {batchRequesting
                    ? "请求中"
                    : batchArmed
                      ? `确认请求 ${notIndexedInScope.length} 页？`
                      : `请求索引${notIndexedInScope.length ? ` (${notIndexedInScope.length})` : ""}`}
                </span>
              </button>
            )}
            {/* 更新流量 —— 官方 API，生产可跑 */}
            <button
              type="button"
              onClick={handleUpdateTraffic}
              disabled={syncing || !trafficApiConfigured}
              title={
                !trafficApiConfigured
                  ? "未配置官方 API，无法更新流量"
                  : syncing
                    ? "正在更新…"
                    : "通过官方 API 拉取最近 60 天流量数据"
              }
              className={[
                "h-7 inline-flex items-center gap-1.5 px-2.5 rounded text-[11px] whitespace-nowrap shrink-0",
                "border transition-all",
                syncing
                  ? "border-manor-brass/25 text-manor-inkDim cursor-wait"
                  : !trafficApiConfigured
                    ? "border-manor-brass/15 text-manor-inkGhost cursor-not-allowed"
                    : "border-manor-brass/45 text-manor-brassHi hover:border-manor-brassHi hover:shadow-[0_0_10px_-2px_rgba(239,216,154,.65)] hover:bg-manor-brassDim/10",
              ].join(" ")}
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", letterSpacing: "0.12em" }}
            >
              <RefreshCw
                size={12}
                className={syncing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>{syncing ? "更新中" : "更新"}</span>
            </button>
            <Input
              className="w-32 lg:w-44 xl:w-56 h-7 bg-manor-void/60 border-manor-brass/30 text-manor-ink placeholder:text-manor-inkFaint text-xs focus-visible:ring-manor-brass focus-visible:border-manor-brass min-w-0"
              placeholder="搜索 URL / 关键词..."
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
          </div>
        </div>

        {/* 统计指标 —— 全屏时隐藏，纵向空间让给表格 */}
        <div className={fullscreen ? "hidden" : "px-5 py-3 border-b border-manor-brass/15 bg-manor-bg2 shrink-0"}>
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
              activeWindow={activeWindow}
              onWindowNavigate={handleWindowNavigate}
            />
          </div>

          {/* 功能菜单 —— 批量操作等入口收拢在此，平时不占表格空间（仅列表视图） */}
          {viewMode === "list" && (
            <div ref={funcMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFuncMenuOpen((v) => !v)}
                title="功能：批量操作等"
                className={[
                  "h-8 px-2.5 inline-flex items-center gap-1.5 text-[11px] border rounded-md transition-colors",
                  batchMode
                    ? "border-manor-brassHi/60 text-manor-brassHi bg-manor-brassDim/15"
                    : "border-manor-brass/30 text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
              >
                <Wrench size={12} aria-hidden="true" />
                <span className="tracking-wide">功能</span>
              </button>
              {funcMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 rounded border border-manor-brass/40 py-1 min-w-[168px]"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(18,38,26,.98) 0%, rgba(8,20,13,.99) 100%)",
                    boxShadow: "0 8px 24px rgba(0,0,0,.5), inset 0 1px 0 rgba(224,197,122,.15)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setBatchMode((v) => {
                        const next = !v;
                        if (!next) setSelectedUrls(new Set()); // 关闭批量模式时清空已选
                        return next;
                      });
                      setFuncMenuOpen(false);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-xs text-left text-manor-ink/90 hover:bg-manor-brassDim/15 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 9999,
                        background: batchMode ? "#C9A961" : "transparent",
                        border: "1px solid rgba(201,169,97,.6)",
                        boxShadow: batchMode ? "0 0 5px rgba(201,169,97,.7)" : "none",
                      }}
                    />
                    <span>批量页面修改</span>
                    {batchMode && <span className="ml-auto text-manor-brassHi text-[10px]">已开启</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFuncMenuOpen(false);
                      if (selectedUrls.size > 0) {
                        // 已有勾选 → 直接看这批页的增量趋势
                        void openBatchTrend();
                      } else {
                        // 还没勾选 → 先开启勾选模式，提示去勾页
                        setBatchMode(true);
                        toast.info("已开启勾选", {
                          description: "勾选页面后，点操作条里的「增量趋势」查看这批页的合并走势",
                          duration: 5000,
                        });
                      }
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-xs text-left text-manor-ink/90 hover:bg-manor-brassDim/15 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 9999,
                        background: "transparent",
                        border: "1px solid rgba(201,169,97,.6)",
                      }}
                    />
                    <span>批量增量趋势</span>
                    {selectedUrls.size > 0 && (
                      <span className="ml-auto text-manor-brassHi text-[10px]">看已选 {selectedUrls.size} 页</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 全屏 / 返回 —— 隐藏标题栏+统计卡，纵向空间让给数据区（Esc 亦可退出） */}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "退出全屏（Esc）" : "全屏：隐藏上方标题与统计卡，显示更多数据行"}
            className={[
              "h-8 px-2.5 shrink-0 inline-flex items-center gap-1.5 text-[11px] border rounded-md transition-colors",
              fullscreen
                ? "border-manor-brassHi/60 text-manor-brassHi bg-manor-brassDim/15"
                : "border-manor-brass/30 text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
            ].join(" ")}
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            {fullscreen ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
            <span className="tracking-wide">{fullscreen ? "返回" : "全屏"}</span>
          </button>
        </div>

        {/* 主体：树（导航） / 列表（按 scope 显示） */}
        <div className="flex-1 overflow-auto bg-manor-bg2 flex flex-col min-h-0">
          {viewMode === "list" && (
            <ScopeBreadcrumb scope={scope} onChange={setScope} byId={allById} />
          )}
          {/* 批量修改页面类型操作条 —— 批量模式且勾选数 > 0 时浮出（仅列表视图） */}
          {viewMode === "list" && batchMode && selectedUrls.size > 0 && (
            <div
              className="px-4 py-2 border-b border-manor-brass/25 shrink-0 flex items-center gap-2.5 text-xs"
              style={{
                background:
                  "linear-gradient(180deg, rgba(28,56,38,.92) 0%, rgba(14,32,22,.96) 100%)",
                boxShadow: "inset 0 1px 0 rgba(224,197,122,.18)",
              }}
            >
              <span
                className="font-sc tracking-[0.22em] text-manor-brassHi/85 leading-none"
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
              >
                SELECTIO
              </span>
              <span className="text-manor-brassHi tabnum">已选 {selectedUrls.size} 页</span>
              <button
                type="button"
                onClick={() => setSelectedUrls(new Set(scopedReal.map((p) => p.fullUrl)))}
                disabled={batchTypeBusy}
                className="h-6 px-2 border border-manor-brass/40 rounded text-xs text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                全选筛选结果 ({scopedReal.length})
              </button>
              <button
                type="button"
                onClick={() => void openBatchTrend()}
                disabled={batchTypeBusy}
                title="查看已选页面的合并每日曝光/点击增量走势"
                className="h-6 px-2 border border-manor-brass/40 rounded text-xs text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                增量趋势
              </button>

              <span className="flex-1" />

              <span className="text-manor-inkDim">设为</span>
              <select
                value={batchTypeValue}
                onChange={(e) => setBatchTypeValue(e.target.value)}
                disabled={batchTypeBusy}
                className="h-6 border border-manor-brass/40 rounded px-1.5 text-xs text-manor-brassHi bg-manor-bg2 focus:outline-none focus:border-manor-brassHi cursor-pointer hover:border-manor-brassHi transition-colors disabled:opacity-40"
              >
                <option value="">选择类型…</option>
                {PAGE_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleBatchPageType(batchTypeValue)}
                disabled={!batchTypeValue || batchTypeBusy}
                className="h-6 px-2.5 border border-manor-brassHi/60 rounded text-xs text-manor-brassHi bg-manor-brassDim/15 hover:bg-manor-brassDim/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {batchTypeBusy ? "写入中…" : "确定"}
              </button>
              <button
                type="button"
                onClick={() => handleBatchPageType("")}
                disabled={batchTypeBusy}
                title="清除这些页的人工修正，恢复按 URL 规则自动推断"
                className="h-6 px-2 border border-manor-brass/40 rounded text-xs text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                恢复自动推断
              </button>
              <button
                type="button"
                onClick={() => setSelectedUrls(new Set())}
                disabled={batchTypeBusy}
                title="取消选择"
                className="h-6 w-6 inline-flex items-center justify-center border border-manor-brass/40 rounded text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi disabled:opacity-40 transition-colors"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0">
            {viewMode === "list" ? (
              <PageTable
                data={paginated}
                onRowClick={handleRowClick}
                // 批量模式才传勾选三件套 → 平时勾选列整列不渲染，不占表格空间
                {...(batchMode
                  ? {
                      selectedUrls,
                      onToggleRow: toggleSelectRow,
                      onTogglePage: toggleSelectPage,
                    }
                  : {})}
              />
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
            syncEnabled={syncEnabled}
          />
        )}
      </div>

      {/* 定时收录设置对话框 */}
      <SchedulerSettingsDialog
        open={schedulerOpen}
        onOpenChange={setSchedulerOpen}
      />

      {/* 批量增量趋势弹窗 —— 已选页合并的每日曝光/点击增量曲线（与抽屉同款图，Esc/点遮罩关闭） */}
      {trendOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,.62)" }}
          onClick={() => setTrendOpen(false)}
        >
          <div
            className="rounded border border-manor-brass/40 max-h-[92vh] overflow-y-auto"
            style={{
              width: trendModalW,
              background:
                "linear-gradient(180deg, rgba(18,38,26,.99) 0%, rgba(8,20,13,1) 100%)",
              boxShadow:
                "0 12px 40px rgba(0,0,0,.6), inset 0 1px 0 rgba(224,197,122,.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题行 */}
            <div className="px-5 py-3 border-b border-manor-brass/25 flex items-center gap-2.5">
              <span
                aria-hidden="true"
                style={{
                  width: 5,
                  height: 5,
                  transform: "rotate(45deg)",
                  background: "linear-gradient(135deg, #EFD89A 0%, #A08850 100%)",
                  boxShadow: "0 0 5px rgba(239,216,154,.6)",
                }}
              />
              <span
                className="text-manor-brassHi/85 tracking-[0.22em]"
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 11 }}
              >
                INCREMENTUM
              </span>
              <span className="text-manor-ink/90 text-base">
                增量趋势 · {batchTrend.pages} 页合并
              </span>
              <button
                type="button"
                onClick={() => setTrendOpen(false)}
                title="关闭（Esc）"
                className="ml-auto h-7 w-7 inline-flex items-center justify-center border border-manor-brass/40 rounded text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            {/* 图区 —— 复用抽屉同款 PageTrendSection，large 大图模式，宽度吃满弹窗 */}
            <div className="px-6 py-4">
              <PageTrendSection
                data={batchTrend.data}
                loading={batchTrend.loading}
                error={batchTrend.error}
                large
                chartWidth={trendChartW}
                showCtr
              />
            </div>
            {/* 口径说明 */}
            <div className="px-6 pb-4">
              <p className="text-[11px] text-manor-inkFaint leading-relaxed">
                口径：每日增量 = 所选页（含旧址 308 归并来源）当日曝光 / 点击之和；CTR 虚线 =
                当日点击 ÷ 当日曝光（独立比例，精确值悬停查看）；与单页抽屉「流量趋势」同源同口径。
                GSC 数据固有约 2 天延迟。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
