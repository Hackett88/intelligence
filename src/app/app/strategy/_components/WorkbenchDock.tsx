"use client";

import * as React from "react";
import { Package, AlertTriangle, Undo2, Redo2, Check, X, ChevronUp } from "lucide-react";
import type { RawKeyword, WbPage, CannibalConflict } from "./_workbench";
import { marketFlag, formatSv } from "./_utils";

interface WorkbenchDockProps {
  parkedCount: number;
  parkedKeywords: RawKeyword[];
  conflictCount: number;
  conflicts: CannibalConflict[];
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

      {/* Conflicts panel */}
      {showConflicts && (
        <div className="absolute bottom-full right-0 w-80 max-h-60 overflow-y-auto bg-manor-bg2 border border-manor-line rounded-t-lg shadow-lg z-20">
          <div className="px-3 py-2 border-b border-manor-line flex items-center justify-between">
            <span className="text-[10px] tracking-[0.15em] text-manor-oxbloodHi/80" style={{ fontFamily: sc }}>
              蚕食冲突
            </span>
            <button type="button" onClick={() => setShowConflicts(false)} className="text-manor-inkFaint hover:text-manor-ink">
              <X size={12} />
            </button>
          </div>
          {conflicts.length === 0 ? (
            <div className="px-3 py-4 text-xs text-manor-inkFaint text-center">无冲突</div>
          ) : (
            conflicts.map((c, i) => {
              const a = pages.find((p) => p.id === c.aId);
              const b = pages.find((p) => p.id === c.bId);
              return (
                <div key={i} className="px-3 py-2 border-b border-manor-line/30 text-[11px] text-manor-inkDim">
                  <span className="text-manor-oxbloodHi">{a?.title ?? c.aId}</span>
                  <span className="text-manor-inkFaint mx-1">vs</span>
                  <span className="text-manor-oxbloodHi">{b?.title ?? c.bId}</span>
                  <span className="text-manor-inkFaint ml-1">({c.overlap}% 重合)</span>
                </div>
              );
            })
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
          className={[
            "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
            conflictCount > 0
              ? "text-manor-oxbloodHi hover:bg-manor-oxbloodDim/10"
              : "text-manor-inkFaint",
          ].join(" ")}
        >
          <AlertTriangle size={13} />
          冲突
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
