"use client";

import * as React from "react";
import { Package, AlertTriangle, Undo2, Redo2, Check, X, ChevronUp } from "lucide-react";
import type { RawKeyword, WbPage, PageRelation } from "./_workbench";
import { isHardCannibalization } from "./_workbench";
import { marketFlag, formatSv, RELATION_META } from "./_utils";

interface WorkbenchDockProps {
  parkedCount: number;
  parkedKeywords: RawKeyword[];
  conflictCount: number;
  conflicts: PageRelation[];
  pages: WbPage[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUnpark: (kwIds: string[]) => void;
}

export function WorkbenchDock({
  parkedCount,
  parkedKeywords,
  conflictCount,
  conflicts,
  pages,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUnpark,
}: WorkbenchDockProps) {
  const [showParked, setShowParked] = React.useState(false);
  const [showConflicts, setShowConflicts] = React.useState(false);
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  return (
    <div className="relative">
      {/* Parked panel */}
      {showParked && (
        <div className="absolute bottom-full left-0 w-80 max-h-60 overflow-y-auto bg-manor-bg2 border border-manor-line rounded-t-lg shadow-lg z-20">
          <div className="px-3 py-2 border-b border-manor-line flex items-center justify-between">
            <span className="text-[10px] tracking-[0.15em] text-manor-brassHi/70" style={{ fontFamily: sc }}>
              暂存篮
            </span>
            <button type="button" onClick={() => setShowParked(false)} className="text-manor-inkFaint hover:text-manor-ink">
              <X size={12} />
            </button>
          </div>
          {parkedKeywords.length === 0 ? (
            <div className="px-3 py-4 text-xs text-manor-inkFaint text-center">暂存篮为空</div>
          ) : (
            parkedKeywords.map((kw) => (
              <div key={kw.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-manor-line/30 text-xs">
                <span className="w-4 text-center text-[11px]">{marketFlag(kw.market)}</span>
                <span className="flex-1 truncate text-manor-ink">{kw.keyword}</span>
                <span className="text-[10px] tabular-nums text-manor-inkDim">{formatSv(kw.sv)}</span>
                <button
                  type="button"
                  onClick={() => onUnpark([kw.id])}
                  className="text-[10px] text-manor-sageHi hover:text-manor-ink px-1.5 py-0.5 border border-manor-sageDim/40 rounded hover:bg-manor-sageDim/10 transition-colors"
                >
                  回收
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Page-relation panel —— 真蚕食优先；协作/待核/跨主题在概览里"双显"，
          避免红点从旧口径骤降时被误读为"告警消失"。 */}
      {showConflicts && (
        <div className="absolute bottom-full right-0 w-96 max-h-72 overflow-y-auto bg-manor-bg2 border border-manor-line rounded-t-lg shadow-lg z-20">
          <div className="px-3 py-2 border-b border-manor-line flex items-center justify-between sticky top-0 bg-manor-bg2 z-10">
            <span className="text-[10px] tracking-[0.15em] text-manor-brassHi/80" style={{ fontFamily: sc }}>
              页面关系检查
            </span>
            <button type="button" onClick={() => setShowConflicts(false)} className="text-manor-inkFaint hover:text-manor-ink">
              <X size={12} />
            </button>
          </div>
          {conflicts.length === 0 ? (
            <div className="px-3 py-4 text-xs text-manor-inkFaint text-center">未检出相关页面对</div>
          ) : (
            <>
              {/* 概览：四色计数（双显，缓解红点骤降的认知落差） */}
              <div className="px-3 py-1.5 border-b border-manor-line/40 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                {(["true_cannibalization", "intent_overlap", "funnel_division", "cross_theme_low"] as const).map((rt) => {
                  const n = conflicts.filter((c) => c.relationType === rt).length;
                  if (!n) return null;
                  return (
                    <span key={rt} className={RELATION_META[rt].text}>
                      {RELATION_META[rt].label} <span className="tabular-nums font-medium">{n}</span>
                    </span>
                  );
                })}
              </div>
              {/* 列表：真蚕食排前 */}
              {[...conflicts]
                .sort((a, b) => (isHardCannibalization(b) ? 1 : 0) - (isHardCannibalization(a) ? 1 : 0))
                .map((c, i) => {
                  const a = pages.find((p) => p.id === c.aId);
                  const b = pages.find((p) => p.id === c.bId);
                  const m = RELATION_META[c.relationType];
                  return (
                    <div key={i} className="px-3 py-2 border-b border-manor-line/30 text-[11px]">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`inline-flex items-center px-1 py-0 rounded border text-[10px] ${m.chip}`}>
                          {m.label}
                        </span>
                        <span className="text-manor-inkFaint tabular-nums">{c.overlap}% 重合</span>
                      </div>
                      <div className="text-manor-inkDim">
                        <span className="text-manor-ink/85">{a?.title ?? c.aId}</span>
                        <span className="text-manor-inkFaint mx-1">×</span>
                        <span className="text-manor-ink/85">{b?.title ?? c.bId}</span>
                      </div>
                      <div className="text-[10px] text-manor-inkFaint mt-0.5 leading-snug">{c.advice}</div>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}

      {/* Dock bar */}
      <div className="px-4 py-1.5 border-t border-manor-brass/20 bg-manor-bg2 flex items-center gap-4 shrink-0 text-[11px]">
        {/* Basket */}
        <button
          type="button"
          onClick={() => { setShowParked(!showParked); setShowConflicts(false); }}
          className={[
            "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
            parkedCount > 0
              ? "text-manor-brassHi hover:bg-manor-brassDim/10"
              : "text-manor-inkFaint",
          ].join(" ")}
        >
          <Package size={13} />
          暂存篮
          <span className="tabular-nums">[{parkedCount}]</span>
        </button>

        {/* Conflicts */}
        <button
          type="button"
          onClick={() => { setShowConflicts(!showConflicts); setShowParked(false); }}
          title={`真蚕食 ${conflictCount} 处 · 点开查看全部页面关系（真蚕食 / 待核 / 漏斗协作 / 跨主题）`}
          className={[
            "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
            conflictCount > 0
              ? "text-manor-oxbloodHi hover:bg-manor-oxbloodDim/10"
              : "text-manor-inkFaint",
          ].join(" ")}
        >
          <AlertTriangle size={13} />
          蚕食
          <span className="tabular-nums">[{conflictCount}]</span>
        </button>

        <div className="flex-1" />

        {/* Undo / Redo */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={[
            "flex items-center gap-1 px-2 py-1 rounded transition-colors",
            canUndo ? "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10" : "text-manor-inkGhost cursor-not-allowed",
          ].join(" ")}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={13} />
          撤销
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={[
            "flex items-center gap-1 px-2 py-1 rounded transition-colors",
            canRedo ? "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10" : "text-manor-inkGhost cursor-not-allowed",
          ].join(" ")}
          title="重做 (Ctrl+Y)"
        >
          <Redo2 size={13} />
          重做
        </button>

        {/* Auto-save indicator */}
        <span className="flex items-center gap-1 text-[10px] text-manor-inkFaint">
          <Check size={10} className="text-manor-sageHi" />
          会话已保存
        </span>
      </div>
    </div>
  );
}
