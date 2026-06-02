"use client";

import * as React from "react";
import { ChevronDown, Pencil, X, ExternalLink } from "lucide-react";
import type { WbPage, RawKeyword, Market, MarketRankings, IndexedMatches, IndexedUrlMatch } from "./_workbench";
import {
  opportunityScore,
  opportunityTier,
  dedupeKeywords,
  resolvePageIntent,
  urlFunnelLayer,
  matchIndexed,
  effectiveStatus,
} from "./_workbench";

// 聚合多个 locale/market 变体的查询词：同词跨变体合并，clicks/impressions 累加，position 按曝光加权平均。
function aggregateQueries(matches: IndexedUrlMatch[]): { query: string; clicks: number; impressions: number; position: number }[] {
  const m = new Map<string, { query: string; clicks: number; impressions: number; position: number; _w: number }>();
  for (const mt of matches) {
    for (const q of mt.queries) {
      const key = q.query.trim().toLowerCase();
      const g = m.get(key);
      const w = q.impressions || 1;
      if (!g) m.set(key, { query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position, _w: w });
      else {
        g.clicks += q.clicks;
        g.impressions += q.impressions;
        g.position = (g.position * g._w + q.position * w) / (g._w + w);
        g._w += w;
      }
    }
  }
  return [...m.values()]
    .map(({ _w, ...r }) => ({ ...r, position: Math.round(r.position * 10) / 10 }))
    .sort((a, b) => b.clicks - a.clicks);
}
const norm = (s: string) => s.trim().toLowerCase();
import {
  RoleMark,
  StatusChip,
  FunnelChip,
  FUNNEL_META,
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
        className="w-full bg-manor-void/60 border border-manor-brass/45 rounded px-1.5 py-0.5 text-[12px] font-mono text-manor-ink focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="点击编辑目标 URL"
      className="group inline-flex items-center gap-1 max-w-full text-[12px] font-mono text-manor-ink hover:text-manor-brassHi transition-colors"
    >
      <span className="truncate">{url ? url : "✚ 待新建（点击设置）"}</span>
      <Pencil size={9} className="opacity-0 group-hover:opacity-70 shrink-0" />
    </button>
  );
}

// 辅助词编辑器：chip + 删除 × + 尾部添加输入
function AuxKeywordEditor({ words, onWordsChange }: { words: string[]; onWordsChange?: (words: string[]) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const commitAdd = () => {
    const val = draft.trim();
    if (val && onWordsChange && !words.some((w) => w.toLowerCase() === val.toLowerCase())) {
      onWordsChange([...words, val]);
    }
    setDraft("");
    setAdding(false);
  };
  const cancelAdd = () => { setDraft(""); setAdding(false); };
  const removeWord = (idx: number) => {
    if (!onWordsChange) return;
    onWordsChange(words.filter((_, i) => i !== idx));
  };

  // 空辅助词且无编辑能力时不渲染
  if (words.length === 0 && !onWordsChange) return null;

  return (
    <div className="mt-2 pt-1.5 border-t border-manor-line/50">
      <span className="text-[11px] text-manor-inkFaint block mb-0.5">辅助词 · 实体（写作覆盖，无搜索量）</span>
      <div className="flex flex-wrap gap-1 items-center">
        {words.map((w, i) => (
          <span key={i} className="group/aux inline-flex items-center text-[11px] text-manor-inkDim/80 px-1 py-0.5 border border-manor-line2/40 rounded">
            {w}
            {onWordsChange && (
              <button
                type="button"
                onClick={() => removeWord(i)}
                title={`删除「${w}」`}
                aria-label={`删除辅助词 ${w}`}
                className="ml-0.5 -mr-0.5 p-0 text-manor-inkFaint hover:text-manor-oxbloodHi opacity-0 group-hover/aux:opacity-100 focus:opacity-100 transition-opacity"
              >
                <X size={9} />
              </button>
            )}
          </span>
        ))}
        {onWordsChange && (
          adding ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
                else if (e.key === "Escape") cancelAdd();
              }}
              onBlur={commitAdd}
              placeholder="新辅助词"
              spellCheck={false}
              className="w-20 bg-manor-void/60 border border-manor-brass/45 rounded px-1 py-0.5 text-[11px] text-manor-ink focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[11px] text-manor-inkFaint/70 hover:text-manor-brassHi px-1 py-0.5 border border-dashed border-manor-line2/40 rounded transition-colors"
            >
              + 添加
            </button>
          )
        )}
      </div>
    </div>
  );
}

interface InspectorPanelProps {
  selectedPage: WbPage | null;
  pages: WbPage[];
  bindings: Record<string, string>;
  allKeywords: RawKeyword[];
  boundByPage: Map<string, RawKeyword[]>;
  rankings: MarketRankings;
  indexedMatches: IndexedMatches;
  onPageSelect: (id: string) => void;
  onUrlChange: (pageId: string, url: string) => void;
  /** 辅助词增删回调：传入该页完整的新辅助词数组 */
  onAuxChange?: (pageId: string, words: string[]) => void;
  /** 移出已绑词（走二次验印确认）。传入该页该词文本的全部市场变体 id。 */
  onUnassign?: (kwIds: string[]) => void;
  /** v2.4: optional collapse callback */
  onCollapse?: () => void;
}

export function InspectorPanel({
  selectedPage,
  pages,
  bindings,
  allKeywords,
  boundByPage,
  rankings,
  indexedMatches,
  onPageSelect,
  onUrlChange,
  onAuxChange,
  onUnassign,
  onCollapse,
}: InspectorPanelProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  if (!selectedPage) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <span className="text-[12px] tracking-[0.2em] text-manor-brassHi/50 block" style={{ fontFamily: sc }}>
            IUDICIUM
          </span>
          <p className="text-[13px] text-manor-inkFaint">
            点击中间地图中的页面节点<br />查看页面信号与已绑词
          </p>
        </div>
      </div>
    );
  }

  return <PageInspector
    page={selectedPage}
    pages={pages}
    boundByPage={boundByPage}
    allKeywords={allKeywords}
    bindings={bindings}
    rankings={rankings}
    indexedMatches={indexedMatches}
    onPageSelect={onPageSelect}
    onUrlChange={onUrlChange}
    onAuxChange={onAuxChange}
    onUnassign={onUnassign}
    onCollapse={onCollapse}
  />;
}

// ── Page Inspector ───────────────────────────────────────────────────────────
function PageInspector({
  page,
  pages,
  boundByPage,
  allKeywords,
  bindings,
  rankings,
  indexedMatches,
  onPageSelect,
  onUrlChange,
  onAuxChange,
  onUnassign,
  onCollapse,
}: {
  page: WbPage;
  pages: WbPage[];
  boundByPage: Map<string, RawKeyword[]>;
  allKeywords: RawKeyword[];
  bindings: Record<string, string>;
  rankings: MarketRankings;
  indexedMatches: IndexedMatches;
  onPageSelect: (id: string) => void;
  onUrlChange: (pageId: string, url: string) => void;
  onAuxChange?: (pageId: string, words: string[]) => void;
  onUnassign?: (kwIds: string[]) => void;
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

  // ── 收录索引匹配：命中的变体（多语种）+ 实际查询词 + 计划∩实际命中集 ──
  const matches = React.useMemo(() => matchIndexed(page.url, indexedMatches), [page.url, indexedMatches]);
  const isLive = matches.length > 0; // URL 命中收录索引（任一变体）→ 视为已上线
  const actualQueries = React.useMemo(() => aggregateQueries(matches), [matches]);
  const plannedTexts = React.useMemo(() => new Set(dedupedKws.map((g) => norm(g.keyword))), [dedupedKws]);
  const actualTexts = React.useMemo(() => new Set(actualQueries.map((q) => norm(q.query))), [actualQueries]);
  const effStatus = effectiveStatus(page.url, page.status, indexedMatches);
  // 关键词标签页：计划词 / 实际词
  const [kwTab, setKwTab] = React.useState<"planned" | "actual">("planned");
  // 辅助词[实体]：M6 起以 page.auxKeywords 为权威。
  // 用户编辑过(auxEdited=true，含清空到 0 个) → 严格用 auxKeywords，绝不回退 note（否则清空后又被 note 旧值填回）。
  // 未编辑(旧草稿无此字段) → auxKeywords 有值用之，否则回退解析 note 兜底。
  const auxWords = React.useMemo(() => {
    if (page.auxEdited) return page.auxKeywords ?? [];
    if (page.auxKeywords && page.auxKeywords.length > 0) return page.auxKeywords;
    const m = page.note?.match(/辅助词?\[实体\][：:]\s*(.+)$/);
    return m
      ? m[1].split(/\s*[·•/]\s*/).map((s) => s.replace(/[…\s]+$/, "").trim()).filter(Boolean)
      : [];
  }, [page.auxKeywords, page.auxEdited, page.note]);
  const actualShown = showAllKws ? actualQueries : actualQueries.slice(0, 12);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-manor-line shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] tracking-[0.2em] text-manor-brassHi/60 flex-1 truncate min-w-0" style={{ fontFamily: sc }}>
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
        {page.subtitle && (
          <p className="text-[12px] text-manor-inkDim leading-snug mt-1" title={page.subtitle}>
            {page.subtitle}
          </p>
        )}
      </div>

      <div className="px-3 py-3 space-y-3 flex-1">
        {/* Page specs */}
        <div className="space-y-2.5 text-[13px]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-manor-inkFaint block text-[12px]">主词</span>
              <span className="text-manor-ink">{page.primaryKeyword}</span>
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[12px]">页面类型</span>
              {formatPagePlanningIntent(page.pageType)}
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[12px]">状态</span>
              <div className="flex items-center gap-1">
                <StatusChip status={effStatus} size="sm" />
                {isLive && page.status !== "live" && (
                  <span className="text-[11px] text-manor-sageHi" title="URL 命中收录与索引，自动判为已上线">· 收录命中</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-manor-inkFaint block text-[12px]">页面类型</span>
              {funnel ? (
                <div className="flex flex-col gap-0.5">
                  <FunnelChip url={page.url} size="sm" />
                  <span className="text-[11px] text-manor-inkFaint leading-snug">{FUNNEL_META[funnel].sublabel}</span>
                </div>
              ) : (
                <span className="text-[12px] text-manor-inkFaint italic">未定 · 设 URL 后识别</span>
              )}
            </div>
          </div>

          {/* 目标 URL — 可编辑 */}
          <div>
            <span className="text-manor-inkFaint block text-[12px] mb-0.5">目标 URL</span>
            <UrlEditor url={page.url} onSave={(u) => onUrlChange(page.id, u)} />
          </div>

          {/* 收录索引命中：URL 命中的所有变体（多语种/多市场），点击进入收录与索引对应页 */}
          {matches.length > 0 ? (
            <div>
              <span className="text-manor-inkFaint block text-[12px] mb-0.5">
                收录索引命中 · <span className="text-manor-sageHi font-semibold">{matches.length}</span> 个 URL
              </span>
              <div className="space-y-0.5">
                {matches.map((mt) => (
                  <a
                    key={mt.pageId}
                    href={`/app/indexing?focus=${encodeURIComponent(mt.pageId)}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`${mt.fullUrl} · 点击进入「收录与索引」对应页`}
                    className="group flex items-center gap-1.5 text-[12px] text-manor-inkDim hover:text-manor-brassHi transition-colors"
                  >
                    <span className="w-3 text-center shrink-0">{marketFlag(mt.market as Market)}</span>
                    <span className="truncate flex-1 font-mono">{mt.basePath}</span>
                    <span className="text-manor-sageHi tabular-nums shrink-0">#{Math.round(mt.position * 10) / 10}</span>
                    <span className="text-manor-inkFaint tabular-nums shrink-0">{mt.clicks.toLocaleString()}</span>
                    <ExternalLink size={9} className="opacity-0 group-hover:opacity-70 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          ) : page.url ? (
            <div>
              <span className="text-[12px] text-manor-inkFaint italic">该 URL 未在收录与索引中命中（待新建 / 未上线）</span>
            </div>
          ) : null}

          {/* 市场 — 可点选；下方 GSC 排名随所选市场变（来自收录与索引，有则显示） */}
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-manor-inkFaint text-[12px]">市场 · 点选看各市场排名</span>
              <span className="text-manor-inkFaint text-[11px] italic">数据来自收录与索引</span>
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
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[13px] transition-colors",
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
              <span className="text-manor-inkFaint text-[12px]">GSC 排名 · {selectedMarket.toUpperCase()}</span>
              {selRank ? (
                <>
                  <span className={`text-[13px] font-medium ${positionText(selRank.position).cls}`}>
                    {positionText(selRank.position).text}
                  </span>
                  <span className="text-manor-inkFaint text-[12px] tabular-nums">
                    {selRank.clicks.toLocaleString()} 点击
                  </span>
                </>
              ) : (
                <span className="text-manor-inkFaint text-[12px] italic">该市场暂无 GSC 数据</span>
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-manor-line" />

        {/* Signals section */}
        <div>
          <span className="text-[12px] tracking-[0.15em] text-manor-brassHi/70 block mb-1.5" style={{ fontFamily: sc }}>
            专业信号
          </span>

          {/* 搜索意图（意图族）—— 这页主要抓哪种搜索意图 */}
          <div className="mb-2">
            <span className="text-[12px] text-manor-inkFaint block mb-1">搜索意图</span>
            {intentSignal.family ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] text-manor-ink">{INTENT_FAMILY_META[intentSignal.family].label}</span>
                {intentSignal.mixed && (
                  <span className="inline-flex items-center px-1 py-0 rounded border text-[11px] bg-manor-bg3 text-manor-brassHi border-manor-brassDim/55">
                    意图混杂 · 需人工确认
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[12px] text-manor-inkFaint italic">尚无绑定词 — 待判定</span>
            )}
          </div>

          {/* Intent distribution */}
          {intentDist.length > 0 && (
            <div className="mb-2">
              <span className="text-[12px] text-manor-inkFaint block mb-1">意图分布</span>
              <div className="flex flex-wrap gap-1">
                {intentDist.map(([intent, count]) => (
                  <span key={intent} className="text-[12px] text-manor-inkDim">
                    {formatBehaviorIntent(intent as any)}
                    <span className="text-manor-inkFaint ml-0.5">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Coverage gap (demo) */}
          <div className="mb-2">
            <span className="text-[12px] text-manor-inkFaint block mb-1">
              覆盖缺口 <span className="italic text-manor-inkFaint">(示例)</span>
            </span>
            <span className="text-[12px] text-manor-inkDim">
              {page.status === "gap"
                ? "全缺口 — 无承接页"
                : page.status === "optimize"
                ? "部分覆盖 — 排名偏后"
                : "已覆盖"}
            </span>
          </div>

          {/* Opportunity score */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] text-manor-inkFaint">机会分</span>
            <span className={`text-[13px] font-medium ${tier.cls}`}>
              {tier.label}
            </span>
            <span className="text-[12px] text-manor-inkDim tabular-nums">
              {pageOppScore.toLocaleString()}
            </span>
          </div>

          {/* GEO 概述 */}
          {page.geoOverview && (
            <div className="mb-2">
              <span className="text-[11px] tracking-[0.12em] text-manor-brassHi/60 block mb-1" style={{ fontFamily: sc }}>
                GEO 概述
              </span>
              <p className="text-[12px] text-manor-inkDim leading-relaxed">
                {page.geoOverview}
              </p>
            </div>
          )}

        </div>

        <div className="h-px bg-manor-line" />

        {/* 关键词 · 标签页（计划词 / 收录索引实际词）—— 命中(计划∩实际)以绿色强调 */}
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            {([
              ["planned", `计划词 ${dedupedKws.length}`],
              ["actual", `实际词 ${actualQueries.length}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setKwTab(key)}
                className={[
                  "px-2 py-0.5 rounded text-[12px] tracking-[0.08em] border transition-colors",
                  kwTab === key
                    ? "border-manor-brass/55 bg-manor-brassDim/15 text-manor-brassHi"
                    : "border-manor-line2/40 text-manor-inkFaint hover:text-manor-ink hover:border-manor-brass/30",
                ].join(" ")}
                style={{ fontFamily: sc }}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-manor-inkFaint italic">绿 = 计划与实际命中</span>
          </div>

          {kwTab === "planned" ? (
            dedupedKws.length > 0 ? (
              <div className="space-y-0.5">
                {kwsToShow.map((g) => {
                  const hit = actualTexts.has(norm(g.keyword));
                  return (
                    <div key={g.key} className={`group flex items-center gap-1.5 text-[12px] ${hit ? "text-manor-sageHi" : "text-manor-inkDim"}`}>
                      <span className="w-3 text-center shrink-0">{marketFlag(g.reprMarket)}</span>
                      <span className="truncate flex-1">{g.keyword}</span>
                      {hit && <span className="text-[11px] text-manor-sageHi shrink-0" title="该计划词已在收录索引拿到实际曝光/点击">命中</span>}
                      {g.count > 1 && <span className="text-[11px] text-manor-inkFaint shrink-0" title={`${g.count} 个市场变体合并`}>×{g.count}</span>}
                      <span className="tabular-nums text-manor-inkFaint shrink-0">{formatSv(g.totalSv)}</span>
                      {onUnassign && (
                        <button
                          type="button"
                          onClick={() => onUnassign(g.ids)}
                          title={g.count > 1 ? `移出该词的 ${g.count} 个市场变体（移回源池）` : "移出该词（移回源池）"}
                          aria-label="移出该词"
                          className="shrink-0 p-0.5 -mr-0.5 text-manor-inkFaint hover:text-manor-oxbloodHi opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {dedupedKws.length > 10 && (
                  <button type="button" onClick={() => setShowAllKws(!showAllKws)} className="text-[12px] text-manor-inkFaint hover:text-manor-brassHi flex items-center gap-0.5 pt-1">
                    <ChevronDown size={10} className={showAllKws ? "rotate-180" : ""} />
                    {showAllKws ? "收起" : `展开全部 (${dedupedKws.length})`}
                  </button>
                )}
              </div>
            ) : (
              <span className="text-[12px] text-manor-inkFaint">尚无计划词</span>
            )
          ) : actualQueries.length > 0 ? (
            <div className="space-y-0.5">
              {actualShown.map((q) => {
                const planned = plannedTexts.has(norm(q.query));
                return (
                  <div key={q.query} className={`flex items-center gap-1.5 text-[12px] ${planned ? "text-manor-sageHi" : "text-manor-inkDim"}`}>
                    <span className="truncate flex-1">{q.query}</span>
                    {planned && <span className="text-[11px] text-manor-sageHi shrink-0" title="该实际查询词正是规划的计划词">已规划</span>}
                    <span className="tabular-nums text-manor-inkFaint shrink-0" title="加权平均排名">#{q.position}</span>
                    <span className="tabular-nums text-manor-inkFaint shrink-0" title="点击">{q.clicks.toLocaleString()}</span>
                  </div>
                );
              })}
              {actualQueries.length > 12 && (
                <button type="button" onClick={() => setShowAllKws(!showAllKws)} className="text-[12px] text-manor-inkFaint hover:text-manor-brassHi flex items-center gap-0.5 pt-1">
                  <ChevronDown size={10} className={showAllKws ? "rotate-180" : ""} />
                  {showAllKws ? "收起" : `展开全部 (${actualQueries.length})`}
                </button>
              )}
            </div>
          ) : (
            <span className="text-[12px] text-manor-inkFaint">{page.url ? "该 URL 在收录与索引暂无查询词数据" : "设 URL 后显示实际命中的查询词"}</span>
          )}

          {/* 辅助词 · 实体（写作语义覆盖，无搜索量；可增删） */}
          <AuxKeywordEditor
            words={auxWords}
            onWordsChange={onAuxChange ? (words) => onAuxChange(page.id, words) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
