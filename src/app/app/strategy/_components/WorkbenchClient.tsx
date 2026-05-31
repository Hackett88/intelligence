"use client";

import * as React from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import type { WorkbenchSeed, WbPage, RawKeyword, Territory, MarketRankings, PlanPayload } from "./_workbench";
import { saveStrategyPlanAction } from "./_plan-actions";
import {
  detectCannibalization,
  isHardCannibalization,
  resolvePageIntent,
  type PageRelation,
} from "./_workbench";
import { ALL_KEYWORDS } from "./_all-keywords";
import { SourcePool } from "./SourcePool";
import { LoomGrid } from "./LoomGrid";
import { InspectorPanel } from "./InspectorPanel";
import { Worklist } from "./Worklist";
import { WorkbenchDock } from "./WorkbenchDock";
import { AssignMenu } from "./AssignMenu";
import { KeywordModal } from "./KeywordModal";
import { SecondaryAuthDialog } from "@/app/app/keywords/fetch/_components/SecondaryAuthDialog";
import { BaroqueCorners } from "@/components/ManorOrnaments";

// 透明拖拽热区：覆盖在分栏缝上，不占布局、无可见把柄，仅悬浮时光标变"左右拖动"
function ColResizer({ style, onDown }: { style: React.CSSProperties; onDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onDown}
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度"
      style={style}
      className="absolute top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-20"
    />
  );
}

// 移出确认窗（已验印窗口内用）：纯确认、不要密码；防误触仍在，且移出可撤销
function UnassignConfirmDialog({
  open,
  label,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center drawer-mask p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm glass-panel-brass"
        style={{ borderRadius: 6 }}
      >
        <BaroqueCorners size={20} />
        <div className="p-6 flex flex-col gap-4">
          <div>
            <div className="font-sc tracking-[0.32em] text-manor-oxbloodHi mb-1.5" style={{ fontFamily: sc, fontSize: 10 }}>
              ◆ DELERE · 移出确认
            </div>
            <h2 className="text-brass-gradient font-serif font-semibold leading-tight" style={{ fontFamily: serif, fontSize: 20, letterSpacing: "0.02em" }}>
              确认移出关键词
            </h2>
            <p className="text-manor-inkDim mt-2" style={{ fontFamily: serif, fontSize: 13 }}>
              {label}
            </p>
            <p className="text-xs text-manor-inkFaint italic mt-1">本次会话已验印 · 可直接确认（移出可撤销）</p>
            <span className="brass-divider mt-3 opacity-60 block" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-inkDim border border-manor-line2 hover:text-manor-ink hover:border-manor-brass/40 transition-colors"
              style={{ borderRadius: 3, fontFamily: sc }}
            >
              ABROGARE · 取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-5 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-ink bg-gradient-to-b from-manor-oxblood to-manor-oxbloodDim hover:from-manor-oxbloodHi hover:to-manor-oxblood shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_8px_rgba(196,107,90,0.35)] transition-colors"
              style={{ borderRadius: 3, fontFamily: sc }}
            >
              DELERE · 确认移出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── State shape ──────────────────────────────────────────────────────────────
export type SelectionKind = { type: "page"; id: string } | { type: "keyword"; id: string } | null;

type WbState = {
  pages: WbPage[];
  bindings: Record<string, string>; // kwId -> pageId
  parked: Set<string>;             // kwId set (basket)
  selection: SelectionKind;
  poolSelection: Set<string>;      // multi-select in source pool
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  assignMenuOpen: boolean;
};

type HistoryEntry = {
  bindings: Record<string, string>;
  pages: WbPage[];
  parked: Set<string>;
};

type Action =
  | { type: "ASSIGN"; kwIds: string[]; pageId: string }
  | { type: "UNASSIGN"; kwIds: string[] }
  | { type: "PARK"; kwIds: string[] }
  | { type: "UNPARK"; kwIds: string[] }
  | { type: "NEW_PILLAR"; title: string; territory: Territory }
  | { type: "NEW_CLUSTER"; title: string; pillarId: string; role?: "cluster" | "sub-pillar"; scenarioId?: string }
  | { type: "SET_PAGE_URL"; pageId: string; url: string }
  | { type: "CREATE_AND_ASSIGN"; role: "pillar" | "cluster"; pillarId: string | null; title: string; territory: Territory; kwIds: string[] }
  | { type: "SELECT"; selection: SelectionKind }
  | { type: "SET_POOL_SELECTION"; ids: Set<string> }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "OPEN_ASSIGN_MENU" }
  | { type: "CLOSE_ASSIGN_MENU" };

function snapshot(s: WbState): HistoryEntry {
  return {
    bindings: { ...s.bindings },
    pages: [...s.pages],
    parked: new Set(s.parked),
  };
}

let _nextId = 1000;
function nextId(prefix: string) {
  return `${prefix}-${_nextId++}`;
}

function reducer(state: WbState, action: Action): WbState {
  switch (action.type) {
    case "ASSIGN": {
      const hist = snapshot(state);
      const newBindings = { ...state.bindings };
      for (const kid of action.kwIds) {
        newBindings[kid] = action.pageId;
      }
      const newParked = new Set(state.parked);
      for (const kid of action.kwIds) newParked.delete(kid);
      return {
        ...state,
        bindings: newBindings,
        parked: newParked,
        poolSelection: new Set(),
        assignMenuOpen: false,
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "UNASSIGN": {
      const hist = snapshot(state);
      const newBindings = { ...state.bindings };
      for (const kid of action.kwIds) {
        delete newBindings[kid];
      }
      return {
        ...state,
        bindings: newBindings,
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "PARK": {
      const hist = snapshot(state);
      const newParked = new Set(state.parked);
      for (const kid of action.kwIds) newParked.add(kid);
      const newBindings = { ...state.bindings };
      for (const kid of action.kwIds) delete newBindings[kid];
      return {
        ...state,
        parked: newParked,
        bindings: newBindings,
        poolSelection: new Set(),
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "UNPARK": {
      const hist = snapshot(state);
      const newParked = new Set(state.parked);
      for (const kid of action.kwIds) newParked.delete(kid);
      return {
        ...state,
        parked: newParked,
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "NEW_PILLAR": {
      const hist = snapshot(state);
      const id = nextId("wb-pil");
      const page: WbPage = {
        id,
        role: "pillar",
        pillarId: null,
        title: action.title,
        primaryKeyword: action.title.toLowerCase(),
        pageType: "知识深度页",
        status: "gap",
        url: null,
        market: "us",
        markets: ["us"],
        position: null,
        clicks: null,
        impressions: null,
        themeId: id,
        themeName: action.title,
        themeLatin: action.title.toUpperCase(),
        territory: action.territory,
      };
      return {
        ...state,
        pages: [...state.pages, page],
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "NEW_CLUSTER": {
      const hist = snapshot(state);
      const pillar = state.pages.find((p) => p.id === action.pillarId);
      if (!pillar) return state;
      const role = action.role ?? "cluster";
      const id = nextId(role === "sub-pillar" ? "wb-sp" : "wb-cls");
      const page: WbPage = {
        id,
        role,
        pillarId: action.pillarId,
        title: action.title,
        primaryKeyword: action.title.toLowerCase(),
        pageType: "知识深度页",
        status: "gap",
        url: null,
        market: pillar.market,
        markets: [pillar.market],
        position: null,
        clicks: null,
        impressions: null,
        themeId: pillar.themeId,
        themeName: pillar.themeName,
        themeLatin: pillar.themeLatin,
        territory: pillar.territory,
        ...(action.scenarioId ? { scenarioId: action.scenarioId } : {}),
      };
      return {
        ...state,
        pages: [...state.pages, page],
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "SET_PAGE_URL": {
      const hist = snapshot(state);
      const trimmed = action.url.trim();
      const newUrl = trimmed.length ? trimmed : null;
      const newPages = state.pages.map((p) =>
        p.id === action.pageId ? { ...p, url: newUrl } : p
      );
      return {
        ...state,
        pages: newPages,
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "CREATE_AND_ASSIGN": {
      const hist = snapshot(state);
      const id = nextId(action.role === "pillar" ? "usr-pil" : "usr-cls");
      const parentPillar = action.role === "cluster" && action.pillarId
        ? state.pages.find((p) => p.id === action.pillarId)
        : null;
      const page: WbPage = {
        id,
        role: action.role,
        pillarId: action.role === "cluster" ? (action.pillarId ?? null) : null,
        title: action.title,
        primaryKeyword: action.title.toLowerCase(),
        pageType: "知识深度页",
        status: "gap",
        url: null,
        market: parentPillar?.market ?? "us",
        markets: parentPillar ? [parentPillar.market] : ["us"],
        position: null,
        clicks: null,
        impressions: null,
        themeId: action.role === "pillar" ? id : (parentPillar?.themeId ?? id),
        themeName: action.role === "pillar" ? action.title : (parentPillar?.themeName ?? action.title),
        themeLatin: action.role === "pillar" ? action.title.toUpperCase() : (parentPillar?.themeLatin ?? action.title.toUpperCase()),
        territory: action.territory,
      };
      const newBindings = { ...state.bindings };
      const newParked = new Set(state.parked);
      for (const kid of action.kwIds) {
        newBindings[kid] = id;
        newParked.delete(kid);
      }
      return {
        ...state,
        pages: [...state.pages, page],
        bindings: newBindings,
        parked: newParked,
        poolSelection: new Set(),
        assignMenuOpen: false,
        undoStack: [...state.undoStack, hist],
        redoStack: [],
      };
    }
    case "SELECT":
      return { ...state, selection: action.selection };
    case "SET_POOL_SELECTION":
      return { ...state, poolSelection: action.ids };
    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      const redoEntry = snapshot(state);
      return {
        ...state,
        bindings: prev.bindings,
        pages: prev.pages,
        parked: prev.parked,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoEntry],
      };
    }
    case "REDO": {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const undoEntry = snapshot(state);
      return {
        ...state,
        bindings: next.bindings,
        pages: next.pages,
        parked: next.parked,
        undoStack: [...state.undoStack, undoEntry],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
    case "OPEN_ASSIGN_MENU":
      return { ...state, assignMenuOpen: true };
    case "CLOSE_ASSIGN_MENU":
      return { ...state, assignMenuOpen: false };
    default:
      return state;
  }
}

// ── localStorage persistence ──────────────────────────────────────────────────
const STORAGE_KEY = "wb-session-v2";

function saveToStorage(s: WbState) {
  try {
    const data = {
      bindings: s.bindings,
      parked: Array.from(s.parked),
      pages: s.pages,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded or unavailable */ }
}

function loadFromStorage(seed: WorkbenchSeed): Partial<WbState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      bindings: data.bindings ?? seed.bindings,
      parked: new Set(data.parked ?? []),
      pages: data.pages ?? seed.pages,
    };
  } catch {
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
interface WorkbenchClientProps {
  seed: WorkbenchSeed;
  rankings: MarketRankings;
  initialPlan: PlanPayload | null;
}

export function WorkbenchClient({ seed, rankings, initialPlan }: WorkbenchClientProps) {
  // ── KW_BY_ID: the single truth source for all keyword lookups ──
  const KW_BY_ID = React.useMemo(() => {
    const map = new Map<string, RawKeyword>();
    for (const k of ALL_KEYWORDS) map.set(k.id, k);
    return map;
  }, []);

  // excluded keyword IDs (never enter pool or bindings)
  const excludedIds = React.useMemo(() => {
    return new Set(seed.excluded.map((k) => k.id));
  }, [seed.excluded]);

  const initState = React.useMemo<WbState>(() => {
    const saved = loadFromStorage(seed);
    // 优先级：数据库已持久化的规划 > 本地草稿 > 蓝图种子
    const basePages = initialPlan?.pages ?? saved?.pages ?? seed.pages;
    // v2.1 seed-merge: 把种子里 DB plan 没有的页面自动并入（按 pageId 去重），
    // 让新增 demo 主题在有 DB plan 时也能完整下钻。只在前端合并，不动落库逻辑。
    const existingIds = new Set(basePages.map((p) => p.id));
    const merged = [...basePages];
    for (const sp of seed.pages) {
      if (!existingIds.has(sp.id)) merged.push(sp);
    }
    // 主题归属以蓝图为准：对蓝图里存在的页 id，用蓝图的结构字段（主题归属 / 角色）覆盖持久化里的旧值。
    // 让蓝图层的主题重构（如 Name Necklace 从 islamic-jewelry 子页提升为独立经线行）即便在已有
    // DB / 本地草稿时也能正确生效，且下次保存自动写回新结构、自愈。用户数据（url / 状态 / 备注 / 绑定）保留。
    const seedById = new Map(seed.pages.map((p) => [p.id, p]));
    // seed-prune: 蓝图里已删除的页面（如砍掉的 cluster）从持久化里清除。
    // 用户自建页（wb-/usr- 前缀）不受影响，只移除"曾属于蓝图但已被蓝图删除"的页面。
    const seedIdSet = new Set(seed.pages.map((p) => p.id));
    const pruned = merged.filter((p) => seedIdSet.has(p.id) || p.id.startsWith("wb-") || p.id.startsWith("usr-"));
    const reconciled = pruned.map((p) => {
      const sp = seedById.get(p.id);
      if (!sp) return p;
      return { ...p, themeId: sp.themeId, themeName: sp.themeName, themeLatin: sp.themeLatin, territory: sp.territory, role: sp.role, pillarId: sp.pillarId, scenarioId: sp.scenarioId };
    });
    const baseBindings = initialPlan ? { ...initialPlan.bindings } : (saved?.bindings ?? { ...seed.bindings });
    // Also merge seed bindings for newly added pages
    const mergedBindings = { ...baseBindings };
    for (const [kwId, pageId] of Object.entries(seed.bindings)) {
      if (!(kwId in mergedBindings) && reconciled.some((p) => p.id === pageId)) {
        mergedBindings[kwId] = pageId;
      }
    }
    // binding-prune: 删掉指向已不存在页面的悬空绑定，让那些词回到未绑定池。
    const finalPageIds = new Set(reconciled.map((p) => p.id));
    for (const kwId of Object.keys(mergedBindings)) {
      if (!finalPageIds.has(mergedBindings[kwId])) delete mergedBindings[kwId];
    }
    return {
      pages: reconciled,
      bindings: mergedBindings,
      parked: initialPlan ? new Set(initialPlan.parked) : (saved?.parked ?? new Set<string>()),
      selection: null,
      poolSelection: new Set<string>(),
      undoStack: [],
      redoStack: [],
      assignMenuOpen: false,
    };
  }, [seed, initialPlan]);

  const [state, dispatch] = React.useReducer(reducer, initState);

  // auto-save on bindings/parked/pages change（本地草稿，瞬时、离线兜底）
  React.useEffect(() => {
    saveToStorage(state);
  }, [state.bindings, state.parked, state.pages]);

  // 防抖落库（按 owner 持久化；与本地草稿并行，数据库为权威源）。
  // 用「序列化快照比对」判断是否有实质变化 —— 跳过初始水合，且对 StrictMode 的
  // 重复挂载免疫（mount/remount 的快照都等于初始值 → 不触发空保存）。
  const dbSaveTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedSnap = React.useRef<string | null>(null);
  React.useEffect(() => {
    const snap = JSON.stringify({
      pages: state.pages,
      bindings: state.bindings,
      parked: Array.from(state.parked).sort(),
    });
    if (lastSavedSnap.current === null) { lastSavedSnap.current = snap; return; } // 初次水合
    if (snap === lastSavedSnap.current) return; // 无实质变化（含 StrictMode 重挂）
    lastSavedSnap.current = snap;
    if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current);
    dbSaveTimer.current = setTimeout(() => {
      // P1-safety: filter out demo pages (tb-*) and demo keyword bindings (d0-d99) before saving to DB.
      // Demo data is display-only via seed-merge; it must never pollute the real persisted plan.
      const isDemo = (id: string) => /^tb-/.test(id) || /^d\d+$/.test(id);
      const cleanPages = state.pages.filter((p) => !isDemo(p.id));
      const cleanBindings: Record<string, string> = {};
      for (const [kwId, pageId] of Object.entries(state.bindings)) {
        if (!isDemo(kwId) && !isDemo(pageId)) cleanBindings[kwId] = pageId;
      }
      const cleanParked = Array.from(state.parked).filter((id) => !isDemo(id));
      void saveStrategyPlanAction({
        pages: cleanPages,
        bindings: cleanBindings,
        parked: cleanParked,
      }).catch(() => { /* 落库失败不阻断操作；本地草稿仍在 */ });
    }, 1000);
    return () => { if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current); };
  }, [state.pages, state.bindings, state.parked]);

  // Ctrl+Z / Ctrl+Y
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── R4: Collapsible sidebars (折叠状态持久化到 localStorage) ─────────────
  const [leftCollapsed, setLeftCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return JSON.parse(localStorage.getItem("wb-collapse") || "{}").left ?? false; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return JSON.parse(localStorage.getItem("wb-collapse") || "{}").right ?? false; } catch { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem("wb-collapse", JSON.stringify({ left: leftCollapsed, right: rightCollapsed })); } catch { /* ignore */ }
  }, [leftCollapsed, rightCollapsed]);

  // ── Resizable columns (左/右 拖拽调宽，宽度持久化到 localStorage) ──────────
  const clampW = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const [leftW, setLeftW] = React.useState<number>(() => {
    if (typeof window === "undefined") return 320;
    try { return JSON.parse(localStorage.getItem("wb-cols") || "{}").leftW ?? 320; } catch { return 320; }
  });
  const [rightW, setRightW] = React.useState<number>(() => {
    if (typeof window === "undefined") return 300;
    try { return JSON.parse(localStorage.getItem("wb-cols") || "{}").rightW ?? 300; } catch { return 300; }
  });
  const leftWRef = React.useRef(leftW); leftWRef.current = leftW;
  const rightWRef = React.useRef(rightW); rightWRef.current = rightW;
  const resizeRef = React.useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(null);

  React.useEffect(() => {
    try { localStorage.setItem("wb-cols", JSON.stringify({ leftW, rightW })); } catch { /* ignore */ }
  }, [leftW, rightW]);

  const onResizeMove = React.useCallback((e: PointerEvent) => {
    const d = resizeRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (d.side === "left") setLeftW(clampW(d.startW + dx, 240, 480));
    else setRightW(clampW(d.startW - dx, 220, 460)); // 右栏：向左拖变宽
  }, []);
  const onResizeUp = React.useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onResizeMove]);
  const startResize = React.useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      e.preventDefault();
      resizeRef.current = { side, startX: e.clientX, startW: side === "left" ? leftWRef.current : rightWRef.current };
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResizeMove, onResizeUp]
  );

  // derived: pool = ALL_KEYWORDS minus bound, parked, and excluded (dynamic)
  const poolKeywords = React.useMemo(() => {
    return ALL_KEYWORDS.filter(
      (k) => !(k.id in state.bindings) && !state.parked.has(k.id) && !excludedIds.has(k.id)
    );
  }, [state.bindings, state.parked, excludedIds]);

  // parked keywords
  const parkedKeywords = React.useMemo(() => {
    return ALL_KEYWORDS.filter((k) => state.parked.has(k.id));
  }, [state.parked]);

  // bound keywords per page — uses KW_BY_ID so pre-bound 123 words are included
  const boundByPage = React.useMemo(() => {
    const map = new Map<string, RawKeyword[]>();
    for (const [kwId, pageId] of Object.entries(state.bindings)) {
      const kw = KW_BY_ID.get(kwId);
      if (!kw) continue;
      if (!map.has(pageId)) map.set(pageId, []);
      map.get(pageId)!.push(kw);
    }
    return map;
  }, [state.bindings, KW_BY_ID]);

  // stats
  const assignedCount = Object.keys(state.bindings).length;
  const unboundCount = poolKeywords.length;
  const parkedCount = state.parked.size;
  const excludedCount = seed.excluded.length;

  // cannibalization —— 注入意图 resolver（从每页绑定词投票得意图族）。
  // 漏斗层由 URL 推断、意图族由绑定词派生，故依赖 state.pages + boundByPage。
  const conflicts = React.useMemo<PageRelation[]>(
    () => detectCannibalization(state.pages, (id) => resolvePageIntent(boundByPage.get(id) ?? [])),
    [state.pages, boundByPage]
  );

  const handleAssign = React.useCallback((kwIds: string[], pageId: string) => {
    dispatch({ type: "ASSIGN", kwIds, pageId });
  }, []);

  // selected page (for right-panel inspector)
  const selectedPage = state.selection?.type === "page"
    ? state.pages.find((p) => p.id === state.selection!.id) ?? null
    : null;

  // keyword modal
  const [modalKeywordId, setModalKeywordId] = React.useState<string | null>(null);
  const modalKw = modalKeywordId ? KW_BY_ID.get(modalKeywordId) ?? null : null;

  // 移出关键词 = 破坏性操作（易误触）：始终弹确认窗（防误触），并沿用 W01–W10 同一套二次验证。
  // 「一次会话只验一次印」：先 GET /check 探当前 cookie 是否仍在 30 分钟有效期内——
  //   · 已验印窗口内 → 只弹轻确认窗（取消/确认移出），不再要密码；
  //   · 未验印 / 已过期 → 弹密码门（验印通过即写 cookie，后续移出在窗口内只需轻确认）。
  const [pendingUnassign, setPendingUnassign] = React.useState<string[] | null>(null);
  const [unassignAuthed, setUnassignAuthed] = React.useState(false); // 当前 pending 是否处于已验印窗口
  const pendingUnassignLabel = React.useMemo(() => {
    if (!pendingUnassign) return "";
    if (pendingUnassign.length === 1) {
      const kw = KW_BY_ID.get(pendingUnassign[0]);
      return `「${kw?.keyword ?? pendingUnassign[0]}」将从该页面移回源池`;
    }
    return `${pendingUnassign.length} 个关键词将从该页面移回源池`;
  }, [pendingUnassign, KW_BY_ID]);

  // 点 × 触发：先探验印状态，再决定开"轻确认窗"还是"密码门"（探不到/出错按未验印处理）
  const requestUnassign = React.useCallback(async (kwIds: string[]) => {
    if (!kwIds.length) return;
    let authed = false;
    try {
      authed = (await fetch("/api/n8n/secondary-auth/check")).ok;
    } catch { /* 网络异常 → 按未验印，强制走密码门 */ }
    setUnassignAuthed(authed);
    setPendingUnassign(kwIds);
  }, []);

  const doUnassign = React.useCallback(() => {
    setPendingUnassign((ids) => {
      if (ids) dispatch({ type: "UNASSIGN", kwIds: ids });
      return null;
    });
  }, []);

  const serif = "var(--font-serif), 'EB Garamond', serif";
  const sc = "var(--font-sc), 'Cormorant SC', serif";

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* ── Title bar + progress ──────────────────────────────────── */}
      <div className="px-5 py-2.5 border-b border-manor-brass/25 bg-manor-bg2 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-baseline gap-3 min-w-0">
          <span
            className="font-sc tracking-[0.32em] text-manor-brassHi/80 whitespace-nowrap shrink-0"
            style={{ fontFamily: sc, fontSize: 10 }}
          >
            ◆ OFFICINA
          </span>
          <h1
            className="text-brass-gradient font-serif font-semibold leading-none whitespace-nowrap shrink-0"
            style={{
              fontFamily: serif,
              fontSize: 22,
              letterSpacing: "0.04em",
              filter: "drop-shadow(0 0 5px rgba(239,216,154,.22)) drop-shadow(0 1px 0 rgba(0,0,0,.55))",
            }}
          >
            主题与页面规划
          </h1>
          <span
            className="font-sc tracking-[0.24em] text-manor-brassHi whitespace-nowrap shrink-0 hidden 2xl:inline"
            style={{
              fontFamily: sc,
              fontSize: 10,
              textShadow: "0 0 8px rgba(239,216,154,.5), 0 0 2px rgba(224,197,122,.7)",
            }}
          >
            〔PLEXUS · PAGINAE〕
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Progress */}
          <div className="flex items-center gap-2.5 text-[11px] text-manor-inkDim whitespace-nowrap" style={{ fontFamily: sc, letterSpacing: "0.08em" }}>
            <span>
              已归 <span className="text-manor-sageHi font-semibold">{assignedCount}</span>
            </span>
            <span className="text-manor-inkFaint">/</span>
            <span>
              未归 <span className="text-manor-brassHi font-semibold">{unboundCount}</span>
            </span>
            <span className="text-manor-inkFaint">/</span>
            <span>
              噪声 <span className="text-manor-inkFaint">{excludedCount}</span>
            </span>
          </div>

          {/* Loom Grid view label */}
          <span
            className="h-7 shrink-0 inline-flex items-center px-2.5 text-[11px] text-manor-brassHi/70 border border-manor-brass/20 rounded-md"
            style={{
              fontFamily: sc,
              background: "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
              letterSpacing: "0.14em",
            }}
          >
            LOOM GRID
          </span>
        </div>
      </div>

      {/* ── Three-column body ──────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left: Source Pool (collapsible + resizable) */}
        {leftCollapsed ? (
          <div
            className="shrink-0 w-8 border-r border-manor-line flex flex-col items-center py-3 bg-manor-bg cursor-pointer hover:bg-manor-bg3/40 transition-colors"
            onClick={() => setLeftCollapsed(false)}
            title="Expand source pool"
          >
            <PanelLeftOpen size={14} className="text-manor-brassDim mb-2" />
            <span
              className="text-[9px] text-manor-brassDim/70 tracking-[0.14em]"
              style={{ fontFamily: sc, writingMode: "vertical-rl", textOrientation: "mixed" }}
            >
              POOL {unboundCount}
            </span>
          </div>
        ) : (
          <div style={{ width: leftW }} className="shrink-0 border-r border-manor-line flex flex-col min-h-0 bg-manor-bg">
            <SourcePool
              keywords={poolKeywords}
              selection={state.poolSelection}
              onSelectionChange={(ids) => dispatch({ type: "SET_POOL_SELECTION", ids })}
              onAssignClick={() => dispatch({ type: "OPEN_ASSIGN_MENU" })}
              onParkClick={() => {
                const ids = Array.from(state.poolSelection);
                if (ids.length > 0) dispatch({ type: "PARK", kwIds: ids });
              }}
              onKeywordOpen={(id) => setModalKeywordId(id)}
              onCollapse={() => setLeftCollapsed(true)}
            />
          </div>
        )}

        {/* Center: Loom Grid (自适应剩余宽度) */}
        <div className="flex-1 min-w-[280px] flex flex-col min-h-0 bg-manor-bg2">
          <LoomGrid
            pages={state.pages}
            boundByPage={boundByPage}
            selectedPageId={state.selection?.type === "page" ? state.selection.id : null}
            onPageSelect={(id) => dispatch({ type: "SELECT", selection: { type: "page", id } })}
            onNewCluster={(title, pillarId, role, scenarioId) => dispatch({ type: "NEW_CLUSTER", title, pillarId, role, scenarioId })}
            onNewPillar={(title, territory) => dispatch({ type: "NEW_PILLAR", title, territory })}
          />
        </div>

        {/* Right: Inspector (collapsible + resizable) */}
        {rightCollapsed ? (
          <div
            className="shrink-0 w-8 border-l border-manor-line flex flex-col items-center py-3 bg-manor-bg cursor-pointer hover:bg-manor-bg3/40 transition-colors"
            onClick={() => setRightCollapsed(false)}
            title="Expand inspector"
          >
            <PanelRightOpen size={14} className="text-manor-brassDim mb-2" />
            <span
              className="text-[9px] text-manor-brassDim/70 tracking-[0.14em]"
              style={{ fontFamily: sc, writingMode: "vertical-rl", textOrientation: "mixed" }}
            >
              {selectedPage ? "INSPECTOR" : "WORKLIST"}
            </span>
          </div>
        ) : (
          <div style={{ width: rightW }} className="shrink-0 border-l border-manor-line flex flex-col min-h-0 bg-manor-bg">
            {selectedPage ? (
              <InspectorPanel
                selectedPage={selectedPage}
                pages={state.pages}
                bindings={state.bindings}
                allKeywords={ALL_KEYWORDS}
                conflicts={conflicts}
                boundByPage={boundByPage}
                rankings={rankings}
                onPageSelect={(id) => dispatch({ type: "SELECT", selection: { type: "page", id } })}
                onUrlChange={(pageId, url) => dispatch({ type: "SET_PAGE_URL", pageId, url })}
                onUnassign={requestUnassign}
                onCollapse={() => setRightCollapsed(true)}
              />
            ) : (
              <Worklist
                pages={state.pages}
                conflicts={conflicts}
                poolKeywords={poolKeywords}
                boundByPage={boundByPage}
                onPageSelect={(id) => dispatch({ type: "SELECT", selection: { type: "page", id } })}
                onKeywordOpen={(id) => setModalKeywordId(id)}
                onAssign={(kwId, pageId) => handleAssign([kwId], pageId)}
                onCollapse={() => setRightCollapsed(true)}
              />
            )}
          </div>
        )}

        {/* 透明拖拽热区（仅在未折叠时显示） */}
        {!leftCollapsed && <ColResizer style={{ left: leftW }} onDown={startResize("left")} />}
        {!rightCollapsed && <ColResizer style={{ left: `calc(100% - ${rightW}px)` }} onDown={startResize("right")} />}

        {/* Assign Menu overlay */}
        {state.assignMenuOpen && (
          <AssignMenu
            pages={state.pages}
            selectedKwIds={Array.from(state.poolSelection)}
            keywords={poolKeywords}
            territories={seed.territories}
            onAssign={(pageId) => handleAssign(Array.from(state.poolSelection), pageId)}
            onCreateAndAssign={(role, pillarId, title, territory) => {
              dispatch({
                type: "CREATE_AND_ASSIGN",
                role,
                pillarId,
                title,
                territory,
                kwIds: Array.from(state.poolSelection),
              });
            }}
            onClose={() => dispatch({ type: "CLOSE_ASSIGN_MENU" })}
          />
        )}

        {/* Keyword Modal */}
        {modalKw && (
          <KeywordModal
            kw={modalKw}
            pages={state.pages}
            boundByPage={boundByPage}
            onAssign={(kwId, pageId) => {
              handleAssign([kwId], pageId);
              setModalKeywordId(null);
            }}
            onPark={(kwId) => {
              dispatch({ type: "PARK", kwIds: [kwId] });
              setModalKeywordId(null);
            }}
            onClose={() => setModalKeywordId(null)}
          />
        )}

        {/* 移出关键词 · 已验印窗口内：轻确认窗（不再要密码，防误触仍在；移出可撤销） */}
        <UnassignConfirmDialog
          open={pendingUnassign !== null && unassignAuthed}
          label={pendingUnassignLabel}
          onConfirm={doUnassign}
          onCancel={() => setPendingUnassign(null)}
        />

        {/* 移出关键词 · 未验印 / 已过期：密码门（与 W01–W10 删除同一套权限密码，验过即 30 分钟内免密） */}
        <SecondaryAuthDialog
          open={pendingUnassign !== null && !unassignAuthed}
          eyebrow="◆ DELERE · 移出验印"
          title="确认移出关键词"
          description={`${pendingUnassignLabel}，需验印确认（验后 30 分钟内免密）`}
          onSuccess={doUnassign}
          onCancel={() => setPendingUnassign(null)}
        />
      </div>

      {/* ── Bottom Dock ──────────────────────────────────────────── */}
      <WorkbenchDock
        parkedCount={parkedCount}
        parkedKeywords={parkedKeywords}
        conflictCount={conflicts.filter(isHardCannibalization).length}
        conflicts={conflicts}
        pages={state.pages}
        canUndo={state.undoStack.length > 0}
        canRedo={state.redoStack.length > 0}
        onUndo={() => dispatch({ type: "UNDO" })}
        onRedo={() => dispatch({ type: "REDO" })}
        onUnpark={(kwIds) => dispatch({ type: "UNPARK", kwIds })}
      />
    </div>
  );
}
