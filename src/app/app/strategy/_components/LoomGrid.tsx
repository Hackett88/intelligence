"use client";

/**
 * LoomGrid v2.8 -- Excel-style reorder + add 大列/小列.
 *
 * v2.8: rows (品类经线) and 大列 (类型带 = WeftType) are now full mutable state,
 *       persisted to localStorage. Drag a row's grip (vertical) or a band's grip
 *       (horizontal) to reorder -- live reorder via document.elementFromPoint, so it
 *       works under the zoom/pan transform. Two distinct add affordances:
 *       per-band「+小列」(add a theme into that band) and a trailing「+大列」(add a band).
 *       Empty bands render a placeholder column so the spanning header never collapses.
 */
import * as React from "react";
import { Plus, X, ChevronRight, ChevronDown, ZoomOut, ZoomIn, Scan, GripVertical, GripHorizontal } from "lucide-react";
import type { WbPage, RawKeyword, Territory, IndexedMatches } from "./_workbench";
import { effectiveStatus } from "./_workbench";
import { StatusDot, RoleMark, formatSv } from "./_utils";

// ── Constants ───────────────────────────────────────────────────────────────

type SpineEntry = { id: string; en: string; zh: string };
const CATEGORY_SPINE_DEFAULT: SpineEntry[] = [
  // 念诵知识行：行头不显示名（en/zh 留空），仅 ◆pillar 标记 + 数据
  { id: "dhikr-knowledge", en: "", zh: "" },
  { id: "islamic-jewelry", en: "Islamic Jewelry", zh: "伊斯兰饰品" },
  { id: "name-necklace", en: "Name Necklace", zh: "定制项链" },
  { id: "tasbih", en: "Tasbih", zh: "念珠" },
  { id: "zikr-ring", en: "Zikr Ring", zh: "智能念珠戒指" },
];
type WeftType = { type: string; en: string; zh: string; themes: SpineEntry[] };
const WEFT_GROUPS: WeftType[] = [
  { type: "knowledge", en: "Knowledge", zh: "知识", themes: [
    { id: "knowledge-dhikr", en: "Dhikr", zh: "念诵" },
  ]},
  { type: "scenario", en: "Scenario", zh: "场景", themes: [
    { id: "slow-living", en: "Slow Living", zh: "慢生活" },
    { id: "muslim-gifts", en: "Gifts", zh: "送礼" },
  ]},
  { type: "tool", en: "Tool", zh: "工具", themes: [
    { id: "qibla-finder", en: "Qibla", zh: "朝向" },
    { id: "itasbih-tools", en: "APP", zh: "应用" },
  ]},
  { type: "brand", en: "Brand", zh: "品牌", themes: [
    { id: "brand", en: "Weslamic", zh: "品牌名称" },
  ]},
];
// ── Helpers ────────────────────────────────────────────────────────────────

function shortTitle(title: string): string { return title.split(/[（(]/)[0].replace(/[·\-—]+$/, "").trim(); }

// ── Structure persistence + reorder helpers ──────────────────────────────────
const STRUCT_KEY = "wb-loom-structure-v4";
type LoomStructure = { rows: SpineEntry[]; bands: WeftType[] };
// 内置大列/子列的标签（en/zh）以代码 WEFT_GROUPS 为准——它们没有改名 UI，只能拖动/新增，
// 所以加载旧 localStorage 时按 id 对齐刷新内置项的标签（用户的换位/新增列保持不动）。
const BUILTIN_BAND_LABELS = new Map(WEFT_GROUPS.map((b) => [b.type, { en: b.en, zh: b.zh }] as const));
const BUILTIN_THEME_LABELS = new Map(
  WEFT_GROUPS.flatMap((b) => b.themes.map((t) => [t.id, { en: t.en, zh: t.zh }] as const)),
);
function reconcileBuiltinLabels(bands: WeftType[]): WeftType[] {
  return bands.map((b) => {
    const band = BUILTIN_BAND_LABELS.get(b.type);
    return {
      ...b,
      ...(band ?? {}),
      themes: b.themes.map((t) => ({ ...t, ...(BUILTIN_THEME_LABELS.get(t.id) ?? {}) })),
    };
  });
}
// 内置品类行同理：旧 localStorage 缺的内置行按 id 并入（新增行插到行首，保留用户已有排序），
// 并以代码 CATEGORY_SPINE_DEFAULT 刷新内置行标签。用户自建行（非内置 id）原样保留。
function reconcileRows(rows: SpineEntry[]): SpineEntry[] {
  const existing = new Set(rows.map((r) => r.id));
  const missing = CATEGORY_SPINE_DEFAULT.filter((r) => !existing.has(r.id));
  const refreshed = rows.map((r) => {
    const def = CATEGORY_SPINE_DEFAULT.find((d) => d.id === r.id);
    return def ? { ...r, en: def.en, zh: def.zh } : r;
  });
  return [...missing, ...refreshed];
}
function loadStructure(): LoomStructure | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STRUCT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d?.rows) || !Array.isArray(d?.bands)) return null;
    return { rows: reconcileRows(d.rows), bands: reconcileBuiltinLabels(d.bands) };
  } catch { return null; }
}
/** 把 dragId 项移动到 overId 项所在位置（不变则原数组返回，避免无谓重渲）。 */
function moveById<T>(arr: T[], dragId: string | null, overId: string, keyFn: (t: T) => string): T[] {
  if (!dragId || dragId === overId) return arr;
  const from = arr.findIndex((x) => keyFn(x) === dragId);
  const to = arr.findIndex((x) => keyFn(x) === overId);
  if (from < 0 || to < 0 || from === to) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── Column-width / row-height persistence ────────────────────────────────────
// v2: 列宽语义从「minmax 上限（仅自由空间富余时生效）」改为「固定宽（权威，网格溢出可平移）」，
// 旧 v1 存的是上限值，按固定宽解读会让窄列误截内容，故升版丢弃旧值、从自适应重新开始。
const SIZES_KEY = "wb-loom-sizes-v2";
const CAT_COL_KEY = "__cat__"; // 行头那一列（品类列）的宽度键
const MIN_COL_W = 60;
const MIN_ROW_H = 44;
type LoomSizes = { colWidths: Record<string, number>; rowHeights: Record<string, number> };
function loadSizes(): LoomSizes | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIZES_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d?.colWidths !== "object" || typeof d?.rowHeights !== "object") return null;
    return d as LoomSizes;
  } catch { return null; }
}

// ── Types ──────────────────────────────────────────────────────────────────

type CellSubPillar = {
  id: string; title: string; status: "live" | "optimize" | "gap";
  clusters: { id: string; title: string; status: "live" | "optimize" | "gap" }[];
};
type CellData = {
  categoryId: string; scenarioId: string; totalSv: number;
  bestStatus: "live" | "optimize" | "gap"; pageIds: string[];
  subPillars: CellSubPillar[];
  /** 落进本格的子支柱数量 */
  subCount: number;
  /** 所有爸爸的孙子数之和 */
  clusterCount: number;
};
/** 渲染列：实际场景列(theme) 或 空带占位列(placeholder)。空带占 1 列、不进数据交叉。 */
type RenderCol = { kind: "theme"; bandType: string; theme: SpineEntry } | { kind: "placeholder"; bandType: string };
/** 每个渲染列的宽度键：真实场景列用 theme.id，空带占位列用 ph:<bandType>。 */
function colKeyOf(rc: RenderCol): string { return rc.kind === "theme" ? rc.theme.id : `ph:${rc.bandType}`; }
type DrillLevel =
  | { type: "overview" }
  | { type: "pillar"; themeId: string; themeName: string }
  | { type: "cell"; categoryId: string; categoryName: string; scenarioId: string; scenarioName: string };
interface LoomGridProps {
  pages: WbPage[];
  boundByPage: Map<string, RawKeyword[]>;
  indexedMatches: IndexedMatches;
  selectedPageId: string | null;
  onPageSelect: (id: string) => void;
  onNewCluster?: (title: string, pillarId: string, role?: "cluster" | "sub-pillar", scenarioId?: string) => void;
  onNewPillar?: (title: string, territory: Territory) => void;
}

// ── Zoom/Pan Hook ─────────────────────────────────────────────────────────
// native wheel listener for passive:false (trackpad pinch sends ctrlKey+wheel)
// drag from anywhere with threshold -- no cell exclusion

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

  // Ref that always holds the latest {scale,tx,ty} so the wheel handler
  // can read without depending on stale closures or nesting setStates.
  const viewRef = React.useRef({ scale, tx, ty });
  viewRef.current = { scale, tx, ty };

  // native wheel listener with { passive: false } to intercept trackpad pinch
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

        const { scale: prevScale, tx: ptx, ty: pty } = viewRef.current;
        const next = Math.max(0.4, Math.min(2.0, prevScale - e.deltaY * 0.003));
        const ratio = next / prevScale;
        const ntx = mx - ratio * (mx - ptx);
        const nty = my - ratio * (my - pty);

        setScale(next);
        setTx(ntx);
        setTy(nty);
        viewRef.current = { scale: next, tx: ntx, ty: nty };
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [canvasRef]);

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Don't pan from buttons/inputs (grips are <button>, so reorder drags never start a pan)
    const el = e.target as HTMLElement;
    if (el.closest("button") || el.closest("input")) return;
    isPanning.current = true;
    didDrag.current = false;
    pointerId.current = e.pointerId;
    panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
  }, [tx, ty]);

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isPanning.current || e.pointerId !== pointerId.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (!didDrag.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!didDrag.current) {
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
    if (wasDrag) {
      document.body.style.userSelect = "";
      (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
      setIsGesturing(false);
    }
    if (wasDrag) {
      const container = e.currentTarget as HTMLElement;
      const suppress = (ce: Event) => { ce.stopPropagation(); ce.preventDefault(); };
      container.addEventListener("click", suppress, { capture: true, once: true });
      setTimeout(() => container.removeEventListener("click", suppress, { capture: true }), 200);
    }
  }, []);

  const reset = React.useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);
  const zoomIn = React.useCallback(() => setScale((s) => Math.min(2.0, s + 0.15)), []);
  const zoomOut = React.useCallback(() => setScale((s) => Math.max(0.4, s - 0.15)), []);

  return { scale, tx, ty, isGesturing, isPanning, handlePointerDown, handlePointerMove, handlePointerUp, reset, zoomIn, zoomOut };
}

// ── Component ──────────────────────────────────────────────────────────────

export function LoomGrid({ pages, boundByPage, indexedMatches, selectedPageId, onPageSelect, onNewCluster, onNewPillar }: LoomGridProps) {
  void onNewPillar; // reserved for future direct-pillar creation from grid
  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";
  const gridBorder = "1px solid rgba(212,179,111,0.26)";
  const headerBg = "var(--color-manor-bg2, #08130D)";

  // ── Structure state (rows = 品类经线; bands = 场景类型大列). Persisted to localStorage. ──
  const [rows, setRows] = React.useState<SpineEntry[]>(() => loadStructure()?.rows ?? CATEGORY_SPINE_DEFAULT.map((r) => ({ ...r })));
  const [bands, setBands] = React.useState<WeftType[]>(() => loadStructure()?.bands ?? WEFT_GROUPS.map((b) => ({ ...b, themes: b.themes.map((t) => ({ ...t })) })));
  React.useEffect(() => {
    try { window.localStorage.setItem(STRUCT_KEY, JSON.stringify({ rows, bands })); } catch { /* quota / unavailable */ }
  }, [rows, bands]);

  // ── Column-width / row-height overrides (拖拽改尺寸；为空 = 自适应)。Persisted. ──
  const [colWidths, setColWidths] = React.useState<Record<string, number>>(() => loadSizes()?.colWidths ?? {});
  const [rowHeights, setRowHeights] = React.useState<Record<string, number>>(() => loadSizes()?.rowHeights ?? {});
  React.useEffect(() => {
    try { window.localStorage.setItem(SIZES_KEY, JSON.stringify({ colWidths, rowHeights })); } catch { /* quota / unavailable */ }
  }, [colWidths, rowHeights]);

  // ── Add-entry UI state ──
  const [addingRow, setAddingRow] = React.useState(false);
  const [newRowEn, setNewRowEn] = React.useState(""); const [newRowZh, setNewRowZh] = React.useState("");
  const [addingBand, setAddingBand] = React.useState(false);
  const [newBandEn, setNewBandEn] = React.useState(""); const [newBandZh, setNewBandZh] = React.useState("");
  const [addingThemeFor, setAddingThemeFor] = React.useState<string | null>(null); // band.type
  const [newThemeEn, setNewThemeEn] = React.useState(""); const [newThemeZh, setNewThemeZh] = React.useState("");
  const _uid = React.useRef(0);

  function addRow() { if (!newRowEn.trim()) return; setRows((p) => [...p, { id: `user-cat-${_uid.current++}`, en: newRowEn.trim(), zh: newRowZh.trim() || newRowEn.trim() }]); setNewRowEn(""); setNewRowZh(""); setAddingRow(false); }
  function addBand() { if (!newBandEn.trim()) return; setBands((p) => [...p, { type: `user-band-${_uid.current++}`, en: newBandEn.trim(), zh: newBandZh.trim() || newBandEn.trim(), themes: [] }]); setNewBandEn(""); setNewBandZh(""); setAddingBand(false); }
  function addTheme(bandType: string) { if (!newThemeEn.trim()) return; setBands((p) => p.map((b) => b.type === bandType ? { ...b, themes: [...b.themes, { id: `user-scn-${_uid.current++}`, en: newThemeEn.trim(), zh: newThemeZh.trim() || newThemeEn.trim() }] } : b)); setNewThemeEn(""); setNewThemeZh(""); setAddingThemeFor(null); }

  // ── Drag-to-reorder (rows vertical / bands horizontal). Live reorder via elementFromPoint ──
  const dragKind = React.useRef<null | "row" | "band" | "theme">(null);
  const dragPointerId = React.useRef<number | null>(null);
  const dragIdRef = React.useRef<string | null>(null);
  const dragBandRef = React.useRef<string | null>(null); // 小列拖拽时锁定所属大列，禁止跨带
  const [dragId, setDragId] = React.useState<string | null>(null); // visual feedback only

  const startDrag = React.useCallback((kind: "row" | "band" | "theme", id: string, bandType?: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    dragKind.current = kind; dragPointerId.current = e.pointerId; dragIdRef.current = id; dragBandRef.current = bandType ?? null; setDragId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.style.userSelect = "none";
  }, []);
  const onDragMove = React.useCallback((e: React.PointerEvent) => {
    if (dragKind.current === null || e.pointerId !== dragPointerId.current) return;
    e.stopPropagation();
    const sel = dragKind.current === "row" ? "[data-row-id]" : dragKind.current === "band" ? "[data-band-type]" : "[data-theme-id]";
    const overEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(sel) as HTMLElement | null;
    if (!overEl) return;
    if (dragKind.current === "row") {
      const overId = overEl.getAttribute("data-row-id"); if (!overId) return;
      setRows((prev) => moveById(prev, dragIdRef.current, overId, (r) => r.id));
    } else if (dragKind.current === "band") {
      const overType = overEl.getAttribute("data-band-type"); if (!overType) return;
      setBands((prev) => moveById(prev, dragIdRef.current, overType, (b) => b.type));
    } else {
      // 小列：仅在所属大列内换位 —— 落到别的带上不动
      const overId = overEl.getAttribute("data-theme-id");
      const overBand = overEl.getAttribute("data-theme-band");
      if (!overId || overBand !== dragBandRef.current || overId === dragIdRef.current) return;
      setBands((prev) => prev.map((b) => b.type === dragBandRef.current
        ? { ...b, themes: moveById(b.themes, dragIdRef.current, overId, (t) => t.id) }
        : b));
    }
  }, []);
  const endDrag = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== dragPointerId.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragKind.current = null; dragPointerId.current = null; dragIdRef.current = null; dragBandRef.current = null; setDragId(null);
    document.body.style.userSelect = "";
  }, []);

  // ── Drill-down state ──
  const [drillStack, setDrillStack] = React.useState<DrillLevel[]>([{ type: "overview" }]);
  const currentLevel = drillStack[drillStack.length - 1];
  const [newClusterFor, setNewClusterFor] = React.useState<string | null>(null);
  const [newClusterTitle, setNewClusterTitle] = React.useState("");
  const [addingSubPillar, setAddingSubPillar] = React.useState(false);
  const [newSubPillarTitle, setNewSubPillarTitle] = React.useState("");
  const [collapsedSubs, setCollapsedSubs] = React.useState<Set<string>>(new Set());
  const toggleSub = React.useCallback((id: string) => {
    setCollapsedSubs((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  function drillInto(themeId: string, themeName: string) { setDrillStack((s) => [...s, { type: "pillar", themeId, themeName }]); }
  function drillBack() { setDrillStack((s) => (s.length > 1 ? s.slice(0, -1) : s)); }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && drillStack.length > 1) { e.preventDefault(); drillBack(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [drillStack.length]);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const zoom = useZoomPan(canvasRef);

  // ── Drag-to-resize (列宽 / 行高)。手柄落在表头格右缘/行头格下缘。 ──
  // 网格整体被 scale(zoom) 变换过，所以屏幕位移要除以 scale 才是网格空间的真实增量。
  // 这些是 React 事件处理器（每次渲染重挂），直接闭包读 zoom.scale 即可拿到最新值，不用 ref。
  const resizeRef = React.useRef<null | { kind: "col" | "row"; key: string; startPos: number; startSize: number; pointerId: number }>(null);
  const startResize = React.useCallback((kind: "col" | "row", key: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    // 手柄是表头格/行头格的直接子元素 —— 量它的父元素即得该列/行当前渲染尺寸（首拖时把自适应值固化下来）。
    const rect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    const scale = zoom.scale || 1;
    const startSize = rect ? (kind === "col" ? rect.width : rect.height) / scale : (kind === "col" ? MIN_COL_W : MIN_ROW_H);
    resizeRef.current = { kind, key, startPos: kind === "col" ? e.clientX : e.clientY, startSize, pointerId: e.pointerId };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.style.userSelect = "none";
  }, [zoom.scale]);
  const onResizeMove = React.useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current; if (!r || e.pointerId !== r.pointerId) return;
    e.stopPropagation();
    const scale = zoom.scale || 1;
    const delta = ((r.kind === "col" ? e.clientX : e.clientY) - r.startPos) / scale;
    const next = Math.round(Math.max(r.kind === "col" ? MIN_COL_W : MIN_ROW_H, r.startSize + delta));
    if (r.kind === "col") setColWidths((p) => (p[r.key] === next ? p : { ...p, [r.key]: next }));
    else setRowHeights((p) => (p[r.key] === next ? p : { ...p, [r.key]: next }));
  }, [zoom.scale]);
  const endResize = React.useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current; if (!r || e.pointerId !== r.pointerId) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    resizeRef.current = null;
    document.body.style.userSelect = "";
  }, []);
  const clearSize = React.useCallback((kind: "col" | "row", key: string) => {
    if (kind === "col") setColWidths((p) => { if (p[key] == null) return p; const n = { ...p }; delete n[key]; return n; });
    else setRowHeights((p) => { if (p[key] == null) return p; const n = { ...p }; delete n[key]; return n; });
  }, []);

  // ── Derived columns: flat scenario list + render list (with placeholders for empty bands) ──
  const renderCols = React.useMemo<RenderCol[]>(
    () => bands.flatMap((b): RenderCol[] => (b.themes.length
      ? b.themes.map((t) => ({ kind: "theme" as const, bandType: b.type, theme: t }))
      : [{ kind: "placeholder" as const, bandType: b.type }])),
    [bands]
  );
  const SCENARIO_COLS = React.useMemo(
    () => renderCols.flatMap((c) => (c.kind === "theme" ? [c.theme] : [])),
    [renderCols]
  );
  const totalThemeCols = renderCols.length;

  // Derived data
  const pagesByTheme = React.useMemo(() => { const m = new Map<string, WbPage[]>(); for (const p of pages) { if (!m.has(p.themeId)) m.set(p.themeId, []); m.get(p.themeId)!.push(p); } return m; }, [pages]);
  const scenarioOwned = React.useMemo(() => { const m = new Map<string, { count: number; pillarId: string | null }>(); for (const col of SCENARIO_COLS) { const sp = pagesByTheme.get(col.id) ?? []; m.set(col.id, { count: sp.length, pillarId: sp.find((p) => p.role === "pillar")?.id ?? null }); } return m; }, [pagesByTheme, SCENARIO_COLS]);
  const cells = React.useMemo(() => {
    const grid = new Map<string, CellData>();
    for (const cat of rows) {
      for (const scen of SCENARIO_COLS) {
        // 格子 = 品类(行) x 场景(列) 的坑位里的所有子支柱（按 scenarioId 坐标取数）
        const cellSubs = pages.filter(
          (p) => p.role === "sub-pillar" && p.themeId === cat.id && p.scenarioId === scen.id
        );
        // 子树 SV：每个爸爸自身 + 它的 children cluster 的绑定词 SV
        let totalSv = 0;
        const allStatuses: ("live" | "optimize" | "gap")[] = [];
        for (const sp of cellSubs) {
          // 爸爸自身的绑定词 SV
          for (const k of (boundByPage.get(sp.id) ?? [])) totalSv += k.sv ?? 0;
          allStatuses.push(effectiveStatus(sp.url, sp.status, indexedMatches));
          // 爸爸的 children (cluster)
          const children = pages.filter((p) => p.role === "cluster" && p.pillarId === sp.id);
          for (const ch of children) {
            for (const k of (boundByPage.get(ch.id) ?? [])) totalSv += k.sv ?? 0;
            allStatuses.push(effectiveStatus(ch.url, ch.status, indexedMatches));
          }
        }
        const bs: "live" | "optimize" | "gap" = allStatuses.some((s) => s === "live") ? "live" : allStatuses.some((s) => s === "optimize") ? "optimize" : "gap";
        // 构建嵌套结构：每个爸爸带上它的孙子
        let clusterCount = 0;
        const sps: CellSubPillar[] = cellSubs.map((sp) => {
          const children = pages.filter((p) => p.role === "cluster" && p.pillarId === sp.id);
          clusterCount += children.length;
          return {
            id: sp.id, title: shortTitle(sp.title), status: effectiveStatus(sp.url, sp.status, indexedMatches),
            clusters: children.map((c) => ({ id: c.id, title: shortTitle(c.title), status: effectiveStatus(c.url, c.status, indexedMatches) })),
          };
        });
        grid.set(`${cat.id}::${scen.id}`, {
          categoryId: cat.id, scenarioId: scen.id, totalSv, bestStatus: bs,
          pageIds: cellSubs.map((sp) => sp.id), subPillars: sps, subCount: cellSubs.length, clusterCount,
        });
      }
    }
    return grid;
  }, [rows, SCENARIO_COLS, pages, boundByPage, indexedMatches]);
  const categoryStats = React.useMemo(() => { const m = new Map<string, { pillarId: string | null }>(); for (const cat of rows) { const cp = (pagesByTheme.get(cat.id) ?? []).find((p) => p.role === "pillar"); m.set(cat.id, { pillarId: cp?.id ?? null }); } return m; }, [rows, pagesByTheme]);

  // ═══════════════════════════════════════════════════════════════════════
  //  DRILL-DOWN VIEW
  // ═══════════════════════════════════════════════════════════════════════
  if (currentLevel.type === "pillar") {
    const { themeId, themeName } = currentLevel;
    const themePages = pagesByTheme.get(themeId) ?? [];
    const pillar = themePages.find((p) => p.role === "pillar");
    const subPillars = themePages.filter((p) => p.role === "sub-pillar");
    const allClusters = themePages.filter((p) => p.role === "cluster");
    const childrenOf = (parentId: string) => allClusters.filter((c) => c.pillarId === parentId);
    const directClusters = pillar ? allClusters.filter((c) => c.pillarId === pillar.id) : allClusters;
    const pillarKws = pillar ? (boundByPage.get(pillar.id) ?? []) : [];
    const totalChildren = subPillars.length + allClusters.length;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2 border-b border-manor-line/50 shrink-0 flex items-center gap-2">
          <button type="button" onClick={drillBack} className="inline-flex items-center gap-1 text-[10px] text-manor-brassDim hover:text-manor-brassHi transition-colors" style={{ fontFamily: sc }}><ZoomOut size={12} /><span className="tracking-[0.14em]">Overview</span></button>
          <ChevronRight size={10} className="text-manor-inkFaint" />
          <span className="text-[12px] text-manor-brassHi font-semibold" style={{ fontFamily: serif }}>{themeName}</span>
          <span className="flex-1" />
          <span className="text-[10px] text-manor-inkFaint tabular-nums">{subPillars.length > 0 ? `${subPillars.length} sub-pillars · ` : ""}{allClusters.length} clusters</span>
          <span className="text-[9px] text-manor-inkFaint italic ml-2">Esc = back</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-5" style={{ animation: "loom-drill-in 0.3s ease-out" }}>
          {/* Pillar card (grandpa) */}
          {pillar && (
            <div className="mb-6 p-4 rounded-lg border border-manor-brass/30 cursor-pointer hover:border-manor-brass/50 transition-colors" style={{ background: "linear-gradient(135deg, rgba(212,179,111,0.06) 0%, rgba(8,19,13,0.95) 100%)" }} onClick={() => onPageSelect(pillar.id)}>
              <div className="flex items-center gap-2 mb-1"><RoleMark role="pillar" size={9} /><span className="text-[14px] font-semibold text-manor-ink" style={{ fontFamily: serif }}>{shortTitle(pillar.title)}</span><StatusDot status={pillar.status} size={7} /></div>
              {pillar.url && <span className="text-[10px] font-mono text-manor-brassDim/70 block mb-1">{pillar.url}</span>}
              <span className="text-[10px] text-manor-inkDim">{pillarKws.length} keywords{pillarKws.length > 0 && ` / ${formatSv(pillarKws.reduce((s, k) => s + (k.sv ?? 0), 0))} SV`}</span>
            </div>
          )}

          {/* Sub-pillar cards (dad) with their children (grandkids) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {subPillars.map((sp) => {
              const spKws = boundByPage.get(sp.id) ?? [];
              const spSv = spKws.reduce((s, k) => s + (k.sv ?? 0), 0);
              const children = childrenOf(sp.id);
              const isSpSel = selectedPageId === sp.id;
              return (
                <div key={sp.id} className="rounded-lg border border-manor-line/40 overflow-hidden" style={{ background: "rgba(8,19,13,0.6)" }}>
                  {/* Sub-pillar header (clickable to select in Inspector) */}
                  <div
                    className={["px-3 py-2.5 border-b border-manor-line/30 cursor-pointer transition-colors", isSpSel ? "bg-manor-bg3" : "hover:bg-manor-bg3/40"].join(" ")}
                    style={{ background: isSpSel ? undefined : "rgba(212,179,111,0.06)" }}
                    onClick={() => onPageSelect(sp.id)}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <RoleMark role="sub-pillar" size={8} />
                      <span className="text-[12px] font-semibold text-manor-brassHi" style={{ fontFamily: serif }}>{shortTitle(sp.title)}</span>
                      <StatusDot status={sp.status} size={6} />
                    </div>
                    {sp.url && <span className="text-[9px] font-mono text-manor-brassDim/60 block">{sp.url}</span>}
                    <div className="flex items-center gap-2 mt-0.5">
                      {spSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums">{formatSv(spSv)} SV</span>}
                      <span className="text-[9px] text-manor-inkFaint">{spKws.length} kw</span>
                      <span className="text-[9px] text-manor-inkFaint">{children.length} pages</span>
                    </div>
                  </div>
                  {/* Children list */}
                  <div className="p-2 space-y-1">
                    {children.map((c) => { const cKws = boundByPage.get(c.id) ?? []; const cSv = cKws.reduce((s, k) => s + (k.sv ?? 0), 0); const isSel = selectedPageId === c.id; return (
                      <div key={c.id} className={["flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all text-[11px]", isSel ? "bg-manor-bg3 border border-manor-brass/40" : "hover:bg-manor-bg3/50 border border-transparent"].join(" ")} onClick={() => onPageSelect(c.id)}><StatusDot status={c.status} size={6} /><span className="text-manor-ink truncate flex-1 min-w-0" style={{ fontFamily: serif }}>{shortTitle(c.title)}</span>{cSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums shrink-0">{formatSv(cSv)}</span>}</div>
                    ); })}
                    {/* + add child cluster under this sub-pillar */}
                    {newClusterFor === sp.id ? (<div className="flex items-center gap-1 px-1 pt-1"><input autoFocus value={newClusterTitle} onChange={(e) => setNewClusterTitle(e.target.value)} placeholder="New page title..." className="h-5 px-1.5 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && newClusterTitle.trim() && onNewCluster) { onNewCluster(newClusterTitle.trim(), sp.id); setNewClusterTitle(""); setNewClusterFor(null); } if (e.key === "Escape") setNewClusterFor(null); }} /><button type="button" onClick={() => setNewClusterFor(null)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                    ) : (<button type="button" onClick={() => setNewClusterFor(sp.id)} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors"><Plus size={9} /> New page</button>)}
                  </div>
                </div>
              );
            })}

            {/* Direct clusters (orphans attached directly to pillar, no sub-pillar parent) */}
            {directClusters.length > 0 && (
              <div className="rounded-lg border border-manor-line/40 overflow-hidden" style={{ background: "rgba(8,19,13,0.6)" }}>
                <div className="px-3 py-2 border-b border-manor-line/30" style={{ background: "rgba(212,179,111,0.02)" }}>
                  <span className="text-[12px] font-semibold text-manor-brass/70" style={{ fontFamily: serif }}>Direct Pages</span>
                  <span className="text-[10px] text-manor-inkDim ml-2">{directClusters.length} pages</span>
                </div>
                <div className="p-2 space-y-1">
                  {directClusters.map((c) => { const cKws = boundByPage.get(c.id) ?? []; const cSv = cKws.reduce((s, k) => s + (k.sv ?? 0), 0); const isSel = selectedPageId === c.id; return (
                    <div key={c.id} className={["flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all text-[11px]", isSel ? "bg-manor-bg3 border border-manor-brass/40" : "hover:bg-manor-bg3/50 border border-transparent"].join(" ")} onClick={() => onPageSelect(c.id)}><StatusDot status={c.status} size={6} /><span className="text-manor-ink truncate flex-1 min-w-0" style={{ fontFamily: serif }}>{shortTitle(c.title)}</span>{cSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums shrink-0">{formatSv(cSv)}</span>}</div>
                  ); })}
                  {/* + add page under pillar directly */}
                  {newClusterFor === "__direct__" ? (<div className="flex items-center gap-1 px-1 pt-1"><input autoFocus value={newClusterTitle} onChange={(e) => setNewClusterTitle(e.target.value)} placeholder="New page title..." className="h-5 px-1.5 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && newClusterTitle.trim() && pillar && onNewCluster) { onNewCluster(newClusterTitle.trim(), pillar.id); setNewClusterTitle(""); setNewClusterFor(null); } if (e.key === "Escape") setNewClusterFor(null); }} /><button type="button" onClick={() => setNewClusterFor(null)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                  ) : (<button type="button" onClick={() => setNewClusterFor("__direct__")} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors"><Plus size={9} /> New page</button>)}
                </div>
              </div>
            )}
          </div>

          {/* + add a new sub-pillar */}
          <div className="mt-4">
            {addingSubPillar ? (<div className="flex items-center gap-2"><input autoFocus value={newSubPillarTitle} onChange={(e) => setNewSubPillarTitle(e.target.value)} placeholder="New sub-pillar name..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 w-40" onKeyDown={(e) => { if (e.key === "Enter" && newSubPillarTitle.trim() && pillar && onNewCluster) { onNewCluster(newSubPillarTitle.trim(), pillar.id, "sub-pillar"); setNewSubPillarTitle(""); setAddingSubPillar(false); } if (e.key === "Escape") setAddingSubPillar(false); }} /><button type="button" onClick={() => setAddingSubPillar(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={10} /></button></div>
            ) : (<button type="button" onClick={() => setAddingSubPillar(true)} className="flex items-center gap-1 text-[10px] text-manor-inkFaint hover:text-manor-brassHi transition-colors border border-dashed border-manor-line2/40 rounded px-3 py-1.5 hover:border-manor-brass/40"><Plus size={10} /> New sub-pillar</button>)}
          </div>
          {totalChildren === 0 && <div className="text-center text-manor-inkFaint text-[12px] py-8 italic">No clusters yet</div>}
        </div>
        <style jsx>{`@keyframes loom-drill-in { from { transform: scale(0.92); opacity: 0.5; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CELL DRILL-DOWN VIEW (品类 x 场景 格子下钻)
  // ═══════════════════════════════════════════════════════════════════════
  if (currentLevel.type === "cell") {
    const { categoryId, categoryName, scenarioId: cellScenarioId, scenarioName } = currentLevel;
    const cellSubs = pages.filter(
      (p) => p.role === "sub-pillar" && p.themeId === categoryId && p.scenarioId === cellScenarioId
    );
    const allClusters = pages.filter((p) => p.role === "cluster" && p.themeId === categoryId);
    const childrenOf = (parentId: string) => allClusters.filter((c) => c.pillarId === parentId);
    // 该品类的 pillar（用于创建新爸爸时指定 parentId）
    const catPillar = pages.find((p) => p.role === "pillar" && p.themeId === categoryId);

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2 border-b border-manor-line/50 shrink-0 flex items-center gap-2">
          <button type="button" onClick={drillBack} className="inline-flex items-center gap-1 text-[10px] text-manor-brassDim hover:text-manor-brassHi transition-colors" style={{ fontFamily: sc }}><ZoomOut size={12} /><span className="tracking-[0.14em]">Overview</span></button>
          <ChevronRight size={10} className="text-manor-inkFaint" />
          <span className="text-[12px] text-manor-brassHi font-semibold" style={{ fontFamily: serif }}>{categoryName}</span>
          <span className="text-[10px] text-manor-inkFaint mx-1">&times;</span>
          <span className="text-[12px] text-manor-brassHi font-semibold" style={{ fontFamily: serif }}>{scenarioName}</span>
          <span className="flex-1" />
          <span className="text-[10px] text-manor-inkFaint tabular-nums">{cellSubs.length} sub-pillars</span>
          <span className="text-[9px] text-manor-inkFaint italic ml-2">Esc = back</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-5" style={{ animation: "loom-drill-in 0.3s ease-out" }}>
          {cellSubs.length === 0 ? (
            /* 空格态 */
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <span className="text-[40px] text-manor-inkGhost leading-none" aria-hidden>&#x25A2;</span>
              <span className="text-[13px] text-manor-inkDim" style={{ fontFamily: serif }}>
                {categoryName} &times; {scenarioName} -- 尚无子支柱
              </span>
              <span className="text-[11px] text-manor-inkFaint italic">这是一个 Gap 坑位，可以在下方添加第一个子支柱来占位</span>
            </div>
          ) : (
            /* 爸爸卡列表 */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cellSubs.map((sp) => {
                const spKws = boundByPage.get(sp.id) ?? [];
                const spSv = spKws.reduce((s, k) => s + (k.sv ?? 0), 0);
                const children = childrenOf(sp.id);
                const isSpSel = selectedPageId === sp.id;
                return (
                  <div key={sp.id} className="rounded-lg border border-manor-line/40 overflow-hidden" style={{ background: "rgba(8,19,13,0.6)" }}>
                    {/* Sub-pillar header */}
                    <div
                      className={["px-3 py-2.5 border-b border-manor-line/30 cursor-pointer transition-colors", isSpSel ? "bg-manor-bg3" : "hover:bg-manor-bg3/40"].join(" ")}
                      style={{ background: isSpSel ? undefined : "rgba(212,179,111,0.06)" }}
                      onClick={() => onPageSelect(sp.id)}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <RoleMark role="sub-pillar" size={8} />
                        <span className="text-[12px] font-semibold text-manor-brassHi" style={{ fontFamily: serif }}>{shortTitle(sp.title)}</span>
                        <StatusDot status={sp.status} size={6} />
                      </div>
                      {sp.url && <span className="text-[9px] font-mono text-manor-brassDim/60 block">{sp.url}</span>}
                      <div className="flex items-center gap-2 mt-0.5">
                        {spSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums">{formatSv(spSv)} SV</span>}
                        <span className="text-[9px] text-manor-inkFaint">{spKws.length} kw</span>
                        <span className="text-[9px] text-manor-inkFaint">{children.length} pages</span>
                      </div>
                    </div>
                    {/* Children list */}
                    <div className="p-2 space-y-1">
                      {children.map((c) => { const cKws = boundByPage.get(c.id) ?? []; const cSv = cKws.reduce((s, k) => s + (k.sv ?? 0), 0); const isSel = selectedPageId === c.id; return (
                        <div key={c.id} className={["flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all text-[11px]", isSel ? "bg-manor-bg3 border border-manor-brass/40" : "hover:bg-manor-bg3/50 border border-transparent"].join(" ")} onClick={() => onPageSelect(c.id)}><StatusDot status={c.status} size={6} /><span className="text-manor-ink truncate flex-1 min-w-0" style={{ fontFamily: serif }}>{shortTitle(c.title)}</span>{cSv > 0 && <span className="text-[9px] text-manor-brassDim tabular-nums shrink-0">{formatSv(cSv)}</span>}</div>
                      ); })}
                      {/* + add child cluster under this sub-pillar */}
                      {newClusterFor === sp.id ? (<div className="flex items-center gap-1 px-1 pt-1"><input autoFocus value={newClusterTitle} onChange={(e) => setNewClusterTitle(e.target.value)} placeholder="New page title..." className="h-5 px-1.5 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && newClusterTitle.trim() && onNewCluster) { onNewCluster(newClusterTitle.trim(), sp.id); setNewClusterTitle(""); setNewClusterFor(null); } if (e.key === "Escape") setNewClusterFor(null); }} /><button type="button" onClick={() => setNewClusterFor(null)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                      ) : (<button type="button" onClick={() => setNewClusterFor(sp.id)} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors"><Plus size={9} /> New page</button>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* + 加一个子支柱到本格 */}
          <div className="mt-4">
            {addingSubPillar ? (<div className="flex items-center gap-2"><input autoFocus value={newSubPillarTitle} onChange={(e) => setNewSubPillarTitle(e.target.value)} placeholder="New sub-pillar name..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass/60 w-40" onKeyDown={(e) => { if (e.key === "Enter" && newSubPillarTitle.trim() && catPillar && onNewCluster) { onNewCluster(newSubPillarTitle.trim(), catPillar.id, "sub-pillar", cellScenarioId); setNewSubPillarTitle(""); setAddingSubPillar(false); } if (e.key === "Escape") setAddingSubPillar(false); }} /><button type="button" onClick={() => setAddingSubPillar(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={10} /></button></div>
            ) : (<button type="button" onClick={() => setAddingSubPillar(true)} className="flex items-center gap-1 text-[10px] text-manor-inkFaint hover:text-manor-brassHi transition-colors border border-dashed border-manor-line2/40 rounded px-3 py-1.5 hover:border-manor-brass/40"><Plus size={10} /> 加一个子支柱到本格</button>)}
          </div>
        </div>
        <style jsx>{`@keyframes loom-drill-in { from { transform: scale(0.92); opacity: 0.5; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  OVERVIEW GRID
  // ═══════════════════════════════════════════════════════════════════════

  // 列宽/行高未手动固定 → 自适应（max-content / 1fr），不裁溢出，内容多宽就多宽。
  // 一旦手动拖固定：列宽固定 → 裁横向（按固定宽截断，不外溢邻列）；行高固定 → 裁纵向（防内容把行撑回去）。
  const colOverflowStyle = (key: string): React.CSSProperties | undefined =>
    colWidths[key] != null ? { minWidth: 0, overflow: "hidden" } : undefined;
  const cellOverflowStyle = (colKey: string, catId: string): React.CSSProperties | undefined => {
    const clipX = colWidths[colKey] != null;
    const clipY = rowHeights[catId] != null;
    if (!clipX && !clipY) return undefined;
    return { ...(clipX ? { minWidth: 0 } : {}), ...(clipY ? { minHeight: 0 } : {}), overflow: "hidden" };
  };
  const colHandle = (key: string) => (
    <div
      onPointerDown={startResize("col", key)} onPointerMove={onResizeMove} onPointerUp={endResize} onPointerCancel={endResize}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); clearSize("col", key); }}
      title="拖动改列宽 · 双击恢复自适应"
      className="absolute top-0 right-0 h-full w-1.5 z-20 cursor-col-resize"
      style={{ touchAction: "none" }}
    />
  );
  const rowHandle = (catId: string) => (
    <div
      onPointerDown={startResize("row", catId)} onPointerMove={onResizeMove} onPointerUp={endResize} onPointerCancel={endResize}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); clearSize("row", catId); }}
      title="拖动改行高 · 双击恢复自适应"
      className="absolute bottom-0 left-0 w-full h-1.5 z-20 cursor-row-resize"
      style={{ touchAction: "none" }}
    />
  );
  // 未拖 → 自适应（max-content 下限 / 1fr 填充）；已拖 → 固定 Npx（权威：网格据此变宽，超出视口可平移）。
  // 固定改 minmax(max-content, Npx) 为纯 Npx 的原因：minmax 上限只在网格有自由空间时才生效，
  // 抽屉弹出后网格被压满、自由空间归零，拖拽只改状态不改视觉 → 表现为「无法修改列宽」。纯 Npx 让拖拽即时可见。
  const gridTemplateColumns = `${colWidths[CAT_COL_KEY] != null ? `${colWidths[CAT_COL_KEY]}px` : "minmax(120px, max-content)"} ${renderCols.map((rc) => { const k = colKeyOf(rc); return colWidths[k] != null ? `${colWidths[k]}px` : "minmax(max-content, 1fr)"; }).join(" ")} 48px`;
  const gridTemplateRows = `auto auto ${rows.map((cat) => (rowHeights[cat.id] != null ? `${rowHeights[cat.id]}px` : "minmax(auto, 1fr)")).join(" ")} 32px`;

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
        <span className="text-[10px] text-manor-inkFaint tabular-nums">{rows.length} x {totalThemeCols}</span>
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
          <div className="inline-grid gap-0" style={{ gridTemplateColumns, gridTemplateRows, minWidth: "100%", borderTop: gridBorder, borderLeft: gridBorder }}>
            {/* Row 1: 大列 (type band) headers -- grip to drag, + to add 小列 */}
            <div style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder }} />
            {bands.map((band) => {
              const span = Math.max(1, band.themes.length);
              const isDragging = dragId === band.type;
              return (
                <div
                  key={band.type}
                  data-band-type={band.type}
                  className="relative group flex items-center justify-center py-2"
                  style={{ gridColumn: `span ${span}`, background: headerBg, borderRight: gridBorder, borderBottom: gridBorder, opacity: isDragging ? 0.45 : 1 }}
                >
                  <button
                    type="button"
                    onPointerDown={startDrag("band", band.type)} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                    onClick={(e) => e.stopPropagation()}
                    title="拖动整条类型带换位"
                    className="absolute left-1 top-1/2 -translate-y-1/2 p-0.5 text-manor-brassDim hover:text-manor-brassHi opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                  ><GripHorizontal size={12} /></button>
                  <span className="text-[11px] tracking-[0.18em] text-manor-brassHi font-semibold" style={{ fontFamily: sc }}>{band.en}</span>
                  <span className="text-[10px] text-manor-ink ml-1.5">{band.zh}</span>
                  {addingThemeFor === band.type ? (
                    <div className="absolute right-0 top-full mt-0.5 z-30 flex flex-col gap-1 p-1.5 bg-manor-bg2 border border-manor-brass/40 rounded shadow-lg">
                      <input autoFocus value={newThemeEn} onChange={(e) => setNewThemeEn(e.target.value)} placeholder="小列(EN)" className="h-5 w-24 px-1 text-[9px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none" onKeyDown={(e) => { if (e.key === "Enter") addTheme(band.type); if (e.key === "Escape") setAddingThemeFor(null); }} />
                      <input value={newThemeZh} onChange={(e) => setNewThemeZh(e.target.value)} placeholder="中文" className="h-5 w-24 px-1 text-[9px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none" onKeyDown={(e) => { if (e.key === "Enter") addTheme(band.type); if (e.key === "Escape") setAddingThemeFor(null); }} />
                      <div className="flex items-center gap-1"><button type="button" onClick={() => addTheme(band.type)} className="text-[9px] text-manor-sageHi px-1">OK</button><button type="button" onClick={() => setAddingThemeFor(null)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setAddingThemeFor(band.type); setAddingBand(false); }} title="往这条带加一个场景列（小列）" className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-manor-inkFaint hover:text-manor-brassHi opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={11} /></button>
                  )}
                </div>
              );
            })}
            <div className="relative flex items-center justify-center" style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder }}>
              {addingBand ? (
                <div className="absolute right-0 top-full mt-0.5 z-30 flex flex-col gap-1 p-1.5 bg-manor-bg2 border border-manor-brass/40 rounded shadow-lg">
                  <input autoFocus value={newBandEn} onChange={(e) => setNewBandEn(e.target.value)} placeholder="类型(EN)" className="h-5 w-24 px-1 text-[9px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none" onKeyDown={(e) => { if (e.key === "Enter") addBand(); if (e.key === "Escape") setAddingBand(false); }} />
                  <input value={newBandZh} onChange={(e) => setNewBandZh(e.target.value)} placeholder="中文" className="h-5 w-24 px-1 text-[9px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none" onKeyDown={(e) => { if (e.key === "Enter") addBand(); if (e.key === "Escape") setAddingBand(false); }} />
                  <div className="flex items-center gap-1"><button type="button" onClick={addBand} className="text-[9px] text-manor-sageHi px-1">OK</button><button type="button" onClick={() => setAddingBand(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={9} /></button></div>
                </div>
              ) : (
                <button type="button" onClick={() => { setAddingBand(true); setAddingThemeFor(null); }} className="flex flex-col items-center justify-center text-manor-inkFaint hover:text-manor-brassHi transition-colors" title="加一条新类型带（大列）"><Plus size={12} /><span className="text-[7px] tracking-[0.1em]" style={{ fontFamily: sc }}>大列</span></button>
              )}
            </div>

            {/* Row 2: sub-column (小列) headers */}
            <div className="relative flex items-end pb-1 px-2" style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder, ...colOverflowStyle(CAT_COL_KEY) }}><span className="text-[8px] text-manor-inkFaint" style={{ fontFamily: sc }}>Category</span>{colHandle(CAT_COL_KEY)}</div>
            {renderCols.map((rc) => {
              if (rc.kind === "placeholder") {
                return (
                  <div key={`ph-${rc.bandType}`} className="relative flex flex-col items-center justify-end gap-0.5 px-2 pb-1.5 pt-1" style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder, ...colOverflowStyle(colKeyOf(rc)) }}>
                    <span className="text-[9px] text-manor-inkFaint italic">空带</span>
                    <button type="button" onClick={() => setAddingThemeFor(rc.bandType)} className="text-[9px] text-manor-inkFaint hover:text-manor-brassHi flex items-center gap-0.5"><Plus size={9} /> 小列</button>
                    {colHandle(colKeyOf(rc))}
                  </div>
                );
              }
              const col = rc.theme; const owned = scenarioOwned.get(col.id);
              const isThemeDragging = dragId === col.id;
              return (
                <div key={`col-${col.id}`} data-theme-id={col.id} data-theme-band={rc.bandType} className="relative group flex flex-col items-center justify-end gap-0.5 px-2 pb-1.5 pt-1 cursor-pointer hover:bg-manor-bg3/30 transition-colors" style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder, opacity: isThemeDragging ? 0.45 : 1, ...colOverflowStyle(col.id) }} onClick={() => drillInto(col.id, col.en)} title={`${col.en} ${col.zh}`}>
                  <button
                    type="button"
                    onPointerDown={startDrag("theme", col.id, rc.bandType)} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                    onClick={(e) => e.stopPropagation()}
                    title="拖动小列（仅在本类型带内换位）"
                    className="absolute top-0.5 left-1/2 -translate-x-1/2 p-0.5 text-manor-brassDim hover:text-manor-brassHi opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                  ><GripHorizontal size={11} /></button>
                  <span className="text-[12px] text-manor-brassHi font-semibold leading-tight text-center whitespace-nowrap" style={{ fontFamily: serif }}>{col.en}</span>
                  <span className="text-[9px] text-manor-ink leading-tight whitespace-nowrap">{col.zh}</span>
                  {owned && owned.count > 0 && <span className="text-[8px] text-manor-inkDim tabular-nums">{owned.count} pg</span>}
                  {colHandle(col.id)}
                </div>
              );
            })}
            <div style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder }} />

            {/* Data rows */}
            {rows.map((cat) => {
              const catSel = selectedPageId != null && categoryStats.get(cat.id)?.pillarId === selectedPageId;
              const isDragging = dragId === cat.id;
              // ── Pillar page info for row header ──
              const catPages = pagesByTheme.get(cat.id) ?? [];
              const catPillar = catPages.find((p) => p.role === "pillar");
              // 子树 SV: pillar 自身 + 所有后代页绑定词 SV 之和
              let catTreeSv = 0;
              for (const pg of catPages) {
                for (const k of (boundByPage.get(pg.id) ?? [])) catTreeSv += k.sv ?? 0;
              }
              return (
                <React.Fragment key={cat.id}>
                  <div
                    data-row-id={cat.id}
                    className={["relative group flex flex-col items-start justify-center gap-0.5 pl-5 pr-3 py-3 cursor-pointer transition-colors", catSel ? "bg-manor-bg3" : "hover:bg-manor-bg3/40"].join(" ")}
                    style={{ background: catSel ? undefined : headerBg, borderRight: gridBorder, borderBottom: gridBorder, opacity: isDragging ? 0.45 : 1, ...cellOverflowStyle(CAT_COL_KEY, cat.id) }}
                    onClick={() => drillInto(cat.id, cat.en)} title={`${cat.en} ${cat.zh}`}
                  >
                    <button
                      type="button"
                      onPointerDown={startDrag("row", cat.id)} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                      onClick={(e) => e.stopPropagation()}
                      title="拖动行换位"
                      className="absolute left-0.5 top-1/2 -translate-y-1/2 p-0.5 text-manor-brassDim hover:text-manor-brassHi opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                    ><GripVertical size={12} /></button>
                    {/* Line 1: pillar identity mark + category name（空名 = 只留标记，如念诵知识行）*/}
                    <div className="flex items-center gap-1">
                      <RoleMark role="pillar" size={9} />
                      {cat.en && <span className="text-[13px] font-semibold leading-tight text-manor-brassHi text-left whitespace-nowrap" style={{ fontFamily: serif }}>{cat.en}</span>}
                    </div>
                    {cat.zh && <span className="text-[9px] text-manor-ink leading-tight text-left whitespace-nowrap">{cat.zh}</span>}
                    {/* Line 2: status dot + tree SV */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {catPillar && <StatusDot status={effectiveStatus(catPillar.url, catPillar.status, indexedMatches)} size={6} />}
                      {catTreeSv > 0 && <span className="text-[8px] text-manor-brassDim tabular-nums">{formatSv(catTreeSv)}</span>}
                      {!catPillar && <span className="text-[8px] text-manor-inkFaint italic">no pillar</span>}
                    </div>
                    {rowHandle(cat.id)}
                  </div>
                  {renderCols.map((rc) => {
                    if (rc.kind === "placeholder") {
                      return <div key={`phc-${cat.id}-${rc.bandType}`} className="min-h-[72px]" style={{ borderRight: gridBorder, borderBottom: gridBorder, ...cellOverflowStyle(colKeyOf(rc), cat.id) }} />;
                    }
                    const scen = rc.theme;
                    const key = `${cat.id}::${scen.id}`; const cell = cells.get(key); const isGap = !cell || cell.subCount === 0;
                    const totalSv = cell?.totalSv ?? 0;
                    return (
                      <div key={key} className={["relative flex flex-col items-start justify-start gap-0.5 p-2 min-h-[72px] cursor-pointer transition-all text-left", isGap ? "hover:border-manor-brass/20 hover:bg-manor-bg3/15" : "hover:border-manor-brass/30 hover:bg-manor-bg3/20"].join(" ")} style={{ borderRight: gridBorder, borderBottom: gridBorder, ...cellOverflowStyle(scen.id, cat.id) }} onClick={() => { setDrillStack((s) => [...s, { type: "cell", categoryId: cat.id, categoryName: cat.en, scenarioId: scen.id, scenarioName: scen.en }]); }} title={isGap ? `Gap: ${cat.en} x ${scen.en} — click to add` : `${cat.en} x ${scen.en}: ${cell!.subCount} sub-pillars, ${cell!.clusterCount} clusters, ${formatSv(totalSv)} SV`}>
                        {isGap ? (<div className="flex-1 flex flex-col items-center justify-center w-full"><span className="absolute inset-2 border border-dashed border-manor-line2/30 rounded pointer-events-none" aria-hidden /><span className="text-[14px] text-manor-inkGhost leading-none" aria-hidden>&#x25A2;</span><span className="text-[8px] text-manor-inkFaint/50 mt-0.5">gap</span></div>
                        ) : (<>
                          {/* 爸爸→孙子缩进小树：每个爸爸=一张带框可折叠小卡 */}
                          {cell!.subPillars.map((sp) => {
                            const isCollapsed = collapsedSubs.has(sp.id);
                            const hasChildren = sp.clusters.length > 0;
                            return (
                            <div key={sp.id} className="w-max border border-manor-brass/35 rounded px-1 py-0.5 mb-1" style={{ background: "rgba(212,179,111,0.035)" }}>
                              {/* 卡头：折叠箭头 + 爸爸行 */}
                              <div className="flex items-center gap-1">
                                {hasChildren ? (
                                  <button type="button" className="flex-none flex items-center justify-center p-0 bg-transparent border-none cursor-pointer text-manor-inkFaint hover:text-manor-ink transition-colors" onClick={(e) => { e.stopPropagation(); toggleSub(sp.id); }} aria-label={isCollapsed ? "Expand" : "Collapse"}>
                                    {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                                  </button>
                                ) : (
                                  <span className="flex-none" style={{ width: 10 }} />
                                )}
                                <RoleMark role="sub-pillar" size={6} />
                                <StatusDot status={sp.status} size={5} />
                                <span className="text-[10px] text-manor-ink/90 whitespace-nowrap leading-tight" style={{ fontFamily: serif }}>{sp.title}</span>
                              </div>
                              {/* 孙子行（缩进，全部展开）-- 仅展开态渲染 */}
                              {hasChildren && !isCollapsed && (<>
                                {sp.clusters.map((cl) => (
                                  <div key={cl.id} className="flex items-center gap-1 pl-3 mt-px">
                                    <span className="text-[8px] text-manor-inkFaint/40 leading-none select-none" aria-hidden>&#x2514;</span>
                                    <RoleMark role="cluster" size={5} />
                                    <StatusDot status={cl.status} size={4} />
                                    <span className="text-[9px] text-manor-ink/70 whitespace-nowrap leading-tight" style={{ fontFamily: serif }}>{cl.title}</span>
                                  </div>
                                ))}
                              </>)}
                            </div>
                            );
                          })}
                          {/* footer: SV only (no parent/child count) */}
                          <div className="mt-auto pt-1 flex items-center gap-1.5 w-full">
                            <span className="text-[8px] text-manor-brassDim/60 tabular-nums">{formatSv(totalSv)}</span>
                            <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, rgba(212,179,111,${Math.min(0.4, totalSv / 10000)}) 0%, transparent 100%)` }} />
                          </div>
                        </>)}
                      </div>
                    );
                  })}
                  <div style={{ borderRight: gridBorder, borderBottom: gridBorder }} />
                </React.Fragment>
              );
            })}

            {/* + row */}
            <div className="flex items-center justify-center" style={{ background: headerBg, borderRight: gridBorder, borderBottom: gridBorder }}>{!addingRow && <button type="button" onClick={() => setAddingRow(true)} className="text-[9px] text-manor-inkFaint hover:text-manor-brassHi transition-colors flex items-center gap-0.5" title="加一行品类（经线）"><Plus size={10} /> Row</button>}</div>
            {addingRow ? (<div className="flex items-center gap-2 px-2" style={{ gridColumn: `2 / -1`, borderRight: gridBorder, borderBottom: gridBorder }}><input autoFocus value={newRowEn} onChange={(e) => setNewRowEn(e.target.value)} placeholder="English..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none w-28" onKeyDown={(e) => { if (e.key === "Enter") addRow(); if (e.key === "Escape") setAddingRow(false); }} /><input value={newRowZh} onChange={(e) => setNewRowZh(e.target.value)} placeholder="Chinese..." className="h-6 px-2 text-[10px] bg-manor-void/60 border border-manor-brass/30 rounded text-manor-ink placeholder:text-manor-inkFaint focus:outline-none w-20" onKeyDown={(e) => { if (e.key === "Enter") addRow(); if (e.key === "Escape") setAddingRow(false); }} /><button type="button" onClick={addRow} className="text-[9px] text-manor-sageHi">OK</button><button type="button" onClick={() => setAddingRow(false)} className="text-manor-inkFaint hover:text-manor-ink"><X size={10} /></button></div>
            ) : (<>{renderCols.map((_, i) => <div key={`p${i}`} style={{ borderRight: gridBorder, borderBottom: gridBorder }} />)}<div style={{ borderRight: gridBorder, borderBottom: gridBorder }} /></>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 px-1">
            <div className="flex items-center gap-3 text-[10px] text-manor-inkDim">
              <span className="inline-flex items-center gap-1"><StatusDot status="live" size={6} /><span>Live</span></span>
              <span className="inline-flex items-center gap-1"><StatusDot status="optimize" size={6} /><span>Optimize</span></span>
              <span className="inline-flex items-center gap-1"><StatusDot status="gap" size={6} /><span>Gap</span></span>
            </div>
            <span className="text-[9px] text-manor-inkFaint italic ml-auto">悬停露抓手拖动排序 · 拖列右缘改列宽/行头下缘改行高（双击复位）· 滚轮缩放 · 拖空白平移</span>
          </div>
        </div>
      </div>
    </div>
  );
}
