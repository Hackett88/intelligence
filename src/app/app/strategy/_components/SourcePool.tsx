"use client";

import * as React from "react";
import { Search, CheckSquare, ArrowDownToLine, Package, X } from "lucide-react";
import type { RawKeyword } from "./_workbench";
import {
  formatSv,
  formatPagePlanningIntent,
  formatBehaviorIntent,
  formatLayerLevel,
  marketFlag,
} from "./_utils";
import type { Market, LayerLevel, PagePlanningIntent, BehaviorIntent } from "./_workbench";

// ── Filter options ───────────────────────────────────────────────────────────
const MARKET_OPTS: { v: string; l: string }[] = [
  { v: "us", l: "US" }, { v: "uk", l: "UK" }, { v: "sa", l: "SA" },
  { v: "id", l: "ID" }, { v: "my", l: "MY" }, { v: "ae", l: "AE" },
  { v: "de", l: "DE" }, { v: "tr", l: "TR" }, { v: "fr", l: "FR" }, { v: "au", l: "AU" },
];

const INTENT_OPTS: { v: BehaviorIntent; l: string }[] = [
  { v: "了解型", l: "了解" }, { v: "行动型", l: "行动" }, { v: "混合型", l: "混合" },
  { v: "对比型", l: "对比" }, { v: "官网导航", l: "导航" }, { v: "线下到访", l: "线下" },
];

const PAGE_TYPE_OPTS: { v: PagePlanningIntent; l: string }[] = [
  { v: "知识深度页", l: "知识" }, { v: "品类聚合页", l: "品类" },
  { v: "工具生态页", l: "工具" }, { v: "场景使用页", l: "场景" },
  { v: "品牌主页", l: "品牌" }, { v: "产品详情页", l: "产品" },
];

const LAYER_OPTS: { v: LayerLevel; l: string }[] = [
  { v: "一级核心", l: "一级" }, { v: "二级独立", l: "二级" },
  { v: "三级变体", l: "三级" }, { v: "四级兜底", l: "四级" },
];

// ── Component ────────────────────────────────────────────────────────────────
interface SourcePoolProps {
  keywords: RawKeyword[];
  selection: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onAssignClick: () => void;
  onParkClick: () => void;
  onKeywordOpen: (id: string) => void;
}

type PoolFilters = {
  search: string;
  markets: string[];
  intents: BehaviorIntent[];
  pageTypes: PagePlanningIntent[];
  layers: LayerLevel[];
  svMin: number;
  kdMax: number;
};

const DEFAULT_FILTERS: PoolFilters = {
  search: "",
  markets: [],
  intents: [],
  pageTypes: [],
  layers: [],
  svMin: 0,
  kdMax: 100,
};

// Simple chip filter button
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-1.5 py-0.5 rounded text-[10px] border transition-colors whitespace-nowrap",
        active
          ? "bg-manor-brassDim/20 text-manor-brassHi border-manor-brass/50"
          : "bg-transparent text-manor-inkDim border-manor-line hover:border-manor-brass/30 hover:text-manor-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// Virtualized-ish: render only visible items (PAGE_SIZE at a time)
const PAGE_SIZE = 60;

export function SourcePool({
  keywords,
  selection,
  onSelectionChange,
  onAssignClick,
  onParkClick,
  onKeywordOpen,
}: SourcePoolProps) {
  const [filters, setFilters] = React.useState<PoolFilters>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = React.useState(false);
  const [renderLimit, setRenderLimit] = React.useState(PAGE_SIZE);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  // filter
  const filtered = React.useMemo(() => {
    return keywords.filter((k) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!k.keyword.toLowerCase().includes(q)) return false;
      }
      if (filters.markets.length > 0 && !filters.markets.includes(k.market ?? "")) return false;
      if (filters.intents.length > 0 && !filters.intents.includes(k.behaviorIntent!)) return false;
      if (filters.pageTypes.length > 0 && !filters.pageTypes.includes(k.pagePlanningIntent)) return false;
      if (filters.layers.length > 0 && !filters.layers.includes(k.layer)) return false;
      if (filters.svMin > 0 && (k.sv ?? 0) < filters.svMin) return false;
      if (filters.kdMax < 100 && (k.kd ?? 0) > filters.kdMax) return false;
      return true;
    });
  }, [keywords, filters]);

  // reset render limit on filter change
  React.useEffect(() => {
    setRenderLimit(PAGE_SIZE);
  }, [filters]);

  const rendered = filtered.slice(0, renderLimit);

  // Infinite scroll
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      setRenderLimit((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
    }
  }, [filtered.length]);

  // Multi-select helpers
  const lastClickedRef = React.useRef<number>(-1);

  // Checkbox-only toggle: add/remove one id in the selection set
  const toggleCheckbox = React.useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selection, onSelectionChange]
  );

  const toggleSelect = React.useCallback(
    (id: string, idx: number, e: React.MouseEvent) => {
      const next = new Set(selection);
      if (e.shiftKey && lastClickedRef.current >= 0) {
        const start = Math.min(lastClickedRef.current, idx);
        const end = Math.max(lastClickedRef.current, idx);
        for (let i = start; i <= end; i++) {
          next.add(filtered[i].id);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        // single click (no modifier) -> open keyword modal
        onKeywordOpen(id);
        return;
      }
      lastClickedRef.current = idx;
      onSelectionChange(next);
    },
    [selection, onSelectionChange, filtered, onKeywordOpen]
  );

  const selectAll = () => {
    onSelectionChange(new Set(filtered.map((k) => k.id)));
  };

  const clearSelection = () => {
    onSelectionChange(new Set());
  };

  const toggleFilter = <K extends keyof PoolFilters>(key: K, val: string) => {
    setFilters((prev) => {
      const arr = prev[key] as string[];
      const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
      return { ...prev, [key]: next };
    });
  };

  const hasActiveFilters =
    filters.markets.length > 0 ||
    filters.intents.length > 0 ||
    filters.pageTypes.length > 0 ||
    filters.layers.length > 0 ||
    filters.svMin > 0 ||
    filters.kdMax < 100;

  return (
    <>
      {/* Header */}
      <div className="px-3 py-2 border-b border-manor-line shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/80" style={{ fontFamily: sc }}>
            INTROITUS · 进料
          </span>
          <span className="text-[10px] text-manor-inkDim tabular-nums">
            {filtered.length} 词
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1 rounded-full overflow-hidden bg-manor-void mb-2" style={{ border: "1px solid rgba(201,169,97,.15)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${keywords.length > 0 ? Math.round(((keywords.length - filtered.length) / Math.max(keywords.length, 1)) * 100) : 0}%`,
              background: "linear-gradient(90deg, #A08850, #EFD89A)",
              boxShadow: "0 0 6px rgba(224,197,122,.5)",
            }}
          />
        </div>

        {/* Search */}
        <div className="relative mb-1.5">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-manor-inkFaint" />
          <input
            type="text"
            placeholder="搜索关键词..."
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            className="w-full h-7 pl-7 pr-2 text-xs bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60"
          />
        </div>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="text-[10px] text-manor-inkDim hover:text-manor-brassHi transition-colors flex items-center gap-1"
        >
          {showFilters ? "收起筛选" : "展开筛选"}
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-manor-brassHi inline-block" />
          )}
        </button>

        {/* Filters */}
        {showFilters && (
          <div className="mt-1.5 space-y-1.5">
            {/* Markets */}
            <div className="flex flex-wrap gap-1">
              {MARKET_OPTS.map((m) => (
                <FilterChip
                  key={m.v}
                  label={`${marketFlag(m.v)} ${m.l}`}
                  active={filters.markets.includes(m.v)}
                  onClick={() => toggleFilter("markets", m.v)}
                />
              ))}
            </div>
            {/* Intents */}
            <div className="flex flex-wrap gap-1">
              {INTENT_OPTS.map((o) => (
                <FilterChip
                  key={o.v}
                  label={o.l}
                  active={filters.intents.includes(o.v)}
                  onClick={() => toggleFilter("intents", o.v)}
                />
              ))}
            </div>
            {/* Page types */}
            <div className="flex flex-wrap gap-1">
              {PAGE_TYPE_OPTS.map((o) => (
                <FilterChip
                  key={o.v}
                  label={o.l}
                  active={filters.pageTypes.includes(o.v)}
                  onClick={() => toggleFilter("pageTypes", o.v)}
                />
              ))}
            </div>
            {/* Layers */}
            <div className="flex flex-wrap gap-1">
              {LAYER_OPTS.map((o) => (
                <FilterChip
                  key={o.v}
                  label={o.l}
                  active={filters.layers.includes(o.v)}
                  onClick={() => toggleFilter("layers", o.v)}
                />
              ))}
            </div>
            {/* SV / KD range */}
            <div className="flex items-center gap-2 text-[10px] text-manor-inkDim">
              <label>SV&ge;</label>
              <input
                type="number"
                value={filters.svMin || ""}
                onChange={(e) => setFilters((p) => ({ ...p, svMin: Number(e.target.value) || 0 }))}
                placeholder="0"
                className="w-14 h-5 px-1 text-[10px] bg-manor-void/60 border border-manor-brass/20 rounded text-manor-ink"
              />
              <label>KD&le;</label>
              <input
                type="number"
                value={filters.kdMax < 100 ? filters.kdMax : ""}
                onChange={(e) => setFilters((p) => ({ ...p, kdMax: Number(e.target.value) || 100 }))}
                placeholder="100"
                className="w-14 h-5 px-1 text-[10px] bg-manor-void/60 border border-manor-brass/20 rounded text-manor-ink"
              />
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, search: filters.search })}
                className="text-[10px] text-manor-oxbloodHi hover:text-manor-ink flex items-center gap-0.5"
              >
                <X size={10} /> 清空筛选
              </button>
            )}
          </div>
        )}
      </div>

      {/* Keyword list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        {rendered.map((kw, idx) => {
          const checked = selection.has(kw.id);
          return (
            <div
              key={kw.id}
              onClick={(e) => toggleSelect(kw.id, idx, e)}
              className={[
                "flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-manor-line/50 transition-colors text-xs",
                checked
                  ? "bg-manor-brassDim/12"
                  : "hover:bg-manor-bg3/60",
              ].join(" ")}
            >
              {/* Checkbox -- clicks independently from row */}
              <span
                onClick={(e) => toggleCheckbox(kw.id, e)}
                className={[
                  "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer",
                  checked
                    ? "bg-manor-brassDim/40 border-manor-brass/70"
                    : "border-manor-line2 bg-manor-void/40 hover:border-manor-brass/50",
                ].join(" ")}
              >
                {checked && (
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" className="text-manor-brassHi" />
                  </svg>
                )}
              </span>

              {/* Market flag */}
              <span className="text-[11px] shrink-0 w-4 text-center">{marketFlag(kw.market)}</span>

              {/* Keyword text */}
              <span className="flex-1 min-w-0 truncate text-manor-ink" title={kw.keyword}>
                {kw.keyword}
              </span>

              {/* SV */}
              <span className="text-[10px] text-manor-inkDim tabular-nums shrink-0 w-10 text-right">
                {formatSv(kw.sv)}
              </span>

              {/* KD */}
              <span className="text-[10px] text-manor-inkFaint tabular-nums shrink-0 w-6 text-right">
                {kw.kd ?? "—"}
              </span>

              {/* Intent chip */}
              <span className="shrink-0">
                {formatBehaviorIntent(kw.behaviorIntent)}
              </span>
            </div>
          );
        })}

        {renderLimit < filtered.length && (
          <div className="py-2 text-center text-[10px] text-manor-inkFaint">
            滚动加载更多... ({filtered.length - renderLimit} 剩余)
          </div>
        )}

        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-manor-inkFaint">
            源池已空 — 所有词已归位或被筛选排除
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-3 py-2 border-t border-manor-line shrink-0 flex items-center gap-2">
        {selection.size > 0 ? (
          <>
            <span className="text-[10px] text-manor-inkDim">
              已选 <span className="text-manor-brassHi">{selection.size}</span> 词
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[10px] text-manor-inkFaint hover:text-manor-ink"
            >
              取消
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onParkClick}
              className="h-7 px-2.5 text-[11px] rounded border border-manor-line2 text-manor-inkDim hover:text-manor-ink hover:border-manor-brass/40 transition-colors flex items-center gap-1.5"
            >
              <Package size={12} /> 暂存
            </button>
            <button
              type="button"
              onClick={onAssignClick}
              className="h-7 px-3 text-[11px] rounded border border-manor-brass/50 text-manor-brassHi hover:bg-manor-brassDim/15 transition-colors flex items-center gap-1.5 font-medium"
              style={{
                background: "linear-gradient(180deg, rgba(160,136,80,.12) 0%, rgba(160,136,80,.04) 100%)",
              }}
            >
              <ArrowDownToLine size={12} /> 指派到...
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={selectAll}
              className="text-[10px] text-manor-inkDim hover:text-manor-brassHi transition-colors flex items-center gap-1"
            >
              <CheckSquare size={10} /> 全选筛选结果
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-manor-inkFaint">
              Ctrl+点=加选 · Shift+点=范围选
            </span>
          </>
        )}
      </div>
    </>
  );
}
