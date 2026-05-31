"use client";

import * as React from "react";
import { Package, Undo2, Redo2, Check, X } from "lucide-react";
import type { RawKeyword } from "./_workbench";
import { marketFlag, formatSv } from "./_utils";

interface WorkbenchDockProps {
  parkedCount: number;
  parkedKeywords: RawKeyword[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUnpark: (kwIds: string[]) => void;
}

export function WorkbenchDock({
  parkedCount,
  parkedKeywords,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUnpark,
}: WorkbenchDockProps) {
  const [showParked, setShowParked] = React.useState(false);
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

      {/* Dock bar */}
      <div className="px-4 py-1.5 border-t border-manor-brass/20 bg-manor-bg2 flex items-center gap-4 shrink-0 text-[11px]">
        {/* Basket */}
        <button
          type="button"
          onClick={() => setShowParked(!showParked)}
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
