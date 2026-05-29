"use client";

import * as React from "react";
import { X, Check, ArrowRight, Package, Search } from "lucide-react";
import type { WbPage, RawKeyword } from "./_workbench";
import {
  suggestPlacement,
  serpOverlapPct,
  mergeAdvice,
  intentMatches,
} from "./_workbench";
import {
  RoleMark,
  StatusChip,
  formatSv,
  formatPagePlanningIntent,
  formatBehaviorIntent,
  marketFlag,
} from "./_utils";

interface KeywordModalProps {
  kw: RawKeyword;
  pages: WbPage[];
  boundByPage: Map<string, RawKeyword[]>;
  onAssign: (kwId: string, pageId: string) => void;
  onPark: (kwId: string) => void;
  onClose: () => void;
}

export function KeywordModal({ kw, pages, boundByPage, onAssign, onPark, onClose }: KeywordModalProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";

  const suggestion = React.useMemo(() => suggestPlacement(kw, pages, boundByPage), [kw, pages, boundByPage]);
  const suggestedPage = suggestion ? pages.find((p) => p.id === suggestion.pageId) : null;

  const overlapPct = suggestion && suggestedPage
    ? serpOverlapPct(kw.keyword, suggestion.matchedKeyword)
    : 0;
  const advice = mergeAdvice(overlapPct);

  // "指派到其它" mini-picker
  const [showPicker, setShowPicker] = React.useState(false);
  const [pickerSearch, setPickerSearch] = React.useState("");
  const pickerRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (showPicker) pickerRef.current?.focus();
  }, [showPicker]);

  // ESC to close
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showPicker) setShowPicker(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, showPicker]);

  const filteredPages = React.useMemo(() => {
    if (!pickerSearch) return pages;
    const q = pickerSearch.toLowerCase();
    return pages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.primaryKeyword.toLowerCase().includes(q) ||
        (p.url ?? "").toLowerCase().includes(q)
    );
  }, [pages, pickerSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[520px] mx-4 bg-manor-bg2 border border-manor-brass/30 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        style={{ boxShadow: "0 0 40px rgba(0,0,0,.5), 0 0 12px rgba(239,216,154,.08)" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-manor-line shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span
              className="tracking-[0.22em] text-manor-brassHi/60"
              style={{ fontFamily: sc, fontSize: 9 }}
            >
              VERBUM · 词画像
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-manor-inkFaint hover:text-manor-ink transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Keyword title */}
          <h2
            className="text-lg font-semibold text-manor-ink leading-tight mb-2"
            style={{ fontFamily: serif }}
          >
            {kw.keyword}
          </h2>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <span className="inline-flex items-center gap-1">
              <span className="text-base">{marketFlag(kw.market)}</span>
              <span className="text-manor-inkDim">{kw.market?.toUpperCase() ?? "全球"}</span>
            </span>
            <span className="text-manor-inkDim">
              SV <span className="text-manor-ink tabular-nums font-medium">{formatSv(kw.sv)}</span>
            </span>
            <span className="text-manor-inkDim">
              KD <span className="text-manor-ink tabular-nums font-medium">{kw.kd ?? "—"}</span>
            </span>
            {formatBehaviorIntent(kw.behaviorIntent)}
            {formatPagePlanningIntent(kw.pagePlanningIntent)}
            <span className="text-manor-inkFaint">{kw.layer}</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-y-auto space-y-4" style={{ scrollbarGutter: "stable" }}>
          {/* Suggestion */}
          {suggestion && suggestedPage ? (
            <div>
              <span
                className="tracking-[0.15em] text-manor-brassHi/70 block mb-2"
                style={{ fontFamily: sc, fontSize: 10 }}
              >
                推荐归处
              </span>
              <div className="bg-manor-bg3/60 border border-manor-line2/60 rounded-md p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <RoleMark role={suggestedPage.role} size={8} />
                  <span className="text-sm text-manor-ink font-medium flex-1 min-w-0">
                    {suggestedPage.title}
                  </span>
                  <StatusChip status={suggestedPage.status} size="sm" />
                </div>
                <p className="text-[11px] text-manor-inkDim">
                  {suggestion.reason}
                </p>

                {/* SERP overlap */}
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-manor-inkFaint">SERP 重合度</span>
                  <span className="text-manor-ink tabular-nums font-medium">{overlapPct}%</span>
                  <span
                    className={[
                      "px-1.5 py-0.5 rounded text-[10px] border",
                      advice.verdict === "merge"
                        ? "text-manor-sageHi border-manor-sageDim/50 bg-manor-sageDim/10"
                        : advice.verdict === "consider"
                        ? "text-manor-brassHi border-manor-brassDim/50 bg-manor-brassDim/10"
                        : "text-manor-inkDim border-manor-line bg-manor-bg3",
                    ].join(" ")}
                  >
                    {advice.label}
                  </span>
                  <span className="text-manor-inkFaint italic">(示例)</span>
                </div>

                {/* Intent match */}
                <div className="text-[11px]">
                  <span className="text-manor-inkFaint">意图匹配：</span>
                  {intentMatches(kw, suggestedPage) ? (
                    <span className="text-manor-sageHi">匹配</span>
                  ) : (
                    <span className="text-manor-oxbloodHi">
                      不匹配 (词={kw.pagePlanningIntent}, 页={suggestedPage.pageType})
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <span
                className="tracking-[0.15em] text-manor-inkFaint block mb-2"
                style={{ fontFamily: sc, fontSize: 10 }}
              >
                推荐归处
              </span>
              <div className="bg-manor-bg3/40 border border-manor-line/60 rounded-md p-3">
                <p className="text-[12px] text-manor-inkDim leading-relaxed">
                  暂无明确推荐 —— 该词与现有任一页面的术语集均无语义共线。
                </p>
                <p className="text-[11px] text-manor-inkFaint mt-1.5 leading-relaxed">
                  这通常意味着它属于一个尚未建立的主题。请通过「指派到其它…」手动归位，或在画布中为它新建支柱/集群。
                </p>
              </div>
            </div>
          )}

          {/* Inline page picker */}
          {showPicker && (
            <div>
              <span
                className="tracking-[0.15em] text-manor-brassHi/70 block mb-1.5"
                style={{ fontFamily: sc, fontSize: 10 }}
              >
                选择目标页面
              </span>
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-manor-inkFaint" />
                <input
                  ref={pickerRef}
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="搜索页面..."
                  className="w-full h-7 pl-7 pr-2 text-xs bg-manor-void/60 border border-manor-brass/25 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60"
                />
              </div>
              <div className="max-h-48 overflow-y-auto border border-manor-line rounded">
                {filteredPages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { onAssign(kw.id, p.id); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-manor-bg3 transition-colors border-b border-manor-line/20 text-xs"
                  >
                    <RoleMark role={p.role} size={6} />
                    <span className="text-manor-ink truncate flex-1">{p.title}</span>
                    <StatusChip status={p.status} size="sm" />
                  </button>
                ))}
                {filteredPages.length === 0 && (
                  <div className="py-3 text-center text-[11px] text-manor-inkFaint">无匹配</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-manor-line shrink-0 flex items-center gap-2">
          {suggestion && suggestedPage && (
            <button
              type="button"
              onClick={() => onAssign(kw.id, suggestion.pageId)}
              className="h-7 px-3 text-[11px] rounded border border-manor-brass/50 text-manor-brassHi hover:bg-manor-brassDim/15 transition-colors flex items-center gap-1.5 font-medium"
              style={{
                background: "linear-gradient(180deg, rgba(160,136,80,.10) 0%, rgba(160,136,80,.03) 100%)",
              }}
            >
              <Check size={12} /> 并入推荐
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPicker(!showPicker)}
            className="h-7 px-3 text-[11px] rounded border border-manor-line2 text-manor-inkDim hover:text-manor-ink hover:border-manor-brass/40 transition-colors flex items-center gap-1.5"
          >
            <ArrowRight size={12} /> 指派到其它...
          </button>
          <button
            type="button"
            onClick={() => onPark(kw.id)}
            className="h-7 px-3 text-[11px] rounded border border-manor-line2 text-manor-inkDim hover:text-manor-ink hover:border-manor-brass/40 transition-colors flex items-center gap-1.5"
          >
            <Package size={12} /> 暂存
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-3 text-[11px] text-manor-inkFaint hover:text-manor-ink transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
