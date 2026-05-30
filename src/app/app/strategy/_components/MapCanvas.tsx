"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Plus, X, ExternalLink, AlertTriangle } from "lucide-react";
import type { WbPage, RawKeyword, Territory, PageRelation } from "./_workbench";
import { dedupeKeywords, isHardCannibalization } from "./_workbench";
import {
  RoleMark,
  StatusChip,
  FunnelChip,
  FUNNEL_META,
  themeFunnelCoverage,
  CoverageBar,
  MarketFlags,
  formatSv,
  positionText,
  formatPagePlanningIntent,
  formatBehaviorIntent,
  marketFlag,
} from "./_utils";
import type { ViewMode } from "./WorkbenchClient";
import { RadialView } from "./RadialView";

interface MapCanvasProps {
  pages: WbPage[];
  bindings: Record<string, string>;
  allKeywords: RawKeyword[];
  boundByPage: Map<string, RawKeyword[]>;
  view: ViewMode;
  highlightPageId: string | null;
  selectedPageId: string | null;
  onPageSelect: (id: string) => void;
  onUnassign: (kwIds: string[]) => void;
  onNewPillar: (title: string, territory: Territory) => void;
  onNewCluster: (title: string, pillarId: string) => void;
  territories: Territory[];
  /** 页面关系（蚕食检测输出）；用于在涉及真蚕食的节点上加红色徽标。 */
  conflicts?: PageRelation[];
}

// ── Theme tab bar ─────────────────────────────────────────────────────────────
// 无可见滚动条；鼠标悬浮时竖向滚轮 → 横向滚动；两侧用"渐隐+轻模糊"提示还能往哪滚。
function ThemeTabBar({
  themes,
  activeTheme,
  onSelect,
  sc,
}: {
  themes: [string, string][];
  activeTheme: string;
  onSelect: (id: string) => void;
  sc: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const updateEdges = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setEdges({
      left: scrollLeft > 1,
      right: scrollLeft + clientWidth < scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    // 竖向滚轮 → 横向滚动：仅当本条确有溢出时拦截，避免吃掉页面竖滚
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      updateEdges();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", updateEdges);
      ro.disconnect();
    };
  }, [updateEdges, themes.length]);

  const tabCls = (active: boolean) =>
    [
      "h-6 px-2.5 rounded text-[11px] whitespace-nowrap transition-colors",
      active
        ? "text-manor-brassHi bg-manor-brassDim/15 font-medium"
        : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/8",
    ].join(" ");

  return (
    <div className="shrink-0 relative px-4 pt-2.5 pb-1">
      <div ref={scrollRef} className="no-scrollbar overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          <button
            type="button"
            onClick={() => onSelect("all")}
            className={tabCls(activeTheme === "all")}
            style={{ fontFamily: sc }}
          >
            全部
          </button>
          {themes.map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={tabCls(activeTheme === id)}
              style={{ fontFamily: sc }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* 左/右 渐隐+轻模糊 提示层：仅在该方向还能滚动时淡入 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-12 transition-opacity duration-200"
        style={{
          opacity: edges.left ? 1 : 0,
          backdropFilter: "blur(2.5px)",
          WebkitBackdropFilter: "blur(2.5px)",
          background:
            "linear-gradient(to right, var(--color-manor-bg2, #08130D) 18%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, #000 25%, transparent)",
          maskImage: "linear-gradient(to right, #000 25%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-12 transition-opacity duration-200"
        style={{
          opacity: edges.right ? 1 : 0,
          backdropFilter: "blur(2.5px)",
          WebkitBackdropFilter: "blur(2.5px)",
          background:
            "linear-gradient(to left, var(--color-manor-bg2, #08130D) 18%, transparent)",
          WebkitMaskImage: "linear-gradient(to left, #000 25%, transparent)",
          maskImage: "linear-gradient(to left, #000 25%, transparent)",
        }}
      />
    </div>
  );
}

// 核心产品主题 —— 唯一真正售卖、所有引流页最终导向成交的核心（当前为 Zikr Ring）。
// TODO: 后续改为数据驱动 / 可配置（如按"含 /products/ 且真备货"判定），暂以主题 id 锚定。
const CORE_THEME_ID = "zikr-ring";

// ── Tree View ────────────────────────────────────────────────────────────────
function TreeView({
  pages,
  boundByPage,
  highlightPageId,
  selectedPageId,
  onPageSelect,
  onUnassign,
  onNewPillar,
  onNewCluster,
  territories,
  conflicts = [],
}: Omit<MapCanvasProps, "view" | "bindings" | "allKeywords">) {
  const pillars = pages.filter((p) => p.role === "pillar");

  // 涉及「真蚕食」的页面 id 集合 —— 节点红徽标只认这一个口径（与 Dock/Inspector 统一）
  const hardConflictIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      if (isHardCannibalization(c)) { s.add(c.aId); s.add(c.bId); }
    }
    return s;
  }, [conflicts]);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [newPillarTitle, setNewPillarTitle] = React.useState("");
  const [newPillarTerritory, setNewPillarTerritory] = React.useState<Territory>("知识");
  const [showNewPillar, setShowNewPillar] = React.useState(false);
  const [newClusterFor, setNewClusterFor] = React.useState<string | null>(null);
  const [newClusterTitle, setNewClusterTitle] = React.useState("");
  const [activeTheme, setActiveTheme] = React.useState<string>("all");
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Unique themes for tabs
  const themes = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pillars) {
      if (!seen.has(p.themeId)) seen.set(p.themeId, p.themeName);
    }
    return Array.from(seen.entries()); // [themeId, themeName][]
  }, [pillars]);

  // Filter pillars by active theme
  const filteredPillars = React.useMemo(() => {
    if (activeTheme === "all") return pillars;
    return pillars.filter((p) => p.themeId === activeTheme);
  }, [pillars, activeTheme]);

  // 顶层组织 = 核心 + 引流：Zikr Ring 单独置顶为「核心」，其余主题按渠道（territory）分组为「引流层」，
  // 全部视觉上从属于核心。体现「一个核心产品 + 一圈按抓什么流量分工、向核心导流的页面」。
  const groups = React.useMemo(() => {
    const core = filteredPillars.filter((p) => p.themeId === CORE_THEME_ID);
    const tributary = filteredPillars.filter((p) => p.themeId !== CORE_THEME_ID);
    const byTer = new Map<Territory, WbPage[]>();
    for (const p of tributary) {
      if (!byTer.has(p.territory)) byTer.set(p.territory, []);
      byTer.get(p.territory)!.push(p);
    }
    const result: { key: string; label: string; kind: "core" | "tributary"; pillars: WbPage[] }[] = [];
    if (core.length) result.push({ key: "__core__", label: "核心产品 · 成交目标", kind: "core", pillars: core });
    for (const t of territories) {
      const ps = byTer.get(t);
      if (ps && ps.length) result.push({ key: t, label: t, kind: "tributary", pillars: ps });
    }
    return result;
  }, [filteredPillars, territories]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Theme tabs */}
      <ThemeTabBar themes={themes} activeTheme={activeTheme} onSelect={setActiveTheme} sc={sc} />

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-4" style={{ scrollbarGutter: "stable" }}>
      {groups.map((group, gi) => {
        const groupPillars = group.pillars;
        const isCore = group.kind === "core";
        const prevTributary = gi > 0 && groups[gi - 1].kind === "tributary";
        return (
          <div key={group.key}>
            {/* 在第一个引流分组前,插一条"以下为核心引流"分隔 */}
            {!isCore && !prevTributary && (
              <div className="flex items-center gap-2 mb-2 mt-1">
                <span className="text-[9px] tracking-[0.18em] text-manor-sageHi/55 uppercase" style={{ fontFamily: sc }}>
                  ↑ 以下页面为核心引流 · 按抓什么流量分工
                </span>
                <span className="flex-1 h-px bg-manor-line/60" />
              </div>
            )}
            {/* Group label */}
            <div className="flex items-center gap-2 mb-2">
              {isCore ? (
                <span
                  className="text-[11px] tracking-[0.14em] text-manor-brassHi"
                  style={{ fontFamily: sc, textShadow: "0 0 8px rgba(239,216,154,.4)" }}
                  title="唯一真正售卖、所有引流页最终在此成交的核心产品"
                >
                  ◎ {group.label}
                </span>
              ) : (
                <span className="text-[9px] tracking-[0.2em] text-manor-sageHi/65 uppercase" style={{ fontFamily: sc }}>
                  {group.label}
                </span>
              )}
              <span className="flex-1 h-px bg-manor-line" />
              <span className="text-[9px] text-manor-inkFaint tabular-nums shrink-0">{groupPillars.length}</span>
            </div>

            {groupPillars.map((pillar) => {
              const clusters = pages.filter((p) => p.pillarId === pillar.id);
              const coverage = themeFunnelCoverage([pillar.url, ...clusters.map((c) => c.url)]);
              const isCollapsed = collapsed.has(pillar.id);
              const pillarKws = boundByPage.get(pillar.id) ?? [];
              const isHighlighted = highlightPageId === pillar.id;
              const isSelected = selectedPageId === pillar.id;

              return (
                <div key={pillar.id} className="mb-3">
                  {/* Pillar node */}
                  <div
                    onClick={() => onPageSelect(pillar.id)}
                    className={[
                      "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-all border",
                      isHighlighted
                        ? "border-manor-brass/70 bg-manor-brassDim/15"
                        : isSelected
                        ? "border-manor-brass/40 bg-manor-bg3"
                        : "border-transparent hover:bg-manor-bg3/60",
                      isHighlighted ? "animate-pulse" : "",
                    ].join(" ")}
                    style={isHighlighted ? { boxShadow: "0 0 12px rgba(239,216,154,.3)" } : undefined}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(pillar.id); }}
                      className="text-manor-inkDim hover:text-manor-brassHi shrink-0"
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <RoleMark role="pillar" size={9} />
                    <span className="font-medium text-sm text-manor-ink truncate flex-1 min-w-0">
                      {pillar.title}
                    </span>
                    {hardConflictIds.has(pillar.id) && (
                      <span title="存在真蚕食冲突" className="shrink-0 inline-flex">
                        <AlertTriangle size={12} className="text-manor-oxbloodHi" />
                      </span>
                    )}
                    <StatusChip status={pillar.status} size="sm" />
                    <FunnelChip url={pillar.url} size="sm" />
                    {formatPagePlanningIntent(pillar.pageType)}
                    <MarketFlags markets={pillar.markets} maxN={3} />
                    {pillar.url && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-mono text-manor-brassDim bg-manor-void/45 border border-manor-line2/70 truncate max-w-[190px] shrink-0"
                        title={pillar.url}
                      >
                        {pillar.status === "gap" && <span className="text-manor-brassHi/70 not-italic">✚</span>}
                        {pillar.url}
                      </span>
                    )}
                  </div>

                  {/* Expanded content */}
                  {!isCollapsed && (
                    <div className="ml-6 pl-3 border-l border-manor-line/50">
                      {/* 主题页面类型覆盖：这个主题覆盖了「博客 / 品类 / 产品」哪几层漏斗 */}
                      <div className="flex items-center gap-1.5 py-1.5 text-[10px] flex-wrap">
                        <span
                          className="text-manor-inkFaint shrink-0"
                          title="这个主题覆盖了「信息(blog) · 品类(collection) · 成交(product)」哪几层漏斗"
                        >
                          类型覆盖
                        </span>
                        {coverage.present.size === 0 ? (
                          <span className="text-manor-inkFaint italic">页面尚未设 URL，无法识别</span>
                        ) : (
                          (["blog", "collection", "product", "page"] as const)
                            .filter((f) => coverage.present.has(f))
                            .map((f) => {
                              const meta = FUNNEL_META[f];
                              return (
                                <span
                                  key={f}
                                  className={`inline-flex items-center gap-0.5 px-1 py-0 rounded border text-[9px] ${meta.chip} ${meta.text}`}
                                  title={`已覆盖${meta.label} · ${meta.sublabel}`}
                                >
                                  ✓ {meta.label}
                                </span>
                              );
                            })
                        )}
                        {pillar.territory === "产品" && coverage.missing.length > 0 && (
                          <span
                            className="text-manor-brassHi/80 text-[9px]"
                            title="缺这些页面类型 = 对应的「信息 / 品类 / 成交」漏斗层没有落地页承接，这部分流量会白白流失"
                          >
                            建议补：{coverage.missing.map((f) => FUNNEL_META[f].label).join("、")}
                          </span>
                        )}
                      </div>

                      {/* Bound keywords on pillar */}
                      {pillarKws.length > 0 && (
                        <div className="flex flex-wrap gap-1 py-1.5">
                          {dedupeKeywords(pillarKws).map((g) => (
                            <span
                              key={g.key}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-manor-bg4 border border-manor-line2 text-manor-ink/90 hover:border-manor-brass/45 hover:text-manor-ink transition-colors group"
                            >
                              {g.keyword}
                              {g.count > 1 && (
                                <span className="text-[9px] text-manor-inkFaint" title={`${g.count} 个市场变体`}>×{g.count}</span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onUnassign(g.ids); }}
                                className="opacity-0 group-hover:opacity-100 text-manor-oxbloodHi hover:text-manor-oxbloodHi transition-opacity"
                                title={g.count > 1 ? `移出（含 ${g.count} 个市场变体）` : "移出"}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Clusters */}
                      {clusters.map((cluster) => {
                        const clusterKws = boundByPage.get(cluster.id) ?? [];
                        const clIsHighlighted = highlightPageId === cluster.id;
                        const clIsSelected = selectedPageId === cluster.id;
                        return (
                          <div key={cluster.id} className="mb-2">
                            <div
                              onClick={() => onPageSelect(cluster.id)}
                              className={[
                                "flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-all border",
                                clIsHighlighted
                                  ? "border-manor-brass/60 bg-manor-brassDim/12"
                                  : clIsSelected
                                  ? "border-manor-brass/30 bg-manor-bg3"
                                  : "border-transparent hover:bg-manor-bg3/50",
                                clIsHighlighted ? "animate-pulse" : "",
                              ].join(" ")}
                              style={clIsHighlighted ? { boxShadow: "0 0 10px rgba(239,216,154,.25)" } : undefined}
                            >
                              <RoleMark role="cluster" size={8} />
                              <span className="text-xs text-manor-ink truncate flex-1 min-w-0">
                                {cluster.title}
                              </span>
                              {hardConflictIds.has(cluster.id) && (
                                <span title="存在真蚕食冲突" className="shrink-0 inline-flex">
                                  <AlertTriangle size={11} className="text-manor-oxbloodHi" />
                                </span>
                              )}
                              <StatusChip status={cluster.status} size="sm" />
                              <FunnelChip url={cluster.url} size="sm" />
                              {formatPagePlanningIntent(cluster.pageType)}
                              {cluster.url && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-manor-brassDim/90 bg-manor-void/40 border border-manor-line2/60 truncate max-w-[170px] shrink-0"
                                  title={cluster.url}
                                >
                                  {cluster.status === "gap" && <span className="text-manor-brassHi/70">✚</span>}
                                  {cluster.url}
                                </span>
                              )}
                            </div>
                            {clusterKws.length > 0 && (
                              <div className="flex flex-wrap gap-1 py-1 ml-5">
                                {dedupeKeywords(clusterKws).map((g) => (
                                  <span
                                    key={g.key}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-manor-bg4 border border-manor-line2 text-manor-ink/90 hover:border-manor-brass/45 hover:text-manor-ink transition-colors group"
                                  >
                                    {g.keyword}
                                    {g.count > 1 && (
                                      <span className="text-[9px] text-manor-inkFaint" title={`${g.count} 个市场变体`}>×{g.count}</span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onUnassign(g.ids); }}
                                      className="opacity-0 group-hover:opacity-100 text-manor-oxbloodHi transition-opacity"
                                      title={g.count > 1 ? `移出（含 ${g.count} 个市场变体）` : "移出"}
                                    >
                                      <X size={10} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* New cluster button */}
                      {newClusterFor === pillar.id ? (
                        <div className="flex items-center gap-1.5 py-1">
                          <input
                            type="text"
                            autoFocus
                            value={newClusterTitle}
                            onChange={(e) => setNewClusterTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && newClusterTitle.trim()) {
                                onNewCluster(newClusterTitle.trim(), pillar.id);
                                setNewClusterTitle("");
                                setNewClusterFor(null);
                              }
                              if (e.key === "Escape") setNewClusterFor(null);
                            }}
                            placeholder="集群标题..."
                            className="h-6 px-2 text-[11px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => setNewClusterFor(null)}
                            className="text-manor-inkFaint hover:text-manor-ink"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNewClusterFor(pillar.id)}
                          className="flex items-center gap-1 py-1 text-[10px] text-manor-inkFaint hover:text-manor-brassHi transition-colors"
                        >
                          <Plus size={10} /> 新建集群
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* New pillar */}
      <div className="pt-2">
        {showNewPillar ? (
          <div className="flex items-center gap-2">
            <select
              value={newPillarTerritory}
              onChange={(e) => setNewPillarTerritory(e.target.value as Territory)}
              className="h-7 px-1.5 text-[11px] bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink"
            >
              {territories.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="text"
              autoFocus
              value={newPillarTitle}
              onChange={(e) => setNewPillarTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPillarTitle.trim()) {
                  onNewPillar(newPillarTitle.trim(), newPillarTerritory);
                  setNewPillarTitle("");
                  setShowNewPillar(false);
                }
                if (e.key === "Escape") setShowNewPillar(false);
              }}
              placeholder="支柱标题..."
              className="h-7 px-2 text-[11px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1"
            />
            <button type="button" onClick={() => setShowNewPillar(false)} className="text-manor-inkFaint hover:text-manor-ink">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewPillar(true)}
            className="flex items-center gap-1.5 text-[11px] text-manor-inkDim hover:text-manor-brassHi transition-colors border border-dashed border-manor-line2 rounded px-3 py-1.5 hover:border-manor-brass/40"
          >
            <Plus size={12} /> 新建支柱
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Table View ───────────────────────────────────────────────────────────────
function TableView({
  pages,
  bindings,
  allKeywords,
  selectedPageId,
  onPageSelect,
}: Pick<MapCanvasProps, "pages" | "bindings" | "allKeywords" | "selectedPageId" | "onPageSelect">) {
  // Build rows: each bound keyword + its assigned page
  const rows = React.useMemo(() => {
    const result: { kw: RawKeyword; page: WbPage }[] = [];
    for (const [kwId, pageId] of Object.entries(bindings)) {
      const kw = allKeywords.find((k) => k.id === kwId);
      const page = pages.find((p) => p.id === pageId);
      if (kw && page) result.push({ kw, page });
    }
    result.sort((a, b) => (b.kw.sv ?? 0) - (a.kw.sv ?? 0));
    return result;
  }, [bindings, allKeywords, pages]);

  const sc = "var(--font-sc), 'Cormorant SC', serif";

  // 客户端分页：默认每页 10 条 —— 不一次渲染全部，下方分页翻动
  const [pageSize, setPageSize] = React.useState(10);
  const [pageIdx, setPageIdx] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  React.useEffect(() => {
    if (pageIdx > pageCount - 1) setPageIdx(0);
  }, [pageCount, pageIdx]);
  const start = pageIdx * pageSize;
  const visible = rows.slice(start, start + pageSize);

  const thCls = "px-2 py-2 text-[10px] text-manor-inkDim font-normal whitespace-nowrap overflow-hidden text-ellipsis";
  const navBtn = (disabled: boolean) =>
    [
      "h-6 min-w-[24px] px-1 flex items-center justify-center rounded border text-[12px] leading-none transition-colors",
      disabled
        ? "border-manor-brass/15 text-manor-inkGhost cursor-not-allowed"
        : "border-manor-brass/40 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brassHi",
    ].join(" ");

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 表区：列宽固定自适应、仅纵向滚动、绝不横向溢出 */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ scrollbarGutter: "stable" }}>
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col style={{ width: "19%" }} />{/* 关键词 */}
            <col style={{ width: "6%" }} />{/* 市场 */}
            <col style={{ width: "8%" }} />{/* SV */}
            <col style={{ width: "5%" }} />{/* KD */}
            <col style={{ width: "11%" }} />{/* 意图 */}
            <col style={{ width: "18%" }} />{/* 归属支柱 */}
            <col style={{ width: "20%" }} />{/* 归属页面 */}
            <col style={{ width: "13%" }} />{/* 状态 */}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-manor-bg2">
            <tr className="border-b border-manor-line text-left">
              <th className={thCls} style={{ fontFamily: sc, letterSpacing: "0.12em" }}>关键词</th>
              <th className={thCls + " text-center"} style={{ fontFamily: sc }}>市场</th>
              <th className={thCls + " text-right"} style={{ fontFamily: sc }}>SV</th>
              <th className={thCls + " text-right"} style={{ fontFamily: sc }}>KD</th>
              <th className={thCls} style={{ fontFamily: sc }}>意图</th>
              <th className={thCls} style={{ fontFamily: sc }}>归属支柱</th>
              <th className={thCls} style={{ fontFamily: sc }}>归属页面</th>
              <th className={thCls} style={{ fontFamily: sc }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ kw, page }) => {
              const pillar = page.role === "pillar" ? page : pages.find((p) => p.id === page.pillarId);
              return (
                <tr
                  key={kw.id}
                  onClick={() => onPageSelect(page.id)}
                  className={[
                    "border-b border-manor-line/30 cursor-pointer transition-colors",
                    selectedPageId === page.id ? "bg-manor-bg3" : "hover:bg-manor-bg3/50",
                  ].join(" ")}
                >
                  <td className="px-2.5 py-2 align-top text-manor-ink break-words">{kw.keyword}</td>
                  <td className="px-2 py-2 align-top text-center whitespace-nowrap">{marketFlag(kw.market)}</td>
                  <td className="px-2 py-2 align-top text-right tabular-nums text-manor-inkDim whitespace-nowrap">{formatSv(kw.sv)}</td>
                  <td className="px-2 py-2 align-top text-right tabular-nums text-manor-inkFaint whitespace-nowrap">{kw.kd ?? "—"}</td>
                  <td className="px-2 py-2 align-top whitespace-nowrap">{formatBehaviorIntent(kw.behaviorIntent)}</td>
                  <td className="px-2.5 py-2 align-top text-manor-inkDim break-words">{pillar?.title ?? "—"}</td>
                  <td className="px-2.5 py-2 align-top text-manor-inkDim">
                    <span className="flex items-start gap-1.5">
                      <span className="mt-1 shrink-0"><RoleMark role={page.role} size={6} /></span>
                      <span className="break-words min-w-0">{page.title}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top whitespace-nowrap"><StatusChip status={page.status} size="sm" /></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-manor-inkFaint">
                  尚无已绑定的关键词
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页条 */}
      {rows.length > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-manor-line/60 bg-manor-bg2 text-[11px] text-manor-inkDim">
          <span className="tracking-[0.22em] text-manor-brassHi/55" style={{ fontFamily: sc, fontSize: 9 }}>
            PAGINATIO
          </span>
          <span className="tabular-nums">共 {rows.length} 条</span>
          <span className="flex-1" />
          <span className="tabular-nums whitespace-nowrap">第 {pageIdx + 1} / {pageCount} 页</span>
          <div className="flex items-center gap-1">
            <button type="button" className={navBtn(pageIdx === 0)} disabled={pageIdx === 0} onClick={() => setPageIdx(0)} aria-label="首页">«</button>
            <button type="button" className={navBtn(pageIdx === 0)} disabled={pageIdx === 0} onClick={() => setPageIdx((p) => Math.max(0, p - 1))} aria-label="上一页">‹</button>
            <button type="button" className={navBtn(pageIdx >= pageCount - 1)} disabled={pageIdx >= pageCount - 1} onClick={() => setPageIdx((p) => Math.min(pageCount - 1, p + 1))} aria-label="下一页">›</button>
            <button type="button" className={navBtn(pageIdx >= pageCount - 1)} disabled={pageIdx >= pageCount - 1} onClick={() => setPageIdx(pageCount - 1)} aria-label="末页">»</button>
          </div>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPageIdx(0); }}
            className="h-6 px-1 bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink text-[11px] focus:outline-none"
            aria-label="每页条数"
          >
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n}/页</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function MapCanvas(props: MapCanvasProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  return (
    <>
      {/* Header */}
      <div className="px-4 py-2 border-b border-manor-line/50 shrink-0 flex items-center gap-2">
        <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/60" style={{ fontFamily: sc }}>
          PLEXUS · 主题地图
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-manor-inkFaint tabular-nums">
          {props.pages.filter((p) => p.role === "pillar").length} 支柱 · {props.pages.filter((p) => p.role === "cluster").length} 集群
        </span>
      </div>

      {props.view === "radial" ? (
        <RadialView
          pages={props.pages}
          boundByPage={props.boundByPage}
          highlightPageId={props.highlightPageId}
          selectedPageId={props.selectedPageId}
          onPageSelect={props.onPageSelect}
          conflicts={props.conflicts}
        />
      ) : props.view === "tree" ? (
        <TreeView
          pages={props.pages}
          boundByPage={props.boundByPage}
          highlightPageId={props.highlightPageId}
          selectedPageId={props.selectedPageId}
          onPageSelect={props.onPageSelect}
          onUnassign={props.onUnassign}
          onNewPillar={props.onNewPillar}
          onNewCluster={props.onNewCluster}
          territories={props.territories}
          conflicts={props.conflicts}
        />
      ) : (
        <TableView
          pages={props.pages}
          bindings={props.bindings}
          allKeywords={props.allKeywords}
          selectedPageId={props.selectedPageId}
          onPageSelect={props.onPageSelect}
        />
      )}
    </>
  );
}
