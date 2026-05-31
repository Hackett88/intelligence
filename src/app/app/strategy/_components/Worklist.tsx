"use client";

/**
 * 行动清单（IUDICIUM · 作战台）—— 服务北极星「行动」决策。
 * 把现有数据(页面状态/源池词)转成"下一步该干什么"的优先级待办,而非静态展示。
 * 默认占据右栏(未选页面时):待优化 > 内容缺口 > 未归位高价值词。每条可点击定位。
 * 全部数据来自现有 props,零新数据源、零迁移。
 */
import * as React from "react";
import { TrendingDown, Plus, Inbox, Target } from "lucide-react";
import type { WbPage, RawKeyword } from "./_workbench";
import { suggestPlacement } from "./_workbench";
import { formatSv, marketFlag, positionText } from "./_utils";

interface WorklistProps {
  pages: WbPage[];
  poolKeywords: RawKeyword[];
  boundByPage: Map<string, RawKeyword[]>;
  onPageSelect: (id: string) => void;
  onKeywordOpen: (id: string) => void;
  onAssign: (kwId: string, pageId: string) => void;
  /** v2.4: optional collapse callback */
  onCollapse?: () => void;
}

const GAP_LIMIT = 6;

export function Worklist({ pages, poolKeywords, boundByPage, onPageSelect, onKeywordOpen, onAssign, onCollapse }: WorklistProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  const toOptimize = React.useMemo(() => pages.filter((p) => p.status === "optimize"), [pages]);
  const gaps = React.useMemo(
    () => pages.filter((p) => p.status === "gap").sort((a, b) => a.role === "pillar" ? -1 : b.role === "pillar" ? 1 : 0),
    [pages]
  );
  const unplaced = React.useMemo(
    () => [...poolKeywords].sort((a, b) => (b.sv ?? 0) - (a.sv ?? 0)).slice(0, 8),
    [poolKeywords]
  );

  const total = toOptimize.length + gaps.length + unplaced.length;

  const Row = ({
    onClick,
    children,
  }: {
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-manor-bg3/60 transition-colors group"
    >
      {children}
    </button>
  );

  const SectionHead = ({
    icon,
    label,
    count,
    cls,
  }: {
    icon: React.ReactNode;
    label: string;
    count: number;
    cls: string;
  }) => (
    <div className="flex items-center gap-1.5 mb-1 mt-1">
      <span className={cls}>{icon}</span>
      <span className={`text-[11px] tracking-[0.06em] ${cls}`}>{label}</span>
      <span className="text-[10px] text-manor-inkFaint tabular-nums">{count}</span>
      <span className="flex-1 h-px bg-manor-line/50" />
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-manor-line shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/60 flex-1 truncate min-w-0" style={{ fontFamily: sc }}>
            IUDICIUM · 作战清单
          </span>
          <span className="text-[10px] text-manor-inkFaint tabular-nums shrink-0">{total} 项</span>
          {onCollapse && (
            <button type="button" onClick={onCollapse} className="shrink-0 p-0.5 text-manor-inkFaint hover:text-manor-brassHi transition-colors" title="Collapse">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M9 12h6"/><path d="M3 18h18"/></svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Target size={13} className="text-manor-brassHi shrink-0" />
          <p className="text-sm text-manor-ink font-medium">下一步该做什么</p>
        </div>
        <p className="text-[10px] text-manor-inkFaint mt-1 leading-snug">
          理顺这些,流量才能顺畅汇向核心产品 Zikr Ring 成交
        </p>
      </div>

      <div className="px-3 py-2 space-y-2 flex-1">
        {total === 0 && (
          <div className="text-center py-10 text-[11px] text-manor-inkFaint">规划很健康,暂无待办 ✓</div>
        )}

        {/* 1. 待优化(排名靠后) */}
        {toOptimize.length > 0 && (
          <div>
            <SectionHead icon={<TrendingDown size={12} />} label="待优化 · 已上线但排名偏后" count={toOptimize.length} cls="text-manor-brassHi" />
            {toOptimize.map((p) => (
              <Row key={p.id} onClick={() => onPageSelect(p.id)}>
                <span className="w-1 self-stretch rounded bg-manor-brassHi/50 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="text-[11px] text-manor-ink/90 block truncate">{p.title}</span>
                  <span className="text-[10px] text-manor-inkFaint">
                    {p.position != null ? <span className={positionText(p.position).cls}>当前 {positionText(p.position).text}</span> : "排名偏后"} · 改造提升
                  </span>
                </span>
              </Row>
            ))}
          </div>
        )}

        {/* 2. 内容缺口(待新建) */}
        {gaps.length > 0 && (
          <div>
            <SectionHead icon={<Plus size={12} />} label="内容缺口 · 该词群还没页承接" count={gaps.length} cls="text-manor-sageHi" />
            {gaps.slice(0, GAP_LIMIT).map((p) => (
              <Row key={p.id} onClick={() => onPageSelect(p.id)}>
                <span className="w-1 self-stretch rounded bg-manor-sageDim/60 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="text-[11px] text-manor-ink/90 block truncate">{p.title}</span>
                  <span className="text-[10px] text-manor-inkFaint">待新建 · {p.role === "pillar" ? "支柱页" : p.role === "sub-pillar" ? "子支柱页" : "集群页"}</span>
                </span>
              </Row>
            ))}
            {gaps.length > GAP_LIMIT && (
              <div className="text-[10px] text-manor-inkFaint pl-3 pt-0.5">…还有 {gaps.length - GAP_LIMIT} 个待新建</div>
            )}
          </div>
        )}

        {/* 3. 未归位高价值词 */}
        {unplaced.length > 0 && (
          <div>
            <SectionHead icon={<Inbox size={12} />} label="未归位 · 高价值词还没派给页面" count={poolKeywords.length} cls="text-manor-inkDim" />
            {unplaced.map((kw) => {
              const sug = suggestPlacement(kw, pages, boundByPage);
              const sugPage = sug ? pages.find((p) => p.id === sug.pageId) : null;
              return (
                <div key={kw.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-manor-bg3/60 group">
                  <span className="w-1 self-stretch rounded bg-manor-line2 shrink-0" />
                  <button
                    type="button"
                    onClick={() => onKeywordOpen(kw.id)}
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                    title="点击查看词画像 / 手动指派"
                  >
                    <span className="text-[11px]">{marketFlag(kw.market)}</span>
                    <span className="text-[11px] text-manor-ink/90 truncate">{kw.keyword}</span>
                    <span className="text-[10px] text-manor-inkFaint tabular-nums">{formatSv(kw.sv)}</span>
                  </button>
                  {sugPage ? (
                    <button
                      type="button"
                      onClick={() => onAssign(kw.id, sugPage.id)}
                      title={`一键归位:归给「${sugPage.title}」（${sug!.reason}）`}
                      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border border-manor-sageDim/45 text-[10px] text-manor-sageHi hover:bg-manor-sageDim/15 transition-colors max-w-[116px]"
                    >
                      <span className="truncate">→ {sugPage.title}</span>
                    </button>
                  ) : (
                    <span className="shrink-0 text-[9px] text-manor-inkFaint italic">无建议</span>
                  )}
                </div>
              );
            })}
            {poolKeywords.length > unplaced.length && (
              <div className="text-[10px] text-manor-inkFaint pl-3 pt-0.5">…源池还有 {poolKeywords.length - unplaced.length} 个待归位</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
