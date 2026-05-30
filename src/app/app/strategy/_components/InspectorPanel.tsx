"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, Pencil } from "lucide-react";
import type { WbPage, RawKeyword, Market, MarketRankings } from "./_workbench";
import {
  opportunityScore,
  opportunityTier,
  dedupeKeywords,
  resolvePageIntent,
  isHardCannibalization,
  urlFunnelLayer,
  type PageRelation,
} from "./_workbench";
import {
  RoleMark,
  StatusChip,
  FunnelChip,
  FUNNEL_META,
  RELATION_META,
  INTENT_FAMILY_META,
  formatSv,
  positionText,
  formatPagePlanningIntent,
  formatBehaviorIntent,
  marketFlag,
} from "./_utils";

// 目标 URL · 点击即可编辑（Enter/失焦保存、Esc 取消；待新建页也能直接设 URL）
function UrlEditor({ url, onSave }: { url: string | null; onSave: (u: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(url ?? "");
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setDraft(url ?? ""); }, [url]);
  React.useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => { onSave(draft.trim()); setEditing(false); };
  const cancel = () => { setDraft(url ?? ""); setEditing(false); };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        placeholder="/collections/..."
        spellCheck={false}
        className="w-full bg-manor-void/60 border border-manor-brass/45 rounded px-1.5 py-0.5 text-[10px] font-mono text-manor-ink focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="点击编辑目标 URL"
      className="group inline-flex items-center gap-1 max-w-full text-[10px] font-mono text-manor-ink hover:text-manor-brassHi transition-colors"
    >
      <span className="truncate">{url ? url : "✚ 待新建（点击设置）"}</span>
      <Pencil size={9} className="opacity-0 group-hover:opacity-70 shrink-0" />
    </button>
  );
}

interface InspectorPanelProps {
  selectedPage: WbPage | null;
  pages: WbPage[];
  bindings: Record<string, string>;
  allKeywords: RawKeyword[];
  conflicts: PageRelation[];
  boundByPage: Map<string, RawKeyword[]>;
  rankings: MarketRankings;
  onPageSelect: (id: string) => void;
  onUrlChange: (pageId: string, url: string) => void;
  /** v2.4: optional collapse callback */
  onCollapse?: () => void;
}

export function InspectorPanel({
  selectedPage,
  pages,
  bindings,
  allKeywords,
  conflicts,
  boundByPage,
  rankings,
  onPageSelect,
  onUrlChange,
  onCollapse,
}: InspectorPanelProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  if (!selectedPage) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/50 block" style={{ fontFamily: sc }}>
            IUDICIUM
          </span>
          <p className="text-xs text-manor-inkFaint">
            点击中间地图中的页面节点<br />查看页面信号与已绑词
          </p>
        </div>
      </div>
    );
  }

  return <PageInspector
    page={selectedPage}
    pages={pages}
    conflicts={conflicts}
    boundByPage={boundByPage}
    allKeywords={allKeywords}
    bindings={bindings}
    rankings={rankings}
    onPageSelect={onPageSelect}
    onUrlChange={onUrlChange}
    onCollapse={onCollapse}
  />;
}

// ── Page Inspector ───────────────────────────────────────────────────────────
function PageInspector({
  page,
  pages,
  conflicts,
  boundByPage,
  allKeywords,
  bindings,
  rankings,
  onPageSelect,
  onUrlChange,
  onCollapse,
}: {
  page: WbPage;
  pages: WbPage[];
  conflicts: PageRelation[];
  boundByPage: Map<string, RawKeyword[]>;
  allKeywords: RawKeyword[];
  bindings: Record<string, string>;
  rankings: MarketRankings;
  onPageSelect: (id: string) => void;
  onUrlChange: (pageId: string, url: string) => void;
  onCollapse?: () => void;
}) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const [showAllKws, setShowAllKws] = React.useState(false);

  // 每市场 GSC 排名：按当前 URL 查（编辑 URL 后会自动跟着变）
  const pageRanks = (page.url && rankings[page.url]) || {};
  const dataMarkets = Object.keys(pageRanks) as Market[];
  // 可点选的市场 = 规划 locale ∪ 真有 GSC 数据的市场
  const marketsToShow = React.useMemo(
    () => Array.from(new Set<Market>([...page.markets, ...dataMarkets])),
    [page.markets, dataMarkets]
  );
  const [selectedMarket, setSelectedMarket] = React.useState<Market>(page.market);
  React.useEffect(() => { setSelectedMarket(page.market); }, [page.id, page.market]);
  const selRank = pageRanks[selectedMarket];

  // Opportunity score
  const oppScore = opportunityScore(page.position ? 0 : (page.clicks ?? 0), null, page.status);
  // Use a more meaningful calculation with the page's bound keywords
  const boundKws = boundByPage.get(page.id) ?? [];
  // 页面类型（URL 推断）+ 搜索意图（绑定词意图族投票）—— 显式化「这页在哪层漏斗、抓哪种意图」
  const funnel = urlFunnelLayer(page.url);
  const intentSignal = resolvePageIntent(boundKws);
  const totalSv = boundKws.reduce((s, k) => s + (k.sv ?? 0), 0);
  const avgKd = boundKws.length > 0
    ? Math.round(boundKws.reduce((s, k) => s + (k.kd ?? 0), 0) / boundKws.length)
    : 0;
  const pageOppScore = opportunityScore(totalSv, avgKd, page.status);
  const tier = opportunityTier(pageOppScore);

  // Cannibalization for this page
  const pageConflicts = conflicts.filter(
    (c) => c.aId === page.id || c.bId === page.id
  );

  // Intent distribution of bound keywords
  const intentDist = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const kw of boundKws) {
      const intent = kw.behaviorIntent ?? "未知";
      map.set(intent, (map.get(intent) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [boundKws]);

  // 同一关键词文本（跨市场多条）默认合并成一条
  const dedupedKws = React.useMemo(
    () => dedupeKeywords(boundKws).sort((a, b) => b.totalSv - a.totalSv),
    [boundKws]
  );
  const kwsToShow = showAllKws ? dedupedKws : dedupedKws.slice(0, 10);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-manor-line shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/60 flex-1 truncate min-w-0" style={{ fontFamily: sc }}>
            IUDICIUM · 页面检视
          </span>
          {onCollapse && (
            <button type="button" onClick={onCollapse} className="shrink-0 p-0.5 text-manor-inkFaint hover:text-manor-brassHi transition-colors" title="Collapse">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M9 12h6"/><path d="M3 18h18"/></svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RoleMark role={page.role} size={8} />
          <p className="text-sm text-manor-ink font-medium truncate flex-1" title={page.title}>
            {page.title}
          </p>
        </div>
      </div>

      <div className="px-3 py-3 space-y-3 flex-1">
        {/* Page specs */}
        <div className="space-y-2.5 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-manor-inkFaint block text-[10px]">主词</span>
              <span className="text-manor-ink">{page.primaryKeyword}</span>
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[10px]">页面类型</span>
              {formatPagePlanningIntent(page.pageType)}
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[10px]">状态</span>
              <StatusChip status={page.status} size="sm" />
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[10px]">页面类型</span>
              {funnel ? (
                <div className="flex flex-col gap-0.5">
                  <FunnelChip url={page.url} size="sm" />
                  <span className="text-[9px] text-manor-inkFaint leading-snug">{FUNNEL_META[funnel].sublabel}</span>
                </div>
              ) : (
                <span className="text-[10px] text-manor-inkFaint italic">未定 · 设 URL 后识别</span>
              )}
            </div>
          </div>

          {/* 目标 URL — 可编辑 */}
          <div>
            <span className="text-manor-inkFaint block text-[10px] mb-0.5">目标 URL</span>
            <UrlEditor url={page.url} onSave={(u) => onUrlChange(page.id, u)} />
          </div>

          {/* 市场 — 可点选；下方 GSC 排名随所选市场变（来自收录与索引，有则显示） */}
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-manor-inkFaint text-[10px]">市场 · 点选看各市场排名</span>
              <span className="text-manor-inkFaint text-[9px] italic">数据来自收录与索引</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 mb-1.5">
              {marketsToShow.map((m) => {
                const has = !!pageRanks[m];
                const active = m === selectedMarket;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedMarket(m)}
                    title={has ? `${m.toUpperCase()} · 排名 #${pageRanks[m]!.position}` : `${m.toUpperCase()} · 暂无 GSC 数据`}
                    className={[
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] transition-colors",
                      active
                        ? "border-manor-brass/60 bg-manor-brassDim/15"
                        : "border-manor-line2/50 hover:border-manor-brass/40 hover:bg-manor-bg3",
                      has ? "" : "opacity-40",
                    ].join(" ")}
                  >
                    <span>{marketFlag(m)}</span>
                    <span className={active ? "text-manor-brassHi" : "text-manor-inkDim"}>{m.toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-manor-inkFaint text-[10px]">GSC 排名 · {selectedMarket.toUpperCase()}</span>
              {selRank ? (
                <>
                  <span className={`text-xs font-medium ${positionText(selRank.position).cls}`}>
                    {positionText(selRank.position).text}
                  </span>
                  <span className="text-manor-inkFaint text-[10px] tabular-nums">
                    {selRank.clicks.toLocaleString()} 点击
                  </span>
                </>
              ) : (
                <span className="text-manor-inkFaint text-[10px] italic">该市场暂无 GSC 数据</span>
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-manor-line" />

        {/* Signals section */}
        <div>
          <span className="text-[10px] tracking-[0.15em] text-manor-brassHi/70 block mb-1.5" style={{ fontFamily: sc }}>
            专业信号
          </span>

          {/* 搜索意图（意图族）—— 这页主要抓哪种搜索意图 */}
          <div className="mb-2">
            <span className="text-[10px] text-manor-inkFaint block mb-1">搜索意图</span>
            {intentSignal.family ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-manor-ink">{INTENT_FAMILY_META[intentSignal.family].label}</span>
                {intentSignal.mixed && (
                  <span className="inline-flex items-center px-1 py-0 rounded border text-[9px] bg-manor-bg3 text-manor-brassHi border-manor-brassDim/55">
                    意图混杂 · 需人工确认
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-manor-inkFaint italic">尚无绑定词 — 待判定</span>
            )}
          </div>

          {/* Intent distribution */}
          {intentDist.length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] text-manor-inkFaint block mb-1">意图分布</span>
              <div className="flex flex-wrap gap-1">
                {intentDist.map(([intent, count]) => (
                  <span key={intent} className="text-[10px] text-manor-inkDim">
                    {formatBehaviorIntent(intent as any)}
                    <span className="text-manor-inkFaint ml-0.5">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Coverage gap (demo) */}
          <div className="mb-2">
            <span className="text-[10px] text-manor-inkFaint block mb-1">
              覆盖缺口 <span className="italic text-manor-inkFaint">(示例)</span>
            </span>
            <span className="text-[10px] text-manor-inkDim">
              {page.status === "gap"
                ? "全缺口 — 无承接页"
                : page.status === "optimize"
                ? "部分覆盖 — 排名偏后"
                : "已覆盖"}
            </span>
          </div>

          {/* Opportunity score */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] text-manor-inkFaint">机会分</span>
            <span className={`text-xs font-medium ${tier.cls}`}>
              {tier.label}
            </span>
            <span className="text-[10px] text-manor-inkDim tabular-nums">
              {pageOppScore.toLocaleString()}
            </span>
          </div>

          {/* 页面关系（蚕食检测）—— 四色：真蚕食红 / 待核黄 / 漏斗协作绿 / 跨主题灰 */}
          {pageConflicts.length > 0 && (
            <div className="mb-2">
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-[10px] text-manor-brassHi/70">页面关系</span>
                <span className="text-[9px] text-manor-inkFaint italic">重合% 为演示值</span>
              </div>
              <div className="space-y-1.5">
                {pageConflicts
                  .slice()
                  .sort((a, b) => (isHardCannibalization(b) ? 1 : 0) - (isHardCannibalization(a) ? 1 : 0))
                  .map((c, i) => {
                    const otherId = c.aId === page.id ? c.bId : c.aId;
                    const other = pages.find((p) => p.id === otherId);
                    const m = RELATION_META[c.relationType];
                    const hard = isHardCannibalization(c);
                    return (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center gap-1.5">
                          {hard && <AlertTriangle size={11} className="text-manor-oxbloodHi shrink-0" />}
                          <span className={`inline-flex items-center px-1 py-0 rounded border text-[9px] shrink-0 ${m.chip}`}>
                            {m.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => onPageSelect(otherId)}
                            className="text-manor-inkDim hover:text-manor-brassHi hover:underline truncate min-w-0 flex-1 text-left"
                            title={other?.title ?? otherId}
                          >
                            {other?.title ?? otherId}
                          </button>
                          <span className="text-manor-inkFaint tabular-nums shrink-0">{c.overlap}%</span>
                        </div>
                        <div className="text-manor-inkFaint mt-0.5 leading-snug">{c.advice}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-manor-line" />

        {/* Bound keywords */}
        <div>
          <span className="text-[10px] tracking-[0.15em] text-manor-brassHi/70 block mb-1.5" style={{ fontFamily: sc }}>
            已绑定关键词 ({dedupedKws.length}{dedupedKws.length !== boundKws.length ? ` · 合并自 ${boundKws.length}` : ""})
          </span>
          {kwsToShow.length > 0 ? (
            <div className="space-y-0.5">
              {kwsToShow.map((g) => (
                <div key={g.key} className="flex items-center gap-1.5 text-[10px] text-manor-inkDim">
                  <span className="w-3 text-center">{marketFlag(g.reprMarket)}</span>
                  <span className="truncate flex-1">{g.keyword}</span>
                  {g.count > 1 && (
                    <span className="text-[9px] text-manor-inkFaint" title={`${g.count} 个市场变体合并`}>×{g.count}</span>
                  )}
                  <span className="tabular-nums text-manor-inkFaint">{formatSv(g.totalSv)}</span>
                </div>
              ))}
              {dedupedKws.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAllKws(!showAllKws)}
                  className="text-[10px] text-manor-inkFaint hover:text-manor-brassHi flex items-center gap-0.5 pt-1"
                >
                  <ChevronDown size={10} className={showAllKws ? "rotate-180" : ""} />
                  {showAllKws ? "收起" : `展开全部 (${dedupedKws.length})`}
                </button>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-manor-inkFaint">尚无绑定词</span>
          )}
        </div>
      </div>
    </div>
  );
}
