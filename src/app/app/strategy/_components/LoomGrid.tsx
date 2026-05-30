"use client";

/**
 * LoomGrid v2.4 -- Polish pass.
 *
 * v2.4: #1 no triangles, #2 centered category names + row dividers,
 *        #3 native wheel listener (passive:false) for trackpad pinch,
 *        #4 drag from anywhere (including cells) with threshold
 */
import * as React from "react";
import { Plus, X, ChevronRight, ZoomOut, ZoomIn, Scan } from "lucide-react";
import type { WbPage, RawKeyword, Territory } from "./_workbench";
import { StatusDot, formatSv } from "./_utils";

// ── Constants ───────────────────────────────────────────────────────────────

type SpineEntry = { id: string; en: string; zh: string };
const CATEGORY_SPINE_DEFAULT: SpineEntry[] = [
  { id: "islamic-jewelry", en: "Islamic Jewelry", zh: "伊斯兰饰品" },
  { id: "tasbih", en: "Tasbih", zh: "念珠" },
  { id: "zikr-ring", en: "Zikr Ring", zh: "智能念珠戒指" },
];
type WeftType = { type: string; en: string; zh: string; themes: SpineEntry[] };
const WEFT_GROUPS: WeftType[] = [
  { type: "scenario", en: "Scenario", zh: "场景", themes: [
    { id: "muslim-gifts", en: "Gifts", zh: "送礼" },
    { id: "slow-living", en: "Slow Living", zh: "慢生活" },
  ]},
  { type: "knowledge", en: "Knowledge", zh: "知识", themes: [
    { id: "knowledge-dhikr", en: "Dhikr", zh: "念诵" },
  ]},
  { type: "tool", en: "Tool", zh: "工具", themes: [
    { id: "qibla-finder", en: "Qibla", zh: "朝向" },
    { id: "itasbih-tools", en: "iTasbih", zh: "数字念珠" },
  ]},
];
const CORE_CATEGORY = "zikr-ring";
const SCENARIO_TOKENS: Record<string, Set<string>> = {
  "knowledge-dhikr": new Set(["dhikr", "dzikir", "zikr", "prayer", "salah", "namaz", "sholat"]),
  "muslim-gifts": new Set(["gift", "gifts", "present", "presents", "ramadan", "eid", "umrah", "wedding"]),
  "qibla-finder": new Set(["qibla", "qiblah", "kaaba", "kaba", "mecca", "compass", "direction"]),
  "itasbih-tools": new Set(["itasbih", "counter", "digital", "tasbeeh", "online", "app", "electronic"]),
  "slow-living": new Set(["slow", "living", "routine", "night", "skincare", "lifestyle"]),
};

// ── Helpers ────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] { return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1); }
function foldPlural(t: string): string { if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2); if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1); return t; }
const STOPWORDS = new Set(["the","an","of","for","to","in","on","at","by","is","are","was","be","do","does","did","what","how","why","where","when","which","who","and","or","with","my","your","you","vs","from","as","it","its"]);
function meaningfulTokens(s: string): string[] { return tokenize(s).filter((w) => !STOPWORDS.has(w)).map(foldPlural); }
function shortTitle(title: string): string { return title.split(/[（(]/)[0].replace(/[·\-—]+$/, "").trim(); }

// ── Types ──────────────────────────────────────────────────────────────────

type CellData = {
  categoryId: string; scenarioId: string; keywords: RawKeyword[]; totalSv: number;
  bestStatus: "live" | "optimize" | "gap"; pageIds: string[];
  pageTitles: { title: string; status: "live" | "optimize" | "gap"; pageId: string }[];
};
type DrillLevel = { type: "overview" } | { type: "pillar"; themeId: string; themeName: string };
interface LoomGridProps {
  pages: WbPage[];
  boundByPage: Map<string, RawKeyword[]>;
  selectedPageId: string | null;
  onPageSelect: (id: string) => void;
  onNewCluster?: (title: string, pillarId: string) => void;
  onNewPillar?: (title: string, territory: Territory) => void;
}

// ── Zoom/Pan Hook v2.4 ───────────────────────────────────────────────────
// #3: native wheel listener for passive:false (trackpad pinch sends ctrlKey+wheel)
// #4: drag from anywhere with threshold -- no cell exclusion

const DRAG_THRESHOLD = 5;

function useZoomPan(canvasRef: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [isGesturing, setIsGesturing] = React.useState(false);
  const isPanning = React.useRef(false);
  const panStart = React.useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const didDrag = React.useRef(false);
  const pointerId = React.useRef<number | null>(null);
  const gestureTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // #3: native wheel listener with { passive: false } to intercept trackpad pinch
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Trackpad pinch = ctrlKey + wheel; regular scroll wheel = vertical deltaY
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        e.stopPropagation();
        // Temporarily enable GPU layer during zoom gesture for smoothness
        setIsGesturing(true);
        if (gestureTimer.current) clearTimeout(gestureTimer.current);
        gestureTimer.current = setTimeout(() => setIsGesturing(false), 200);
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setScale((prev) => {
          const next = Math.max(0.4, Math.min(2.0, prev - e.deltaY * 0.003));
          const ratio = next / prev;
          setTx((ptx) => mx - ratio * (mx - ptx));
          setTy((pty) => my - ratio * (my - pty));
          return next;
        });
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [canvasRef]);

  // #4: Drag from anywhere (including cells). Threshold distinguishes click vs drag.
  // On pointerup, if didDrag is true, we suppress the click by calling stopPropagation
  // on the click event (registered in a one-time capture listener).
  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Don't pan from buttons/inputs
    const el = e.target as HTMLElement;
    if (el.closest("button") || el.closest("input")) return;
    isPanning.current = true;
    didDrag.current = false;
    pointerId.current = e.pointerId;
    panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    // NOTE: intentionally NOT using setPointerCapture -- it redirects click synthesis
    // to the capturing element and prevents cell onClick from firing on clean clicks.
  }, [tx, ty]);

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isPanning.current || e.pointerId !== pointerId.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (!didDrag.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!didDrag.current) {
      // First frame that crosses threshold -- lock body selection to prevent text highlight
      didDrag.current = true;
      setIsGesturing(true);
      document.body.style.userSelect = "none";
      (document.body.style as unknown as Record<string, string>).webkitUserSelect = "none";
    }
    e.preventDefault();
    setTx(panStart.current.tx + dx);
    setTy(panStart.current.ty + dy);
  }, []);

  const handlePointerUp = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerId.current) return;
    const wasDrag = didDrag.current;
    isPanning.current = false;
    pointerId.current = null;
    // Restore body text selection after pan and drop GPU hint
    if (wasDrag) {
      document.body.style.userSelect = "";
      (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
      setIsGesturing(false);
    }
    // If user dragged, suppress the upcoming click event so cell selection doesn't fire
    if (wasDrag) {
      const container = e.currentTarget as HTMLElement;
      const suppress = (ce: Event) => { ce.stopPropagation(); ce.preventDefault(); };
      container.addEventListener("click", suppress, { capture: true, once: true });
      // Safety: remove if click never fires (edge case)
      setTimeout(() => container.removeEventListener("click", suppress, { capture: true }), 200);
    }
  }, []);

  const reset = React.useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);
  const zoomIn = React.useCallback(() => setScale((s) => Math.min(2.0, s + 0.15)), []);
  const zoomOut = React.useCallback(() => setScale((s) => Math.max(0.4, s - 0.15)), []);

  return { scale, tx, ty, isGesturing, isPanning, handlePointerDown, handlePointerMove, handlePointerUp, reset, zoomIn, zoomOut };
}

// ── Component ──────────────────────────────────────────────────────────────

export function LoomGrid({ pages, boundByPage, selectedPageId, onPageSelect, onNewCluster, onNewPillar }: LoomGridProps) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";
  const gridBorder = "1px solid rgba(212,179,111,0.12)";

  const [extraRows, setExtraRows] = React.useState<SpineEntry[]>([]);
  const [extraCols, setExtraCols] = React.useState<SpineEntry[]>([]);
  const [addingRow, setAddingRow] = React.useState(false);
  const [addingCol, setAddingCol] = React.useState(false);
  const [newRowEn, setNewRowEn] = React.useState("");
  const [newRowZh, setNewRowZh] = React.useState("");
  const [newColEn, setNewColEn] = React.useState("");
  const [newColZh, setNewColZh] = React.useState("");

  const CATEGORY_SPINE = React.useMemo(() => {
    const base = [...CATEGORY_SPINE_DEFAULT];
    const ci = base.findIndex((r) => r.id === CORE_CATEGORY);
    return [...base.slice(0, ci >= 0 ? ci : base.length), ...extraRows, ...(ci >= 0 ? base.slice(ci) : [])];
  }, [extraRows]);
  const weftGroupsWithExtra = React.useMemo(() => {
    const g = WEFT_GROUPS.map((x) => ({ ...x, themes: [...x.themes] }));
    if (extraCols.length > 0) { const si = g.findIndex((x) => x.type === "scenario"); if (si >= 0) g[si].themes.push(...extraCols); }
    return g;
  }, [extraCols]);
  const SCENARIO_COLS = React.useMemo(() => weftGroupsWithExtra.flatMap((g) => g.themes), [weftGroupsWithExtra]);
  const _uid = React.useRef(0);
  function addRow() { if (!newRowEn.trim()) return; setExtraRows((p) => [...p, { id: `user-cat-${_uid.current++}`, en: newRowEn.trim(), zh: newRowZh.trim() || newRowEn.trim() }]); setNewRowEn(""); setNewRowZh(""); setAddingRow(false); }
  function addCol() { if (!newColEn.trim()) return; setExtraCols((p) => [...p, { id: `user-scn-${_uid.current++}`, en: newColEn.trim(), zh: newColZh.trim() || newColEn.trim() }]); setNewColEn(""); setNewColZh(""); setAddingCol(false); }

  const [drillStack, setDrillStack] = React.useState<DrillLevel[]>([{ type: "overview" }]);
  const currentLevel = drillStack[drillStack.length - 1];
  const [newClusterFor, setNewClusterFor] = React.useState<string | null>(null);
  const [newClusterTitle, setNewClusterTitle] = React.useState("");
  const [addingSubPillar, setAddingSubPillar] = React.useState(false);
  const [newSubPillarTitle, setNewSubPillarTitle] = React.useState("");
  function drillInto(themeId: string, themeName: string) { setDrillStack((s) => [...s, { type: "pillar", themeId, themeName }]); }
  function drillBack() { setDrillStack((s) => (s.length > 1 ? s.slice(0, -1) : s)); }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && drillStack.length > 1) { e.preventDefault(); drillBack(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [drillStack.length]);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const zoom = useZoomPan(canvasRef);

  // Derived data
  const pagesByTheme = React.useMemo(() => { const m = new Map<string, WbPage[]>(); for (const p of pages) { if (!m.has(p.themeId)) m.set(p.themeId, []); m.get(p.themeId)!.push(p); } return m; }, [pages]);
  const scenarioOwned = React.useMemo(() => { const m = new Map<string, { count: number; pillarId: string | null }>(); for (const col of SCENARIO_COLS) { const sp = pagesByTheme.get(col.id) ?? []; m.set(col.id, { count: sp.length, pillarId: sp.find((p) => p.role === "pillar")?.id ?? null }); } return m; }, [pagesByTheme, SCENARIO_COLS]);
  const cells = React.useMemo(() => {
    const grid = new Map<string, CellData>();
    for (const cat of CATEGORY_SPINE) {
      const catPages = pagesByTheme.get(cat.id) ?? [];
      const catKws: { kw: RawKeyword; pageId: string; page: WbPage }[] = [];
      for (const p of catPages) for (const k of (boundByPage.get(p.id) ?? [])) catKws.push({ kw: k, pageId: p.id, page: p });
      for (const scen of SCENARIO_COLS) {
        const st = SCENARIO_TOKENS[scen.id]; const matched: { kw: RawKeyword; pageId: string; page: WbPage }[] = [];
        if (st) {
          for (const e of catKws) if (meaningfulTokens(e.kw.keyword).some((t) => st.has(t))) matched.push(e);
          const scenPages = pagesByTheme.get(scen.id) ?? []; const ct = new Set<string>(); const cp = catPages.find((p) => p.role === "pillar");
          if (cp) for (const t of meaningfulTokens(cp.primaryKeyword)) ct.add(t);
          for (const t of meaningfulTokens(cat.id.replace(/-/g, " "))) ct.add(t);
          for (const sp of scenPages) for (const k of (boundByPage.get(sp.id) ?? [])) if (meaningfulTokens(k.keyword).some((t) => ct.has(t)) && !matched.some((m) => m.kw.id === k.id)) matched.push({ kw: k, pageId: sp.id, page: sp });
        }
        const totalSv = matched.reduce((s, m) => s + (m.kw.sv ?? 0), 0); const ip = matched.map((m) => m.page);
        const bs: "live"|"optimize"|"gap" = ip.some((p) => p.status === "live") ? "live" : ip.some((p) => p.status === "optimize") ? "optimize" : "gap";
        const seen = new Set<string>(); const pt: CellData["pageTitles"] = [];
        for (const m of matched) if (!seen.has(m.pageId)) { seen.add(m.pageId); pt.push({ title: shortTitle(m.page.title), status: m.page.status, pageId: m.pageId }); }
        grid.set(`${cat.id}::${scen.id}`, { categoryId: cat.id, scenarioId: scen.id, keywords: matched.map((m) => m.kw), totalSv, bestStatus: bs, pageIds: [...seen], pageTitles: pt });
      }
    }
    return grid;
  }, [CATEGORY_SPINE, SCENARIO_COLS, pagesByTheme, boundByPage]);
  const categoryStats = React.useMemo(() => { const m = new Map<string, { pillarId: string | null }>(); for (const cat of CATEGORY_SPINE) { const cp = (pagesByTheme.get(cat.id) ?? []).find((p) => p.role === "pillar"); m.set(cat.id, { pillarId: cp?.id ?? null }); } return m; }, [CATEGORY_SPINE, pagesByTheme]);
  function handleCellClick(cell: CellData) { if (cell.pageIds.length > 0) onPageSelect(cell.pageIds[0]); }

  // ═══════════════════════════════════════════════════════════════════════
  //  DRILL-DOWN VIEW (unchanged from v2.3)
  // ═══════════════════════════════════════════════════════════════════════
  if (currentLevel.type === "pillar") {
    const { themeId, themeName } = currentLevel;
    const themePages = pagesByTheme.get(themeId) ?? [];
    const pillar = themePages.find((p) => p.role === "pillar");
    const clusters = themePages.filter((p) => p.role === "cluster");
    const groupMap = new Map<string, WbPage[]>(); const ungrouped: WbPage[] = [];
    for (const c of clusters) { const ws = c.title.split(/[\s·()（）\-—]+/).filter(Boolean); const gw = ws.find((w) => /^[A-Z]/.test(w) && w.toLowerCase() !== themeId) ?? null; if (gw) { if (!groupMap.has(gw)) groupMap.set(gw, []); groupMap.get(gw)!.push(c); } else ungrouped.push(c); }
    const groups = [...groupMap.entries()].map(([k, ps]) => ({ label: k, pages: ps }));
    if (ungrouped.length > 0) groups.push({ label: "Other", pages: ungrouped });
    const pillarKws = pillar ? (boundByPage.get(pillar.id) ?? []) : [];
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2 border-b border-manor-line/50 shrink-0 flex items-center gap-2">
          <button type="button" onClick={drillBack} className="inline-flex items-center gap-1 text-[10px] text-manor-brassDim hover:text-manor-brassHi transition-colors" style={{ fontFamily: sc }}><ZoomOut size={12} /><span className="tracking-[0.14em]">Overview</span></button>
          <ChevronRight size={10} className="text-manor-inkFaint" />
          <span className="text-[12px] text-manor-brassHi font-semibold" style={{ fontFamily: serif }}>{themeName}</span>
          <span className="flex-1" />
          <span className="text-[10px] text-manor-inkFaint tabular-nums">{clusters.length} clusters</span>
          <span className="text-[9px] text-manor-inkFaint italic ml-2">Esc = back</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-5" style={{ animation: "loom-drill-in 0.3s ease-out" }}>
          {pillar && (
            <div className="mb-6 p-4 rounded-lg border border-manor-brass/30 cursor-pointer hover:border-manor-brass/50 transition-colors" style={{ background: "linear-gradient(135deg, rgba(212,179,111,0.06) 0%, rgba(8,19,13,0.95) 100%)" }} onClick={() => onPageSelect(pillar.id)}>
              <div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-sm" style={{ background: "linear-gradient(135deg, #F8E6B0, #D4B36F)" }} /><span className="text-[14px] font-semibold text-manor-ink" style={{ fontFamily: serif }}>{shortTitle(pillar.title)}</span><StatusDot status={pillar.status} size={7} /></div>
              {pillar.url && <span className="text-[10px] font-mono text-manor-brassDim/70 block mb-1">{pillar.url}</span>}
              <span className="text-[10px] text-manor-inkDim">{pillarKws.length} keywords{pillarKws.length > 0 && ` / ${formatSv(pillarKws.reduce((s, k) => s + (k.sv ?? 0), 0))} SV`}</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {groups.map((g) => (
              <div key={g.label} className="rounded-lg border border-manor-line/40 overflow-hidden" style={{ background: "rgba(8,19,13,0.6)" }}>
                <div className="px-3 py-2 border-b border-manor-line/30" style={{ background: "rgba(212,179,111,0.04)" }}><span className="text-[12px] font-semibold text-manor-brass" style={{ fontFamily: serif }}>{g.label}</span><span className="text-[10px] text-manor-inkDim ml-2">{g.pages.length} pages</span></div>
                <div className="p-2 space-y-1">
                  {g.pages.map((c) => { const cKws = boundByPage.get(c.id) ?? []; const cSv = cKws.reduce((s, k) => s + (k.sv ?? 0), 0); const isSel = selectedPageId === c.id; return (
                    <div key={c.id} className={["flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all text-[11px]", isSel ? "bg-manor-bg3 border border-manor-brass/40" : "hover:bg-manor-bg3/50 border border-transparent"].join(" ")} onClick={() => onPageSelect(c.id)}><StatusDot status={c.status} size={6} /><span className="text-manor-ink truncate flex-1 min-w-0" style={{ fontFamily: serif }}>{shortTitle(c.title)}</span>{cSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums shrink-0">{formatSv(cSv)}</span>}</div>
                  ); })}
                  {newClusterFor === g.label ? (<div className="flex items-center gap-1 px-1 pt-1"><input autoFocus value={newClusterTitle} onChange={(e) => setNewClusterTitle(e.target.value)} placeholder="New page title..." className="h-5 px-1.5 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && newClusterTitle.trim() && pillar && onNewCluster) { onNewCluster(newClusterTitle.trim(), pillar.id); setNewClusterTitle(""); setNewClusterFor(null); } if (e.key === "Escape") setNewClusterFor(null); }} /><button type="button" onClick={() => setNewClusterFor(null)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                  ) : (<button type="button" onClick={() => setNewClusterFor(g.label)} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors"><Plus size={9} /> New page</button>)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            {addingSubPillar ? (<div className="flex items-center gap-2"><input autoFocus value={newSubPillarTitle} onChange={(e) => setNewSubPillarTitle(e.target.value)} placeholder="New sub-pillar name..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 w-40" onKeyDown={(e) => { if (e.key === "Enter" && newSubPillarTitle.trim() && pillar && onNewCluster) { onNewCluster(newSubPillarTitle.trim(), pillar.id); setNewSubPillarTitle(""); setAddingSubPillar(false); } if (e.key === "Escape") setAddingSubPillar(false); }} /><button type="button" onClick={() => setAddingSubPillar(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={10} /></button></div>
            ) : (<button type="button" onClick={() => setAddingSubPillar(true)} className="flex items-center gap-1 text-[10px] text-manor-inkFaint hover:text-manor-brassHi transition-colors border border-dashed border-manor-line2/40 rounded px-3 py-1.5 hover:border-manor-brass/40"><Plus size={10} /> New sub-pillar / type</button>)}
          </div>
          {clusters.length === 0 && <div className="text-center text-manor-inkFaint text-[12px] py-8 italic">No clusters yet</div>}
        </div>
        <style jsx>{`@keyframes loom-drill-in { from { transform: scale(0.92); opacity: 0.5; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  OVERVIEW GRID
  // ═══════════════════════════════════════════════════════════════════════
  const totalThemeCols = SCENARIO_COLS.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-2 border-b border-manor-line/50 shrink-0 flex items-center gap-2">
        <span className="text-[10px] tracking-[0.2em] text-manor-brassHi/60" style={{ fontFamily: sc }}>PLEXUS LOOM GRID</span>
        <span className="flex-1" />
        <div className="flex items-center gap-1 mr-3">
          <button type="button" onClick={zoom.zoomOut} className="w-5 h-5 flex items-center justify-center text-manor-inkDim hover:text-manor-brassHi transition-colors rounded hover:bg-manor-bg3/40" title="Zoom out"><ZoomOut size={12} /></button>
          <span className="text-[9px] text-manor-inkDim tabular-nums w-8 text-center">{Math.round(zoom.scale * 100)}%</span>
          <button type="button" onClick={zoom.zoomIn} className="w-5 h-5 flex items-center justify-center text-manor-inkDim hover:text-manor-brassHi transition-colors rounded hover:bg-manor-bg3/40" title="Zoom in"><ZoomIn size={12} /></button>
          <button type="button" onClick={zoom.reset} className="h-5 px-1.5 flex items-center justify-center gap-0.5 text-manor-inkDim hover:text-manor-brassHi transition-colors rounded hover:bg-manor-bg3/40 ml-0.5 text-[8px]" title="Reset zoom" style={{ fontFamily: sc }}><Scan size={11} /><span>Fit</span></button>
        </div>
        <span className="text-[10px] text-manor-inkFaint tabular-nums">{CATEGORY_SPINE.length} x {totalThemeCols}</span>
      </div>

      {/* Zoomable/pannable canvas */}
      <div
        ref={canvasRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        onPointerDown={zoom.handlePointerDown}
        onPointerMove={zoom.handlePointerMove}
        onPointerUp={zoom.handlePointerUp}
        style={{ cursor: "grab", userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties}
      >
        <div className="p-4 origin-top-left" style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`, transformOrigin: "0 0", willChange: zoom.isGesturing ? "transform" : "auto", minWidth: "100%", minHeight: "100%" }}>
          <div className="inline-grid gap-0" style={{ gridTemplateColumns: `120px repeat(${totalThemeCols}, minmax(150px, 1fr)) 48px`, gridTemplateRows: `auto auto repeat(${CATEGORY_SPINE.length}, minmax(auto, 1fr)) 32px`, minWidth: "100%" }}>
            {/* Row 1: Type group headers -- #2 top border */}
            <div style={{ background: "var(--color-manor-bg2, #08130D)", borderTop: gridBorder }} />
            {weftGroupsWithExtra.map((g) => (
              <div key={g.type} className="flex items-center justify-center py-2" style={{ gridColumn: `span ${g.themes.length}`, background: "var(--color-manor-bg2, #08130D)", border: gridBorder }}>
                <span className="text-[11px] tracking-[0.18em] text-manor-brassHi font-semibold" style={{ fontFamily: sc }}>{g.en}</span>
                <span className="text-[10px] text-manor-ink ml-2">{g.zh}</span>
              </div>
            ))}
            <div className="flex items-center justify-center" style={{ background: "var(--color-manor-bg2, #08130D)", borderTop: gridBorder }}>
              {!addingCol && <button type="button" onClick={() => setAddingCol(true)} className="w-6 h-6 flex items-center justify-center text-manor-inkFaint hover:text-manor-brassHi transition-colors rounded hover:bg-manor-bg3/40" title="Add scenario column"><Plus size={12} /></button>}
            </div>

            {/* Row 2: Sub-column headers */}
            <div className="flex items-end pb-1 px-2" style={{ background: "var(--color-manor-bg2, #08130D)" }}><span className="text-[8px] text-manor-inkFaint" style={{ fontFamily: sc }}>Category</span></div>
            {SCENARIO_COLS.map((col) => { const owned = scenarioOwned.get(col.id); return (
              <div key={`col-${col.id}`} className="flex flex-col items-center justify-end gap-0.5 px-2 pb-1.5 pt-1 cursor-pointer hover:bg-manor-bg3/30 transition-colors" style={{ background: "var(--color-manor-bg2, #08130D)", borderLeft: gridBorder, borderBottom: gridBorder }} onClick={() => drillInto(col.id, col.en)} title={`${col.en} ${col.zh}`}>
                <span className="text-[12px] text-manor-brassHi font-semibold leading-tight text-center" style={{ fontFamily: serif }}>{col.en}</span>
                <span className="text-[9px] text-manor-ink leading-tight">{col.zh}</span>
                {owned && owned.count > 0 && <span className="text-[8px] text-manor-inkDim tabular-nums">{owned.count} pg</span>}
              </div>
            ); })}
            <div className="flex items-center justify-center" style={{ background: "var(--color-manor-bg2, #08130D)", borderBottom: gridBorder }}>
              {addingCol && (<div className="flex flex-col items-center gap-1 p-1"><input autoFocus value={newColEn} onChange={(e) => setNewColEn(e.target.value)} placeholder="Name" className="h-5 w-10 px-1 text-[8px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink focus:outline-none" onKeyDown={(e) => { if (e.key === "Enter") addCol(); if (e.key === "Escape") setAddingCol(false); }} /><button type="button" onClick={() => setAddingCol(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={8} /></button></div>)}
            </div>

            {/* Data rows -- #1 no triangles, #2 centered + row dividers */}
            {CATEGORY_SPINE.map((cat) => {
              const catSel = selectedPageId != null && categoryStats.get(cat.id)?.pillarId === selectedPageId;
              return (
                <React.Fragment key={cat.id}>
                  {/* Row header: #2 centered text + borderBottom for row divider */}
                  <div
                    className={["flex flex-col items-center justify-center gap-0.5 px-3 py-3 cursor-pointer transition-colors", catSel ? "bg-manor-bg3" : "hover:bg-manor-bg3/40"].join(" ")}
                    style={{ background: catSel ? undefined : "var(--color-manor-bg2, #08130D)", borderRight: gridBorder, borderBottom: gridBorder }}
                    onClick={() => drillInto(cat.id, cat.en)} title={`${cat.en} ${cat.zh}`}
                  >
                    <span className="text-[13px] font-semibold leading-tight text-manor-brassHi text-center" style={{ fontFamily: serif }}>{cat.en}</span>
                    <span className="text-[9px] text-manor-ink leading-tight text-center">{cat.zh}</span>
                  </div>
                  {SCENARIO_COLS.map((scen) => {
                    const key = `${cat.id}::${scen.id}`; const cell = cells.get(key); const isGap = !cell || cell.keywords.length === 0;
                    const totalSv = cell?.totalSv ?? 0; const isCellSel = selectedPageId != null && cell?.pageIds.includes(selectedPageId); const titles = cell?.pageTitles ?? [];
                    return (
                      <div key={key} className={["relative flex flex-col items-start justify-start gap-0.5 p-2 min-h-[72px] cursor-pointer transition-all text-left", isCellSel ? "border-manor-brass/60 bg-manor-bg3" : isGap ? "hover:border-manor-brass/20 hover:bg-manor-bg3/15" : "hover:border-manor-brass/30 hover:bg-manor-bg3/20"].join(" ")} style={{ border: gridBorder }} onClick={() => { if (cell) handleCellClick(cell); }} title={isGap ? `Gap: ${cat.en} x ${scen.en}` : `${cat.en} x ${scen.en}: ${titles.length} pages, ${formatSv(totalSv)} SV`}>
                        {isGap ? (<div className="flex-1 flex flex-col items-center justify-center w-full"><span className="absolute inset-2 border border-dashed border-manor-line2/30 rounded pointer-events-none" aria-hidden /><span className="text-[14px] text-manor-inkGhost leading-none" aria-hidden>&#x25A2;</span><span className="text-[8px] text-manor-inkFaint/50 mt-0.5">gap</span></div>
                        ) : (<>
                          {titles.slice(0, 3).map((t, i) => (<div key={i} className="flex items-start gap-1.5 w-full min-w-0"><StatusDot status={t.status} size={5} /><span className="text-[10px] text-manor-ink/90 leading-tight truncate" style={{ fontFamily: serif }}>{t.title}</span></div>))}
                          {titles.length > 3 && <span className="text-[8px] text-manor-inkFaint">+{titles.length - 3} more</span>}
                          <div className="mt-auto pt-1 flex items-center gap-1.5 w-full"><span className="text-[8px] text-manor-brassDim/60 tabular-nums">{formatSv(totalSv)}</span><span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, rgba(212,179,111,${Math.min(0.4, totalSv / 10000)}) 0%, transparent 100%)` }} /></div>
                        </>)}
                        {isCellSel && <span className="absolute inset-0 border-2 border-manor-brass/60 pointer-events-none" style={{ boxShadow: "0 0 10px rgba(239,216,154,.25)" }} aria-hidden />}
                      </div>
                    );
                  })}
                  <div style={{ border: gridBorder }} />
                </React.Fragment>
              );
            })}

            {/* + row */}
            <div className="flex items-center justify-center" style={{ background: "var(--color-manor-bg2, #08130D)" }}>{!addingRow && <button type="button" onClick={() => setAddingRow(true)} className="text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors flex items-center gap-0.5" title="Add category row"><Plus size={10} /> Row</button>}</div>
            {addingRow ? (<div className="flex items-center gap-2 px-2" style={{ gridColumn: `2 / -1` }}><input autoFocus value={newRowEn} onChange={(e) => setNewRowEn(e.target.value)} placeholder="English..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none w-28" onKeyDown={(e) => { if (e.key === "Enter") addRow(); if (e.key === "Escape") setAddingRow(false); }} /><input value={newRowZh} onChange={(e) => setNewRowZh(e.target.value)} placeholder="Chinese..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none w-20" onKeyDown={(e) => { if (e.key === "Enter") addRow(); if (e.key === "Escape") setAddingRow(false); }} /><button type="button" onClick={addRow} className="text-[9px] text-manor-sageHi">OK</button><button type="button" onClick={() => setAddingRow(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={10} /></button></div>
            ) : (<>{SCENARIO_COLS.map((_, i) => <div key={`p${i}`} />)}<div /></>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 px-1">
            <div className="flex items-center gap-3 text-[10px] text-manor-inkDim">
              <span className="inline-flex items-center gap-1"><StatusDot status="live" size={6} /><span>Live</span></span>
              <span className="inline-flex items-center gap-1"><StatusDot status="optimize" size={6} /><span>Optimize</span></span>
              <span className="inline-flex items-center gap-1"><StatusDot status="gap" size={6} /><span>Gap</span></span>
            </div>
            <span className="text-[9px] text-manor-inkFaint italic ml-auto">Scroll/pinch to zoom / drag to pan</span>
          </div>
        </div>
      </div>
    </div>
  );
}
