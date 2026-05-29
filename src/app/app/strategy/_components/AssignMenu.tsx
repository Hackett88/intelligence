"use client";

import * as React from "react";
import { Search, Plus, X, ArrowRight } from "lucide-react";
import type { WbPage, RawKeyword, Territory } from "./_workbench";
import { RoleMark, StatusChip, formatPagePlanningIntent } from "./_utils";

interface AssignMenuProps {
  pages: WbPage[];
  selectedKwIds: string[];
  keywords: RawKeyword[];
  territories: Territory[];
  onAssign: (pageId: string) => void;
  onCreateAndAssign: (role: "pillar" | "cluster", pillarId: string | null, title: string, territory: Territory) => void;
  onClose: () => void;
}

export function AssignMenu({
  pages,
  selectedKwIds,
  keywords,
  territories,
  onAssign,
  onCreateAndAssign,
  onClose,
}: AssignMenuProps) {
  const [search, setSearch] = React.useState("");
  const [mode, setMode] = React.useState<"select" | "new-pillar" | "new-cluster">("select");
  const [newTitle, setNewTitle] = React.useState("");
  const [newTerritory, setNewTerritory] = React.useState<Territory>("知识");
  const [newPillarId, setNewPillarId] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  React.useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = React.useMemo(() => {
    if (!search) return pages;
    const q = search.toLowerCase();
    return pages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.primaryKeyword.toLowerCase().includes(q) ||
        (p.url ?? "").toLowerCase().includes(q)
    );
  }, [pages, search]);

  // Group by pillar
  const pillars = filtered.filter((p) => p.role === "pillar");

  const selectedKws = keywords.filter((k) => selectedKwIds.includes(k.id));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-h-[70vh] bg-manor-bg2 border border-manor-line rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-manor-line shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/70" style={{ fontFamily: sc }}>
              指派到...
            </span>
            <button type="button" onClick={onClose} className="text-manor-inkFaint hover:text-manor-ink">
              <X size={14} />
            </button>
          </div>

          <div className="text-xs text-manor-inkDim mb-2">
            将 <span className="text-manor-brassHi">{selectedKwIds.length}</span> 个关键词指派到目标页面：
          </div>

          {/* Selected keywords preview */}
          <div className="flex flex-wrap gap-1 max-h-14 overflow-y-auto">
            {selectedKws.slice(0, 8).map((kw) => (
              <span key={kw.id} className="px-1.5 py-0.5 rounded text-[10px] bg-manor-bg3 border border-manor-line text-manor-inkDim">
                {kw.keyword}
              </span>
            ))}
            {selectedKws.length > 8 && (
              <span className="text-[10px] text-manor-inkFaint">+{selectedKws.length - 8} 更多</span>
            )}
          </div>
        </div>

        {mode === "select" && (
          <>
            {/* Search */}
            <div className="px-4 py-2 border-b border-manor-line/50 shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-manor-inkFaint" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索页面..."
                  className="w-full h-7 pl-7 pr-2 text-xs bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60"
                />
              </div>
            </div>

            {/* Page list */}
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
              {pillars.map((pillar) => {
                const clusters = filtered.filter((p) => p.pillarId === pillar.id);
                return (
                  <div key={pillar.id}>
                    {/* Pillar */}
                    <button
                      type="button"
                      onClick={() => onAssign(pillar.id)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-manor-bg3 transition-colors border-b border-manor-line/30"
                    >
                      <RoleMark role="pillar" size={8} />
                      <span className="text-xs text-manor-ink truncate flex-1">{pillar.title}</span>
                      <StatusChip status={pillar.status} size="sm" />
                      <ArrowRight size={12} className="text-manor-inkFaint" />
                    </button>
                    {/* Clusters under this pillar */}
                    {clusters.map((cluster) => (
                      <button
                        key={cluster.id}
                        type="button"
                        onClick={() => onAssign(cluster.id)}
                        className="w-full flex items-center gap-2 px-4 pl-8 py-1.5 text-left hover:bg-manor-bg3 transition-colors border-b border-manor-line/20"
                      >
                        <RoleMark role="cluster" size={7} />
                        <span className="text-xs text-manor-inkDim truncate flex-1">{cluster.title}</span>
                        <StatusChip status={cluster.status} size="sm" />
                        <ArrowRight size={10} className="text-manor-inkFaint" />
                      </button>
                    ))}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-6 text-center text-xs text-manor-inkFaint">无匹配页面</div>
              )}
            </div>

            {/* New buttons */}
            <div className="px-4 py-2 border-t border-manor-line shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("new-pillar")}
                className="h-7 px-2.5 text-[11px] rounded border border-dashed border-manor-line2 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brass/40 transition-colors flex items-center gap-1"
              >
                <Plus size={11} /> 新建为支柱
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("new-cluster");
                  if (pillars.length > 0) setNewPillarId(pillars[0].id);
                }}
                className="h-7 px-2.5 text-[11px] rounded border border-dashed border-manor-line2 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brass/40 transition-colors flex items-center gap-1"
              >
                <Plus size={11} /> 新建为集群
              </button>
            </div>
          </>
        )}

        {mode === "new-pillar" && (
          <div className="px-4 py-4 space-y-3">
            <div className="text-xs text-manor-inkDim mb-2">新建支柱页并将选中词指派过去：</div>
            <div className="flex items-center gap-2">
              <select
                value={newTerritory}
                onChange={(e) => setNewTerritory(e.target.value as Territory)}
                className="h-7 px-1.5 text-[11px] bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink"
              >
                {territories.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim()) {
                    onCreateAndAssign("pillar", null, newTitle.trim(), newTerritory);
                  }
                }}
                placeholder="支柱标题..."
                className="flex-1 h-7 px-2 text-xs bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode("select")} className="h-7 px-3 text-[11px] text-manor-inkDim hover:text-manor-ink">
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newTitle.trim()) {
                    onCreateAndAssign("pillar", null, newTitle.trim(), newTerritory);
                  }
                }}
                className="h-7 px-3 text-[11px] rounded border border-manor-brass/50 text-manor-brassHi hover:bg-manor-brassDim/15"
              >
                创建
              </button>
            </div>
          </div>
        )}

        {mode === "new-cluster" && (
          <div className="px-4 py-4 space-y-3">
            <div className="text-xs text-manor-inkDim mb-2">新建集群页并将选中词指派过去：</div>
            <select
              value={newPillarId}
              onChange={(e) => setNewPillarId(e.target.value)}
              className="w-full h-7 px-1.5 text-[11px] bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink"
            >
              {pages.filter((p) => p.role === "pillar").map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <input
              ref={inputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim() && newPillarId) {
                  const pillar = pages.find((p) => p.id === newPillarId);
                  onCreateAndAssign("cluster", newPillarId, newTitle.trim(), pillar?.territory ?? "知识");
                }
              }}
              placeholder="集群标题..."
              className="w-full h-7 px-2 text-xs bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode("select")} className="h-7 px-3 text-[11px] text-manor-inkDim hover:text-manor-ink">
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newTitle.trim() && newPillarId) {
                    const pillar = pages.find((p) => p.id === newPillarId);
                    onCreateAndAssign("cluster", newPillarId, newTitle.trim(), pillar?.territory ?? "知识");
                  }
                }}
                className="h-7 px-3 text-[11px] rounded border border-manor-brass/50 text-manor-brassHi hover:bg-manor-brassDim/15"
              >
                创建
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
