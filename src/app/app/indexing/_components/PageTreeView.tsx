"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Home as HomeIcon, Maximize2, Minimize2, Globe2, ListChecks } from "lucide-react";
import type { PageRow } from "./_mock";
import {
  IndexStateDot,
  PageTypeChip,
  formatLargeNumber,
} from "./_utils";

// ─── 站点根节点常量 ───
// 第 0 列只显示这一枚 "Logo / 网站根" 节点；点击后才展开第 1 列（一级页面）。
// 这是 UI 概念节点，不存在于 PageRow 数据里。
const SITE_ROOT_ID = "__site_root__";
const SITE_NAME = "weslamic.com";

// ─── Scope（按"页面子树"过滤）───
// all     → 不过滤
// subtree → 显示 pageId 及其全部后代
export type Scope =
  | { kind: "all" }
  | { kind: "subtree"; pageId: string };

export function scopeKey(s: Scope): string {
  return s.kind === "all" ? "all" : `subtree:${s.pageId}`;
}

// 判断 p 是否在 scope 范围内 — 需要全集 byId 用于沿 parentId 上溯
export function scopeMatches(s: Scope, p: PageRow, byId: Map<string, PageRow>): boolean {
  if (s.kind === "all") return true;
  let cur: PageRow | undefined = p;
  while (cur) {
    if (cur.id === s.pageId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

// ─── 布局常量 ───
const COL_WIDTH = 268;         // 焦点卡（正视）宽度 — 保持不变，作为棱柱"最窄端"基线
const COL_GAP = 92;            // 列间距 — 连线走得开，列与列亲近不疏远
const NODE_H_BASE = 48;        // 基线高度 — 缩小以让小窗内卡片更协调
const NODE_H = Math.round(NODE_H_BASE * 1.25);              // 60 — 小窗（折叠态）面高
const NODE_H_BIG = Math.round(NODE_H * 4 / 3);              // 80 — 大窗（全景态）面高 +1/3
const PAD_X = 28;
const PAD_TOP = 4;              // 列头已外置到 canvas 之上，canvas 内只留极小呼吸（4px 顶部、10px 底部）
const PAD_BOTTOM = 10;

// ─── 一体 8 棱柱（unified octagonal prism body）常量 ───
// 设计哲学：
//   ① 一体的 8 棱柱 — 不论内容数 N，视觉上始终模拟 8 个面的正棱柱
//      8 个虚拟槽位绕同一 X 轴按 45° 等分排列，相邻面共享同一条棱线
//      所有面完全等高 → 棱线整齐对齐、无台阶
//   ② 内容映射 — 槽位 k 显示的节点 = nodes[(focus + k + N) mod N]
//      → N>8 时只显示离焦点最近的 8 个；N<8 时内容循环重复填充槽位
//      → 不论 N 多少，棱柱视觉一致；任意方向滚动都无限循环
//   ③ 翻面动画 — 滚轮触发：容器 rotateX 平滑动画 ±45° → 动画完成的瞬间
//      容器复位到 0° + focus 进/退一格 + 槽位内容同步刷新
//      用户看到的是"棱柱整体翻面 → 新内容浮上中央"的连续体感
//   ④ 焦点态 = 同尺寸面 + 粗金边 + 高亮阴影 + 反白 chip（样式区分，不动几何）
//
// 几何关系：
//   8 面正棱柱：step = 45°，R = NODE_H / (2·sin(π/8)) ≈ NODE_H · 1.307
//   小窗 NODE_H=60 → R≈78.4；大窗 NODE_H=80 → R≈104.5
//   面紧贴形成闭合"纸盒子"，每个面正面平视 → 周围 2 个邻面以 45° 折叠延伸
const PRISM_SIDES = 8;
const PRISM_STEP_DEG = 360 / PRISM_SIDES;                   // 45°
// 渲染 9 个槽位（焦点 ±4）：±4 在 ±180° 即背面，被 backface-visibility 隐藏；
// 实际可见 = 焦点 + 上 3 + 下 3 = 7 个面（剩 1 个在背面绕回不可见）
const SLOT_OFFSETS_RENDER: ReadonlyArray<number> = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const PRISM_TRANSITION_MS = 280;                            // 翻面动画时长 — 280ms 兼顾流畅与响应感（原 540ms 用户觉得"翻完才看到信息"太慢）
const PRISM_R = (nodeH: number) => nodeH / (2 * Math.sin(Math.PI / PRISM_SIDES));
const PRISM_WINDOW_H = (nodeH: number) => 2 * PRISM_R(nodeH) + nodeH + 24;
const ROOT_DEFAULT_H = (nodeH: number) => 2 * nodeH;
const FIXED_CANVAS_CONTENT_H = (nodeH: number) => Math.max(ROOT_DEFAULT_H(nodeH), PRISM_WINDOW_H(nodeH));
const PRISM_PERSPECTIVE = 820;                              // 透视距离 — 适中既保立体又不过度变形

// ─── 子树聚合 ───
type Agg = { pages: number; clicks: number; impressions: number };
function aggregateSubtree(
  pageId: string,
  childrenMap: Map<string, PageRow[]>,
  byId: Map<string, PageRow>,
): Agg {
  const out: Agg = { pages: 0, clicks: 0, impressions: 0 };
  const stack = [pageId];
  while (stack.length) {
    const id = stack.pop()!;
    const p = byId.get(id);
    if (!p) continue;
    out.pages++;
    out.clicks += p.clicks;
    out.impressions += p.impressions;
    const kids = childrenMap.get(id) ?? [];
    kids.forEach((k) => stack.push(k.id));
  }
  return out;
}

interface PageTreeViewProps {
  data: PageRow[];           // 已通过 FilterBar 过滤的全集
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  onPageOpen: (p: PageRow) => void;
  // 显式 CTA：用户主动要求"把这个节点子树下的所有网址展开成列表视图"
  // 防误触原则：仅由专门的 CTA 触发，单击节点本身只做下钻 / 旋转聚焦
  onRequestListView?: (pageId: string) => void;
  expanded?: boolean;        // 全景弹层是否打开（由外层控制）
  onExpandedChange?: (e: boolean) => void;
  // 列表→树过渡微提示：外层 list→tree 切换瞬间把"最近 detail 行 id"或"scope.pageId"
  // 推过来；树视图给对应节点 1.5s 金色 glow，再回调清空。常态零干扰。
  flashNodeId?: string | null;
  onFlashConsumed?: () => void;
}

export function PageTreeView({
  data,
  scope,
  onScopeChange,
  onPageOpen,
  onRequestListView,
  expanded: expandedProp,
  onExpandedChange,
  flashNodeId,
  onFlashConsumed,
}: PageTreeViewProps) {
  // path 始终以 SITE_ROOT_ID 为首；首项以外的每一项 = 真实 pageId
  // path = [SITE_ROOT]            → 仅 C0 Logo 列
  // path = [SITE_ROOT, "__open"]  → C0 Logo + C1 一级页面列（Logo 已点开，但未选某一页）
  // path = [SITE_ROOT, pageId]    → C0 Logo + C1 列 + 该 page 的子（若有）
  const ROOT_OPEN_MARKER = "__open__";
  const buildInitialPath = (): string[] => {
    if (scope.kind === "subtree") {
      const chain = buildPathFromScope(scope.pageId, data);
      return [SITE_ROOT_ID, ...chain];
    }
    return [SITE_ROOT_ID];
  };
  const [path, setPath] = useState<string[]>(buildInitialPath);
  // 本地 path 已经主动写好、不希望被下面 scope→path 同步 effect 覆盖时用此 ref 防御
  // 典型场景：Esc 步退想保留 ROOT_OPEN 状态，但 scope 改成 all 会触发同步把 path 强制收到 [SITE_ROOT]
  const skipNextScopeToPathSync = useRef(false);

  // 列表→树过渡微提示：local mirror of flashNodeId，1.5s 后自动清空
  // 用 local state 是为了让"哪个节点要 glow"与"animation 何时启动 / 结束"完全在本组件控
  const [localFlashId, setLocalFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashNodeId) return;
    setLocalFlashId(flashNodeId);
    const t = window.setTimeout(() => {
      setLocalFlashId(null);
      onFlashConsumed?.();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [flashNodeId, onFlashConsumed]);

  // 外部 scope 变化时同步本地 path（如面包屑回到 all、列表里点其他节点）
  useEffect(() => {
    if (skipNextScopeToPathSync.current) {
      skipNextScopeToPathSync.current = false;
      return;
    }
    if (scope.kind === "all") setPath([SITE_ROOT_ID]);
    else setPath([SITE_ROOT_ID, ...buildPathFromScope(scope.pageId, data)]);
  }, [scope, data]);

  // Logo 节点是否已点开（决定 C1 一级页面列是否出现）
  const rootOpened = path.length > 1;

  // ─── 全局 byId / childrenMap（基于 data —— 已过滤集，未通过 FilterBar 的节点不出现在树里） ───
  const byId = useMemo(() => new Map(data.map((p) => [p.id, p])), [data]);
  const childrenMap = useMemo(() => {
    const m = new Map<string, PageRow[]>();
    data.forEach((p) => {
      const pid = p.parentId ?? "__root__";
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(p);
    });
    // 排序按 sortOrder（业务逻辑顺序）— 不按 clicks，避免一级页顺序"忽前忽后"
    m.forEach((arr) => arr.sort((a, b) => a.sortOrder - b.sortOrder));
    return m;
  }, [data]);

  // ─── 派生列 ───
  // C0：始终是单枚 Logo 节点（站点根，UI 概念）
  // C1：rootOpened 后才出现，列出所有一级页面（parentId 为空的真实页）
  // C2+：path[i] 选中的页的子页
  // path 结构：[SITE_ROOT_ID, page1Id?, page2Id?, ...]
  type Col = { key: string; nodes: PageRow[]; isSiteRoot?: boolean };
  const columns: Col[] = useMemo(() => {
    const cols: Col[] = [];
    cols.push({ key: "c0-site", nodes: [], isSiteRoot: true });
    if (!rootOpened) return cols;
    // C1 — 真实一级页面
    cols.push({ key: "c1-roots", nodes: childrenMap.get("__root__") ?? [] });
    // C2+ — path[1..] 选中节点的子页
    for (let i = 1; i < path.length; i++) {
      const pid = path[i];
      if (pid === ROOT_OPEN_MARKER) break;
      const kids = childrenMap.get(pid) ?? [];
      if (kids.length === 0) break; // 叶子，无下列
      cols.push({ key: `c${i + 1}-${pid}`, nodes: kids });
    }
    return cols;
  }, [childrenMap, path, rootOpened]);

  // ─── 列布局 ───
  // 所有非根、非空列都走 8 棱柱模式；N=0 显示"叶子"提示；Logo 单独 root 模式
  // height 取自 nodeH 派生（FIXED_CANVAS_CONTENT_H）—— 由 renderCanvas 注入
  type ColLayout = { mode: "root" | "prism" | "empty"; count: number };
  const computeLayouts = (): ColLayout[] =>
    columns.map((col) => {
      if (col.isSiteRoot) return { mode: "root", count: 1 };
      const N = col.nodes.length;
      if (N === 0) return { mode: "empty", count: 0 };
      return { mode: "prism", count: N };
    });

  // ─── 棱柱状态：focus(持续焦点) + rot(瞬态旋转) + busy(动画中) + skipTrans(复位帧禁用动画) ───
  // focus ∈ [0, N-1]
  // 滚动一格：rot = ±45°（容器随之动画），动画结束后 → focus 进退一格 + rot 复位 + skipTrans 一帧避免反向
  type CylState = { focus: number; rot: number; busy: boolean; skipTrans: boolean };
  const [cyls, setCyls] = useState<Record<string, CylState>>({});
  // 焦点卡 CTA 的二次确认揭示态（统一适用于叶子 & 非叶子）。
  // 流程：① 焦点切到某卡（默认 CTA 不显示，无视觉负担）
  //       ② 点焦点卡片 → 揭示 CTA（不立即执行动作）
  //          · 有子页 → 显示「N」数字框（仅数字，无文字标签）
  //          · 无子页（叶子）→ 显示「详情 →」按钮
  //       ③ 再点 CTA 才执行：数字框点击=下钻 / 详情按钮点击=切列表
  // 焦点改变（wheel / 点别的卡 / Esc）自动清空，避免"陈旧的揭示"残留
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  // busyRef — 同步标记某列是否正在翻面动画。
  // 为什么不用 cyls[colKey].busy？因为 setCyls 的 updater 是惰性执行的，
  // 在事件处理函数里 setCyls 之后立刻读 cyls 仍是旧值，没法用来做"首次调度"判定。
  // useRef 是同步的，写完立刻可读 → 安全防御 wheel 高频触发期间的重入。
  const busyRef = useRef<Record<string, boolean>>({});

  // ─── latest-ref：让 wheel 全局 handler（首次 mount 闭包捕获）能读到最新派生状态 ───
  // wheel handler 用 [] deps 注册（见 useEffect），它捕获的是首次 render 的 rotateCylinder，
  // 内部读 columns / cyls / childrenMap 会拿到陈旧值；通过 ref 把"最新值"暴露出去。
  // render 期同步写 ref 是 React 官方 useLatest 模式，安全无副作用。
  const columnsRef = useRef(columns);
  const cylsRef = useRef(cyls);
  const childrenMapRef = useRef(childrenMap);
  columnsRef.current = columns;
  cylsRef.current = cyls;
  childrenMapRef.current = childrenMap;

  // ─── 列期望焦点（从 path 推导）───
  // 防止 PageTreeView 在 list ↔ tree 切换时 unmount → cyls 局部 state 全丢 → 焦点退回 0。
  // 解决方案：当 cyls[colKey] 不存在时，用 path[colIdx] 在该列 nodes 中的索引作为默认焦点。
  // 这样即使重新 mount，scope 还在 → path 还能复原 → 焦点位置也能复原。
  const colExpectedFocus = useMemo(() => {
    const map: Record<string, number> = {};
    columns.forEach((col, i) => {
      if (col.isSiteRoot) {
        map[col.key] = 0;
        return;
      }
      const pid = path[i];
      if (!pid || pid === ROOT_OPEN_MARKER) {
        map[col.key] = 0;
        return;
      }
      const idx = col.nodes.findIndex((n) => n.id === pid);
      map[col.key] = idx >= 0 ? idx : 0;
    });
    return map;
  }, [columns, path]);

  const getCyl = (colKey: string, count: number): CylState => {
    const s = cyls[colKey];
    if (!s) {
      const expected = colExpectedFocus[colKey] ?? 0;
      const safeExpected = count > 0 ? ((expected % count) + count) % count : 0;
      return { focus: safeExpected, rot: 0, busy: false, skipTrans: false };
    }
    const safeFocus = count > 0 ? ((s.focus % count) + count) % count : 0;
    return { ...s, focus: safeFocus };
  };

  // 棱柱槽位样式 — 槽位 k（k ∈ SLOT_OFFSETS_RENDER）的 3D 位置
  //   槽位绝对角度 = k × 45°，translateZ(R) → 落在 8 棱柱表面
  //   ★ 所有槽位同高 nodeH：焦点态不改尺寸，仅靠 border/shadow/bg 区分
  //   ★ 容器整体 rotateX(rot) → rot 是瞬态翻面动画值
  const slotFaceStyle = (slotOffset: number, nodeH: number): React.CSSProperties => {
    const angleDeg = slotOffset * PRISM_STEP_DEG;
    const R = PRISM_R(nodeH);
    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: COL_WIDTH,
      height: nodeH,
      transform: `rotateX(${angleDeg}deg) translateZ(${R}px)`,
      transformOrigin: "center center",
      transformStyle: "preserve-3d",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      transition: "box-shadow 220ms, border-color 220ms, background-color 220ms",
    };
  };

  // 滚轮触发翻面（无限循环 × 翻面动画）
  //   阶段 1：rot = ±45°，触发容器 CSS transition 平滑旋转
  //   阶段 2（动画结束后）：rot = 0（瞬移）+ focus 进退一格 + 槽位内容同步 shift
  //                       + skipTrans 一帧禁用动画避免反向回旋
  //   阶段 3（下一帧）：恢复 skipTrans = false
  // 任意 N 都能无限循环：focus 在 [0, N) 内绕圈，槽位映射 (focus + k) mod N
  const rotateCylinder = (colKey: string, count: number, deltaY: number) => {
    if (count <= 0) return;
    // 同步重入防御 — busyRef 写完立刻可读，不像 setCyls 那样要等 reconciliation
    if (busyRef.current[colKey]) return;
    busyRef.current[colKey] = true;
    // 翻面 = 焦点改变 → 清空"待确认详情"的揭示态
    setPendingActionId(null);

    const step = deltaY > 0 ? 1 : -1;

    // 阶段 1：rot 设为 ±45°，容器随 CSS transition 平滑翻转
    setCyls((prev) => {
      const cur = prev[colKey] ?? { focus: 0, rot: 0, busy: false, skipTrans: false };
      return {
        ...prev,
        [colKey]: { ...cur, rot: -step * PRISM_STEP_DEG, busy: true, skipTrans: false },
      };
    });
    // 阶段 2：动画结束后 → focus 进退一格 + rot 复位 + skipTrans 一帧避免反向回旋
    //         同步触发 R31 自动展开 / 收起下游列（**延后到此处**，避免动画期间 C(N+1)"抢跑"）
    window.setTimeout(() => {
      setCyls((prev) => {
        const cur = prev[colKey] ?? { focus: 0, rot: 0, busy: false, skipTrans: false };
        const nextFocus = ((cur.focus + step) % count + count) % count;
        return {
          ...prev,
          [colKey]: { focus: nextFocus, rot: 0, busy: true, skipTrans: true },
        };
      });

      // ─── R31 下游列自动同步（在新焦点正面停稳后才执行）───
      //   · 新焦点 = 有子页的非叶子 → 把 path[colIdx] 推到该节点，C(N+1) 自动显示其子页
      //   · 新焦点 = 叶子（无子页）  → C(N+1)+ 全部消失（R30 行为）
      //   只展开一层，不递归 cascade（避免一次滚动把树全摊开）
      const colIdxMatch = colKey.match(/^c(\d+)-/);
      if (colIdxMatch) {
        const colIdx = parseInt(colIdxMatch[1]);
        if (colIdx >= 1) {
          // 用 latest-ref 取真实最新值（wheel handler 闭包持有的是首 render 的陈旧引用）
          const thisCol = columnsRef.current.find((c) => c.key === colKey);
          const N = thisCol?.nodes.length ?? 0;
          const curFocus =
            cylsRef.current[colKey]?.focus ?? colExpectedFocus[colKey] ?? 0;
          const nextFocus = N > 0 ? ((curFocus + step) % N + N) % N : 0;
          const nextNode = thisCol?.nodes[nextFocus];
          const nextKids = nextNode
            ? childrenMapRef.current.get(nextNode.id) ?? []
            : [];
          const nextHasKids = nextKids.length > 0;

          skipNextScopeToPathSync.current = true;
          if (nextHasKids && nextNode) {
            setPath((prev) => {
              const next = prev.slice(0, colIdx);
              next.push(nextNode.id);
              return next;
            });
            if (scope.kind !== "subtree" || scope.pageId !== nextNode.id) {
              onScopeChange({ kind: "subtree", pageId: nextNode.id });
            }
          } else if (colIdx === 1) {
            setPath([SITE_ROOT_ID, ROOT_OPEN_MARKER]);
          } else {
            setPath((prev) => prev.slice(0, colIdx));
          }
          // 清掉右侧旧列的 cyls / busyRef，避免"重新展开同名列时焦点错乱 / 卡 busy"
          setCyls((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((k) => {
              const m = k.match(/^c(\d+)-/);
              if (m && parseInt(m[1]) > colIdx) delete next[k];
            });
            return next;
          });
          Object.keys(busyRef.current).forEach((k) => {
            const m = k.match(/^c(\d+)-/);
            if (m && parseInt(m[1]) > colIdx) delete busyRef.current[k];
          });
        }
      }

      // 阶段 3：再下一帧恢复 transition，busy 解除（state + ref 同步释放）
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setCyls((prev) => {
          const cur = prev[colKey];
          if (!cur) return prev;
          return { ...prev, [colKey]: { ...cur, busy: false, skipTrans: false } };
        });
        busyRef.current[colKey] = false;
      }));
    }, PRISM_TRANSITION_MS);
  };

  // ─── 转轮原生 wheel 监听（{passive: false} 才能 preventDefault 阻止父容器滚动） ───
  // React 17+ 的 onWheel 默认 passive，无法 preventDefault；用 ref + useEffect 绕过
  const cylRefs = useRef<Map<string, { el: HTMLDivElement; count: number }>>(new Map());
  const registerCylRef = (colKey: string, count: number) => (el: HTMLDivElement | null) => {
    const map = cylRefs.current;
    const existing = map.get(colKey);
    if (existing && existing.el === el) {
      existing.count = count;
      return;
    }
    if (el) map.set(colKey, { el, count });
    else map.delete(colKey);
  };
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        const colKey = target.dataset?.cylCol;
        if (colKey) {
          const entry = cylRefs.current.get(colKey);
          if (entry) {
            e.preventDefault();
            e.stopPropagation();
            rotateCylinder(colKey, entry.count, e.deltaY);
          }
          return;
        }
        target = target.parentElement;
      }
    };
    document.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handler, { capture: true } as AddEventListenerOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 节点点击 ───
  // colIdx = 0：Logo 节点 — 展开 / 收起 C1
  // colIdx >= 1：真实页 — drill 或开抽屉
  const onSiteRootClick = () => {
    if (rootOpened) {
      // 收起：path 只剩 site root；若当前还选着某子树，顺便清回 all
      setPath([SITE_ROOT_ID]);
      if (scope.kind !== "all") onScopeChange({ kind: "all" });
    } else {
      // 展开。R31：若 C1 首位（默认焦点）有子页 → 直接顺势打开 C2，省一次点击
      // 关键：不调 onScopeChange，避免外层重发 scope=all 触发 useEffect 把 path 覆盖回去
      const firstRoot = (childrenMap.get("__root__") ?? [])[0];
      const firstRootHasKids =
        firstRoot && (childrenMap.get(firstRoot.id) ?? []).length > 0;
      if (firstRoot && firstRootHasKids) {
        setPath([SITE_ROOT_ID, firstRoot.id]);
      } else {
        setPath([SITE_ROOT_ID, ROOT_OPEN_MARKER]);
      }
    }
  };
  // 点击棱柱面：
  //   ① 非焦点面 → 先把它转成焦点（无翻面动画，瞬移定位），不下钻、不切视图、不开抽屉
  //      —— 等用户在焦点态再次确认意图，避免"边缘面误触一下就跳走"
  //   ② 焦点面 + 有子页 → 下钻到子层（path 推一级，新列出场）；不切视图、不开抽屉
  //   ③ 焦点面 + 叶子 → 开 DetailDrawer（单 URL 本身就是确定动作）
  // nodeIdx 是该节点在 col.nodes[] 中的索引（由槽位 + 当前 focus 反推）
  const onNodeClick = (
    colIdx: number,
    nodeIdx: number,
    node: PageRow,
    colKey: string,
    isVisualFocus: boolean,
  ) => {
    const hasChildren = (childrenMap.get(node.id) ?? []).length > 0;

    // 阶段 ① — 非焦点：先聚焦，并按 R31 自动展开 / 收起下一层
    if (!isVisualFocus) {
      // 焦点改变 → 清空"待确认详情"的揭示态
      setPendingActionId(null);
      setCyls((prev) => ({
        ...prev,
        [colKey]: { focus: nodeIdx, rot: 0, busy: false, skipTrans: true },
      }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setCyls((prev) => {
          const cur = prev[colKey];
          if (!cur) return prev;
          return { ...prev, [colKey]: { ...cur, skipTrans: false } };
        });
      }));
      // R31：新焦点有子页 → 直接展开 C(colIdx+1)；否则收掉下游列
      skipNextScopeToPathSync.current = true;
      if (hasChildren) {
        setPath((prev) => {
          const next = prev.slice(0, colIdx);
          next.push(node.id);
          return next;
        });
      } else if (colIdx === 1) {
        setPath([SITE_ROOT_ID, ROOT_OPEN_MARKER]);
      } else {
        setPath((prev) => prev.slice(0, colIdx));
      }
      // 清掉右侧旧列的 cyls / busyRef
      setCyls((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          const m = k.match(/^c(\d+)-/);
          if (m && parseInt(m[1]) > colIdx) delete next[k];
        });
        return next;
      });
      Object.keys(busyRef.current).forEach((k) => {
        const m = k.match(/^c(\d+)-/);
        if (m && parseInt(m[1]) > colIdx) delete busyRef.current[k];
      });
      // 同步面包屑/高亮，但绝不切视图（外层 onScopeChange 已不再自动切列表）
      onScopeChange({ kind: "subtree", pageId: node.id });
      return;
    }

    // 阶段 ② — 已是焦点：按是否叶子分叉
    //   · 非叶子（有子页）→ 直接下钻（数字框 CTA 默认常驻显示，本身就是动作指示器）
    //   · 叶子（无子页）→ 揭示「详情 →」按钮（二段确认才进列表，避免误触）
    //   抽屉的入口收敛到列表视图的网址行（onPageOpen 仅由列表层调用）
    if (hasChildren) {
      // 下钻：path 推一级 + 焦点改变 → 顺手清掉旧的揭示态
      setPendingActionId(null);
      const nextPath = path.slice(0, colIdx);
      nextPath.push(node.id);
      setPath(nextPath);
      onScopeChange({ kind: "subtree", pageId: node.id });
    } else {
      // 叶子：揭示详情按钮（保留二段确认）；阻断 scope→path 同步避免诡异列变化
      skipNextScopeToPathSync.current = true;
      setPendingActionId(node.id);
      onScopeChange({ kind: "subtree", pageId: node.id });
    }
  };

  // 显式 CTA（用于标题栏的"查看本子树下 N 个网址"入口）：切到列表视图
  // 卡片右上角胶囊已改为"下钻到下一层棱柱"语义（见 handleDrillIntoChildren）
  const handleRequestListView = (e: React.MouseEvent, node: PageRow) => {
    e.stopPropagation();
    if (onRequestListView) {
      onRequestListView(node.id);
    } else {
      // 兜底（独立使用 PageTreeView 时）：至少把 scope 推上去
      onScopeChange({ kind: "subtree", pageId: node.id });
    }
  };

  // 卡片右上角 CTA 胶囊"→ N 子页"——点击下钻到该节点的直接子页棱柱
  // 与父按钮的"焦点态下钻"同义，但语义更直白：胶囊上的 N 就是下一轮棱柱将显示的卡片数
  // 用 stopPropagation 阻止冒泡到父按钮，避免触发两次下钻
  const handleDrillIntoChildren = (e: React.MouseEvent | React.KeyboardEvent, node: PageRow, colIdx: number) => {
    e.stopPropagation();
    const nextPath = path.slice(0, colIdx);
    nextPath.push(node.id);
    setPath(nextPath);
    onScopeChange({ kind: "subtree", pageId: node.id });
  };

  // ─── 站点总量（Logo 卡片显示） ───
  const totalClicks = data.reduce((s, r) => s + r.clicks, 0);
  const totalImpr = data.reduce((s, r) => s + r.impressions, 0);

  // ─── 放大全景：受控（外层 IndexingClient 持有 expanded 状态） ───
  // 之所以受控——弹层打开时外层需要知道，以便"点节点 → 不要自动切到列表视图"。
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = (v: boolean) => {
    if (onExpandedChange) onExpandedChange(v);
    else setInternalExpanded(v);
  };
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // ─── 树视图 Esc 行为（modal 关闭时才生效；modal 打开时由上面 hook 接管） ───
  // 步退式：每次 Esc 只回退一层，符合"逐步取消"的直觉
  //   path = [SITE_ROOT, A, B, C]（drill 到 C）→ Esc → path = [SITE_ROOT, A, B]，scope = B
  //   path = [SITE_ROOT, A]（C1 选中 A）        → Esc → path = [SITE_ROOT, ROOT_OPEN]，scope = all（Logo 保持展开）
  //   path = [SITE_ROOT, ROOT_OPEN]              → Esc → path = [SITE_ROOT]（收起 Logo）
  //   path = [SITE_ROOT]                         → Esc 不做事（已是初始态）
  // 表单元素上的 Esc 不吞，避免影响搜索框等输入控件
  useEffect(() => {
    if (expanded) return; // modal 优先
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (path.length <= 1) return; // 已是只剩 SITE_ROOT，无可退

      e.preventDefault();
      // 步退语义（细化版，每按一次只回退一格）：
      //   [SITE_ROOT, A, B, C] → [SITE_ROOT, A, B]   （scope = B）
      //   [SITE_ROOT, A]       → [SITE_ROOT, OPEN]   （scope = all，Logo 仍开）
      //   [SITE_ROOT, OPEN]    → [SITE_ROOT]         （Logo 收起）
      const lastNow = path[path.length - 1];
      if (lastNow === ROOT_OPEN_MARKER) {
        // 当前已在 "Logo 开但未选" 态 → 收起 Logo
        setPath([SITE_ROOT_ID]);
        if (scope.kind !== "all") onScopeChange({ kind: "all" });
      } else if (path.length === 2) {
        // 当前选中了 C1 某节点 → 退到 "Logo 开但未选"
        if (scope.kind !== "all") skipNextScopeToPathSync.current = true;
        setPath([SITE_ROOT_ID, ROOT_OPEN_MARKER]);
        if (scope.kind !== "all") onScopeChange({ kind: "all" });
      } else {
        // 深层下钻态 → 退到上一层选中态
        const next = path.slice(0, -1);
        const newLast = next[next.length - 1];
        setPath(next);
        onScopeChange({ kind: "subtree", pageId: newLast });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, scope, path]);

  // ─── 标题栏 CTA 跟随"最右一列棱柱的焦点节点" ───
  // 数字语义统一为"直接子页数"(kids.length) —— 与卡片右上角数字框对齐
  // 例：C2 焦点 = /collections/tasbih（直接 2 子页）→ CTA "2 网址"
  //     用 aggregateSubtree.pages（含自身+后代=3）会与卡片数字框 2 不一致，故弃用
  // 叶子焦点（kids=0）→ CTA 隐藏，由"详情 →"按钮承担入口
  const lastColInfo = (() => {
    const lastCol = columns[columns.length - 1];
    if (!lastCol || lastCol.isSiteRoot || lastCol.nodes.length === 0) return null;
    const cyl = cyls[lastCol.key];
    const N = lastCol.nodes.length;
    const expected = colExpectedFocus[lastCol.key] ?? 0;
    const focusIdx = cyl ? (((cyl.focus % N) + N) % N) : (((expected % N) + N) % N);
    const node = lastCol.nodes[focusIdx];
    if (!node) return null;
    const kids = childrenMap.get(node.id) ?? [];
    if (kids.length === 0) return null;
    return { node, count: kids.length };
  })();

  // ─── 标题栏（主视图 + 弹层共用） ───
  const renderHeader = (isModal: boolean) => (
    <div
      className="px-3 py-2 border-b border-manor-brass/35 flex items-center gap-2"
      style={{
        background:
          "linear-gradient(180deg, rgba(26,52,36,.95) 0%, rgba(12,28,18,.97) 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(239,216,154,.2), inset 0 -1px 0 rgba(0,0,0,.45)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 9999,
          background: "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
          boxShadow: "0 0 6px rgba(239,216,154,.65)",
        }}
      />
      <h3
        className="text-brass-gradient font-serif font-semibold leading-none"
        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: isModal ? 16 : 14 }}
      >
        站点结构
      </h3>
      <span
        className="font-sc tracking-[0.32em] text-manor-brassHi leading-none"
        style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9.5 }}
      >
        {isModal ? "〔SYNAPSIS · PANORAMA〕" : "〔SYNAPSIS · STRUCTURAE〕"}
      </span>
      <span className="brass-divider flex-1 opacity-60 self-center" />
      <span
        className="text-manor-inkFaint text-[10.5px] inline-flex items-center gap-2.5"
        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
      >
        <span className="inline-flex items-center gap-1">
          <PillarMark />
          枢纽
        </span>
        <span className="inline-flex items-center gap-1">
          <SpokeMark />
          辐射
        </span>
        <span className="opacity-60">·</span>
        <span>{isModal ? "ESC / 点击外部关闭" : "点节点 → 探索下钻 · ←→ 翻面 · 焦点卡右侧 → 网址列表"}</span>
      </span>
      {/* 显式 CTA：跟随"最右一列棱柱的焦点节点"动态显示其子树 URL 数
          wheel / 点卡焦点切换都立刻同步 → 用户始终看到"最深一列正在看的那张卡"的网址规模 */}
      {lastColInfo && onRequestListView && (
        <button
          type="button"
          onClick={() => onRequestListView(lastColInfo.node.id)}
          title={`查看「${lastColInfo.node.url || "/"}」的 ${lastColInfo.count} 个直接子页（切换到列表视图）`}
          className="ml-1 inline-flex items-center gap-1.5 h-6 px-2 rounded border border-manor-brassHi/55 bg-[rgba(20,42,28,.92)] text-manor-brassHi text-[10.5px] tracking-[0.12em] hover:border-manor-brassHi hover:bg-[rgba(36,68,42,.96)] hover:shadow-[0_0_10px_-2px_rgba(239,216,154,.85)] transition-colors"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
        >
          <ListChecks size={11} strokeWidth={2.2} />
          <span className="tabular-nums">{lastColInfo.count}</span>
          <span aria-hidden="true">网址 →</span>
        </button>
      )}
      {/* Logo 未展开（无棱柱列）时的占位引导，提醒用户先打开 Logo 才能产生焦点 → 解锁 CTA */}
      {!lastColInfo && onRequestListView && (
        <span
          className="ml-1 hidden md:inline-flex items-center gap-1 h-6 px-2 rounded border border-dashed border-manor-brass/25 text-manor-inkFaint text-[10.5px] tracking-[0.08em] italic select-none"
          style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
          title="点开任一节点（聚焦后再点）以解锁本层网址列表入口"
        >
          <span aria-hidden="true" className="text-manor-brassDim">▸</span>
          点开任一节点解锁网址列表
        </span>
      )}
      <button
        type="button"
        onClick={() => setExpanded(!isModal)}
        title={isModal ? "收起全景" : "放大全景视图"}
        className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded border border-manor-brass/30 text-manor-brassDim hover:text-manor-brassHi hover:border-manor-brassHi/60 hover:bg-manor-brassDim/10 transition-colors"
      >
        {isModal ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
    </div>
  );

  // ─── 列头条（ORIGO / RADIX / STRATUM · n） ───
  // 提取到 canvas 外渲染，避免被外层 `flex items-center + overflow-hidden` 在小窗下从顶部裁切
  // 与 canvas 共用 colXAt 数学 → 列头与下方棱柱视觉对齐
  // 高度 36 = top:8 + 文字 16 + 留白 12，比之前内嵌的 PAD_TOP=40 更紧凑
  const renderColHeaderBar = (isBig: boolean) => {
    const layouts = computeLayouts();
    const colXAt = (i: number): number => PAD_X + i * (COL_WIDTH + COL_GAP);
    const barW = PAD_X * 2 + columns.length * COL_WIDTH + Math.max(0, columns.length - 1) * COL_GAP;
    return (
      <div className="relative shrink-0" style={{ width: barW, minWidth: "100%", height: 36 }}>
        {columns.map((col, i) => {
          let colTitle: string, colSubtitle: string, colCount: number;
          if (col.isSiteRoot) {
            colTitle = "ORIGO"; colSubtitle = "站点"; colCount = 1;
          } else if (i === 1) {
            colTitle = "RADIX"; colSubtitle = "一级页"; colCount = col.nodes.length;
          } else {
            colTitle = `STRATUM · ${i - 1}`; colSubtitle = `第 ${i - 1} 层`; colCount = col.nodes.length;
          }
          const layout = layouts[i];
          return (
            <div
              key={`${col.key}-hdr`}
              className="absolute flex items-center gap-1.5"
              style={{ left: colXAt(i), top: 12, width: COL_WIDTH, height: 16 }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 3, height: 3, transform: "rotate(45deg)",
                  background: "linear-gradient(135deg, #EFD89A 0%, #A08850 100%)",
                  boxShadow: "0 0 4px rgba(239,216,154,.55)",
                }}
              />
              <span
                className="font-sc tracking-[0.28em] text-manor-brassHi/80 leading-none"
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: isBig ? 10 : 9 }}
              >
                {colTitle}
              </span>
              <span
                className="text-manor-ink/90 leading-none"
                style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: isBig ? 11.5 : 10.5 }}
              >
                · {colSubtitle} ({colCount})
                {layout.mode === "prism" && (
                  <span className="text-manor-brassHi/90 ml-1 tracking-wider">· 滚轮翻面</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── 画布（棱柱节点 + SVG 流光连线）───
  // ★ canvasH 用 nodeH 派生的 FIXED_CANVAS_CONTENT_H —— 大窗(isBig)=80, 小窗=60
  // ★ 所有列垂直居中，连线锚到棱柱视觉中心，永远指向"用户在看的地方"
  const renderCanvas = (isBig: boolean) => {
    const nodeH = isBig ? NODE_H_BIG : NODE_H;
    const fixedContentH = FIXED_CANVAS_CONTENT_H(nodeH);
    const prismWindowH = PRISM_WINDOW_H(nodeH);
    const rootDefaultH = ROOT_DEFAULT_H(nodeH);

    const layouts = computeLayouts();
    const colXAt = (i: number): number => PAD_X + i * (COL_WIDTH + COL_GAP);
    const canvasW = PAD_X * 2 + columns.length * COL_WIDTH + Math.max(0, columns.length - 1) * COL_GAP;
    const canvasH = PAD_TOP + fixedContentH + PAD_BOTTOM;
    const colHeight = (i: number): number => {
      const m = layouts[i].mode;
      return m === "root" ? rootDefaultH : m === "prism" ? prismWindowH : nodeH;
    };
    const colContentTopY = (i: number): number =>
      PAD_TOP + (fixedContentH - colHeight(i)) / 2;

    // 连线锚点：所有列的视觉中心（root 卡中心 / 棱柱窗口中心）
    const nodeCenterY = (colIdx: number): number => {
      const top = colContentTopY(colIdx);
      return top + colHeight(colIdx) / 2;
    };

    // 是否已选中（决定是否画连线）
    const colHasFocus = (colIdx: number): boolean => {
      if (columns[colIdx].isSiteRoot) return true;
      if (columns[colIdx].nodes.length === 0) return false;
      // path 显式选中 OR 棱柱已展开（默认焦点=0）
      const pIdx = columns[colIdx].nodes.findIndex((n) => n.id === path[colIdx]);
      return pIdx >= 0 || layouts[colIdx].mode === "prism";
    };

    // 主连线：父列焦点 → 子列焦点（仅一条，避免 3D 旋转下连线视觉错乱）
    // 端点缩进 — 两端各离卡 22px，连线总长 92-44=48px
    // → 给箭头身体（往尖端左 10px）留显示空间，且与卡片 box-shadow 明显分离
    //   SVG zIndex=5 时若间距小，箭头滑到末端会视觉"压住卡片"
    const EDGE_INSET_FROM = 22;
    const EDGE_INSET_TO = 22;
    const mainEdges: Array<{ fromX: number; fromY: number; toX: number; toY: number; key: string }> = [];
    for (let i = 1; i < columns.length; i++) {
      if (!colHasFocus(i - 1) || !colHasFocus(i)) continue;
      mainEdges.push({
        fromX: colXAt(i - 1) + COL_WIDTH + EDGE_INSET_FROM,
        fromY: nodeCenterY(i - 1),
        toX: colXAt(i) - EDGE_INSET_TO,
        toY: nodeCenterY(i),
        key: `${columns[i - 1].key}->${columns[i].key}`,
      });
    }

    // ★ SVG defs ID 必须按 isBig 隔离 — 主视图和全景同时挂载时，
    //   重复 ID 会让 url(#xxx) / marker-end / mpath 全部串台到第一个匹配项，
    //   造成"流动元素和线分离"的视觉 BUG。
    const idTag = isBig ? "big" : "sm";

    return (
      <div
        className="relative"
        style={{ width: canvasW, height: canvasH, minWidth: "100%" }}
      >
        <svg
          className="absolute inset-0 pointer-events-none"
          width={canvasW}
          height={canvasH}
          style={{ overflow: "visible", zIndex: 5 }}
        >
          <defs>
            <filter id={`glow-${idTag}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* 强 glow — 专给末端电流箭头用，更"灼热" */}
            <filter id={`glowStrong-${idTag}`} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* 电流图标箭头 — 三层叠：外光晕 / 主体金 / 内核高光，整体配 glow */}
            <marker
              id={`arrow-${idTag}`}
              viewBox="0 0 12 12"
              refX="10.5"
              refY="6"
              markerWidth="10"
              markerHeight="10"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <g filter={`url(#glowStrong-${idTag})`}>
                {/* 外圈光晕 */}
                <path d="M 0 0.5 L 11.5 6 L 0 11.5 z" fill="#A08850" opacity="0.55" />
                {/* 主体金箭 */}
                <path d="M 1.6 2 L 10.6 6 L 1.6 10 z" fill="#F8E6B0" />
                {/* 内核高光 */}
                <path d="M 3.4 4 L 9 6 L 3.4 8 z" fill="#FFF6D2" />
              </g>
            </marker>
          </defs>

          {mainEdges.map((e, i) => {
            const dx = (e.toX - e.fromX) * 0.55;
            const d = `M ${e.fromX} ${e.fromY} C ${e.fromX + dx} ${e.fromY}, ${e.toX - dx} ${e.toY}, ${e.toX} ${e.toY}`;
            // CSS offset-path 驱动流动 — React 19 下 SMIL animateMotion 不可靠（实测 CTM 不动），
            // 改用现代 SVG/CSS 标准 offset-path + offset-distance keyframes，Chrome 原生稳定。
            // 单个箭头沿 path 从左向右循环奔跑，DUR=1.2s（比上一版 1.87s 再快约 1.5 倍）。
            const offsetPath = `path('${d}')`;
            const DUR = "1.2s";
            const DELAYS = ["0s"];
            return (
              <g key={e.key}>
                {/* ① 底线 — 连续暗金电缆，连接关系始终在场 */}
                <path
                  d={d}
                  stroke="rgba(212,179,111,.55)"
                  strokeWidth={1.6}
                  fill="none"
                />
                {/* ② 单个金箭头沿 path 从左奔向右 — 持续流动既视感
                    箭头三层叠：外光晕 + 主体金 + 高光芯，整组带强 glow */}
                {DELAYS.map((delay, k) => (
                  <g
                    key={k}
                    filter={`url(#glowStrong-${idTag})`}
                    style={{
                      offsetPath,
                      offsetRotate: "auto",
                      animation: `pageTreeFlow ${DUR} linear ${delay} infinite`,
                    }}
                  >
                    <polygon points="-7,-4.2 0,0 -7,4.2" fill="#A08850" opacity="0.55" />
                    <polygon points="-5.6,-3.2 0,0 -5.6,3.2" fill="#F8E6B0" />
                    <polygon points="-3.2,-1.7 0,0 -3.2,1.7" fill="#FFF6D2" />
                  </g>
                ))}
              </g>
            );
          })}
        </svg>

        {columns.map((col, i) => {
          const layout = layouts[i];
          const x = colXAt(i);
          const contentTop = colContentTopY(i);
          const colH = colHeight(i);
          return (
            <div key={col.key} className="absolute" style={{ left: x, top: 0, width: COL_WIDTH }}>
              {/* 列头条已提取到 renderColHeaderBar — canvas 内不再渲染，避免被 items-center 裁切 */}

              {/* C0：Logo 节点（高度 ROOT_DEFAULT_H = 2*nodeH，与棱柱视觉等量；开/关只改色与 CTA 文案） */}
              {col.isSiteRoot && (() => {
                return (
                <div
                  key={`${col.key}-anim`}
                  className="column-anim absolute"
                  style={{ left: 0, top: contentTop, width: COL_WIDTH, height: colH }}
                >
                  <button
                    type="button"
                    onClick={onSiteRootClick}
                    title={rootOpened ? "收起一级页面" : "点击展开一级页面"}
                    className={[
                      "group relative text-left w-full h-full",
                      "border-[1.5px] rounded-md flex flex-col justify-center px-3.5 py-2.5 pr-10",
                      "transition-[border-color,background-color,box-shadow] duration-300",
                      rootOpened
                        ? "border-manor-brassHi/85 bg-[rgba(54,86,46,.95)] shadow-[0_0_28px_-3px_rgba(239,216,154,.9)]"
                        : "border-manor-brassHi/55 bg-[rgba(28,52,32,.92)] shadow-[0_0_22px_-4px_rgba(239,216,154,.55)] hover:border-manor-brassHi/85 hover:bg-[rgba(48,76,42,.96)] hover:shadow-[0_0_32px_-3px_rgba(239,216,154,.85)]",
                    ].join(" ")}
                  >
                    {/* ▸ 始终向右、永远垂直居中（用 flex 容器保证视觉中线对齐文字基线）
                        展开/未展开只改颜色亮度，方向不变 */}
                    <span
                      aria-hidden="true"
                      className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
                      style={{ width: 28 }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                          fontSize: 16,
                          lineHeight: 1,
                          letterSpacing: "0.18em",
                          color: rootOpened ? "rgba(248,230,176,1)" : "rgba(212,179,111,.7)",
                          transition: "color 250ms ease-out",
                        }}
                      >
                        ▸
                      </span>
                    </span>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        style={{
                          width: 24, height: 24, borderRadius: 9999,
                          background: rootOpened
                            ? "radial-gradient(circle at 30% 30%, #F8E6B0 0%, #D4B36F 55%, #6F5A30 100%)"
                            : "radial-gradient(circle at 30% 30%, #F8E6B0 0%, #C9A85F 55%, #6A5226 100%)",
                          boxShadow: rootOpened
                            ? "0 0 16px rgba(239,216,154,.95), inset 0 0 5px rgba(255,255,255,.45)"
                            : "0 0 16px rgba(239,216,154,.85), inset 0 0 5px rgba(255,255,255,.4)",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Globe2 size={13} color="#2a1f0e" strokeWidth={2.5} />
                      </span>
                      <span
                        className="flex-1 min-w-0 truncate font-serif text-brass-gradient font-semibold tracking-wide"
                        style={{
                          fontFamily: "var(--font-serif), 'EB Garamond', serif",
                          fontSize: 16,
                        }}
                      >
                        {SITE_NAME}
                      </span>
                    </div>
                    <div
                      className={[
                        "flex items-center gap-1.5 mt-3 min-w-0 tabular-nums whitespace-nowrap overflow-hidden transition-colors",
                        // 展开后背景变亮 → 灰字反差不足，提白增强对比；关闭态保留原 dim 暗调
                        rootOpened ? "text-[#FBF1D9]" : "text-manor-inkDim",
                      ].join(" ")}
                      style={{
                        fontFamily: "var(--font-serif), 'EB Garamond', serif",
                        fontSize: 10.5,
                        textShadow: rootOpened ? "0 1px 0 rgba(0,0,0,0.6)" : undefined,
                      }}
                    >
                      <span>{data.length} 页</span>
                      <span className="opacity-60">·</span>
                      <span>{totalClicks.toLocaleString()} 点击</span>
                      <span className="opacity-60">·</span>
                      <span>{formatLargeNumber(totalImpr)} 曝光</span>
                    </div>
                    <div
                      className="mt-1.5 tracking-[0.14em] text-center whitespace-nowrap transition-colors"
                      style={{
                        fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                        fontSize: 9.5,
                        // 展开后改用近白色 + 黑描边，亮背景下依然清晰
                        color: rootOpened ? "rgba(255,250,230,.95)" : "rgba(239,216,154,.85)",
                        textShadow: rootOpened ? "0 1px 0 rgba(0,0,0,0.6)" : undefined,
                      }}
                    >
                      {rootOpened ? "▾ 已展开 · OPENED ▾" : "— 点击展开 · CLICK TO EXPAND —"}
                    </div>
                  </button>
                </div>
                );
              })()}

              {/* C1+：8 棱柱节点容器（任意 N >= 1 都走棱柱） */}
              {!col.isSiteRoot && col.nodes.length > 0 && (
                <div
                  key={`${col.key}-anim`}
                  className="column-anim absolute focus:outline-none"
                  ref={registerCylRef(col.key, layout.count)}
                  data-cyl-col={col.key}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    // 键盘可达性 — ←/↑ 翻到上一面（相当于 wheel deltaY<0）；→/↓ 翻到下一面
                    // PageUp/PageDown 走 3 格快速翻；Home 回到 path 指定的"期望焦点"
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      rotateCylinder(col.key, layout.count, -100);
                    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                      e.preventDefault();
                      rotateCylinder(col.key, layout.count, 100);
                    } else if (e.key === "PageUp") {
                      e.preventDefault();
                      // 连续 3 次（异步，每次有动画间隔；这里直接跳到 focus-3 也行，但保动画一致用循环）
                      for (let k = 0; k < 3; k++) {
                        setTimeout(() => rotateCylinder(col.key, layout.count, -100), k * (PRISM_TRANSITION_MS + 20));
                      }
                    } else if (e.key === "PageDown") {
                      e.preventDefault();
                      for (let k = 0; k < 3; k++) {
                        setTimeout(() => rotateCylinder(col.key, layout.count, 100), k * (PRISM_TRANSITION_MS + 20));
                      }
                    }
                  }}
                  style={{
                    left: 0,
                    top: contentTop,
                    width: COL_WIDTH,
                    height: colH,
                    perspective: PRISM_PERSPECTIVE,
                    perspectiveOrigin: "center center",
                    overflow: "visible",
                  }}
                >
                  {(() => {
                    const N = layout.count;
                    const cyl = getCyl(col.key, N);
                    const { focus, rot, skipTrans } = cyl;

                    const renderFace = (node: PageRow, nodeIdx: number, slotOffset: number) => {
                      const kids = childrenMap.get(node.id) ?? [];
                      const isLeaf = kids.length === 0;
                      const isPillar = !!node.isPillar;
                      const isSubHub = !isLeaf && !isPillar;
                      const subAgg = isLeaf
                        ? { pages: 1, clicks: node.clicks, impressions: node.impressions }
                        : aggregateSubtree(node.id, childrenMap, byId);
                      const isVisualFocus = slotOffset === 0;
                      // 内容密度按"离焦距离"递进 —— 棱柱透视投影会把远槽位压扁，
                      // 强行塞两行会重叠糊作一团。距焦点越远，内容越精简：
                      //   0  →  完整双行（chip 前置 + CLK/IMP 数字栏）
                      //   ±1 →  单行（chip + url + pageType 极简）
                      //   ±2+→  仅 url 行（避免内容超出投影厚度）
                      const dist = Math.abs(slotOffset);
                      const showMetricsRow = dist === 0;
                      const showPageType = dist <= 1;

                      let borderCls = "border-manor-brassDim/70";
                      let bgCls = "bg-[rgba(34,60,42,.97)]";
                      if (isPillar) {
                        borderCls = "border-manor-brassHi/80 border-[1.5px]";
                        bgCls = "bg-[rgba(58,88,52,.97)]";
                      } else if (isSubHub) {
                        borderCls = "border-manor-brassDim/75";
                      }
                      const selectedCls = isVisualFocus
                        // 焦点态背景从原亮绿改为更深绿 — 浅色字对比度↑、金光晕从 44px 收紧到 30px 防"光斑遮卡"
                        ? "border-manor-brassHi! shadow-[0_0_0_2px_rgba(239,216,154,.95),0_0_30px_-4px_rgba(239,216,154,.85)] bg-[rgba(28,52,32,1)]!"
                        : "hover:border-manor-brassHi/80";
                      const isFlashing = localFlashId === node.id;
                      const flashCls = isFlashing ? "ptv-node-flash" : "";

                      // 棱面 = 紧贴的硬边平面 → 上沿金 / 下沿黑两条棱线
                      const prismShadow = !isVisualFocus
                        ? "inset 0 2px 0 rgba(239,216,154,.30), inset 0 -2px 0 rgba(0,0,0,.55)"
                        : undefined;

                      // 焦点态文案 — 引导用户区分"下钻"和"切列表"两条路径，防止误触
                      // 非焦点态简化为"先聚焦"，按一下不会跳走
                      const titleText = !isVisualFocus
                        ? "点击聚焦此节点（不会切换视图）"
                        : isLeaf
                          ? "叶子页 · 点击查看 URL 详情"
                          : `${kids.length} 个子页 · 点击下钻；查看本层所有网址请点右侧 → 网址`;
                      // 始终双行内容（同高棱柱 → 内容密度统一），焦点靠样式区分
                      return (
                        <button
                          key={`${col.key}-slot-${slotOffset}`}
                          type="button"
                          onClick={() => onNodeClick(i, nodeIdx, node, col.key, isVisualFocus)}
                          title={titleText}
                          // Tab 单焦点策略：每列只焦点卡进 Tab 序，非焦点卡被 Tab 跳过
                          // 仍可鼠标点击聚焦它们；防止用户 Tab 误进 9 个虚拟槽位
                          tabIndex={isVisualFocus ? 0 : -1}
                          aria-current={isVisualFocus ? "true" : undefined}
                          className={[
                            "group text-left flex flex-col justify-center px-3.5 border rounded-md overflow-hidden",
                            // 右内边距按是否有焦点 CTA 区分：焦点态 CTA 胶囊 ≈ 72px 宽，留 pr-20；
                            // 非焦点态只有 24px 装饰箭头，pr-10 即可（不浪费内容区）
                            isVisualFocus ? "pr-20" : "pr-10",
                            borderCls,
                            bgCls,
                            selectedCls,
                            flashCls,
                          ].join(" ")}
                          style={{
                            ...slotFaceStyle(slotOffset, nodeH),
                            ...(prismShadow ? { boxShadow: prismShadow } : {}),
                            // 纵深感：远槽位文字渐淡，模拟"焦点近、远槽渐隐"
                            // 抬升下限避免远槽过淡看不清（之前 0.32 → 0.6 阈值）
                            opacity: dist === 0 ? 1 : dist === 1 ? 0.92 : dist === 2 ? 0.72 : 0.6,
                            // 字渲染质量提升 —— 焦点态走优先质量管线，其余保持默认（默认更快）
                            // 焦点：antialiased(灰阶子像素) + optimizeLegibility(开启连字/字偶) + isolation 隔离合成层
                            // 让 GPU 在 3D 投影下仍保留较高文字清晰度
                            WebkitFontSmoothing: isVisualFocus ? "antialiased" : "subpixel-antialiased",
                            MozOsxFontSmoothing: isVisualFocus ? "grayscale" : "auto",
                            textRendering: isVisualFocus ? "optimizeLegibility" : "auto",
                            isolation: isVisualFocus ? "isolate" : "auto",
                          } as React.CSSProperties}
                        >
                          {/* 焦点态：原内容隐藏（仅保留 face 棱面外形作占位），文字由 axis 外的 focus overlay 渲染（2D，不参与 3D 投影，字锐利） */}
                          <div
                            className="flex flex-col w-full"
                            style={{
                              opacity: isVisualFocus ? 0 : 1,
                              transition: "opacity 120ms ease-out",
                            }}
                          >
                          {/* 右侧入口区 —
                              ① 焦点 + 非叶子 → "→ N 网址" 独立 CTA 胶囊（点击切列表，stopPropagation 防误触）
                              ② 焦点 + 叶子 → "→ 详情" 装饰标签（点击 = 父按钮 onClick = 开抽屉，与父点击同义；视觉对称）
                              ③ 其它态 → 仅装饰图标（◦ 叶子 / ▸ 下钻） */}
                          {isVisualFocus && !isLeaf ? (
                            // 焦点 + 非叶子 → 数字框常驻显示（仅 N，无文字标签）
                            // 点 = 下钻；与点卡片体同义，但提供独立可读的"子页数"指示器
                            <span
                              aria-hidden="false"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleDrillIntoChildren(e, node, i)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDrillIntoChildren(e, node, i);
                                }
                              }}
                              title={`下钻 · ${kids.length} 个直接子页`}
                              data-cta-pill="true"
                              className="ptv-cta-pulse absolute right-1.5 top-1 inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-[3px] border border-manor-brassHi/70 bg-[rgba(20,42,28,.92)] text-manor-brassHi text-[12px] font-semibold tabular-nums hover:border-manor-brassHi hover:bg-[rgba(36,68,42,.96)] hover:shadow-[0_0_14px_-2px_rgba(239,216,154,.95)] transition-colors cursor-pointer select-none"
                              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                            >
                              {kids.length}
                            </span>
                          ) : isVisualFocus && isLeaf && pendingActionId === node.id ? (
                            // 焦点 + 叶子 + 已点击揭示 → "详情 →" CTA：再点一次才切到列表视图
                            // 默认 CTA 不显示（无视觉负担），需用户先点卡片"宣告意图"
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { setPendingActionId(null); handleRequestListView(e, node); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setPendingActionId(null);
                                  handleRequestListView(e as unknown as React.MouseEvent, node);
                                }
                              }}
                              title="查看本页详情 → 切到列表视图（抽屉只能从列表网址行打开）"
                              data-cta-pill="true"
                              className="ptv-cta-pulse absolute right-1.5 top-1 inline-flex items-center gap-1 px-2 h-6 rounded-[3px] border border-manor-brassHi/70 bg-[rgba(20,42,28,.92)] text-manor-brassHi text-[10.5px] tracking-[0.12em] hover:border-manor-brassHi hover:bg-[rgba(36,68,42,.96)] hover:shadow-[0_0_14px_-2px_rgba(239,216,154,.95)] transition-colors cursor-pointer select-none"
                              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
                            >
                              <span aria-hidden="true">详情</span>
                              <span aria-hidden="true" className="ptv-cta-arrow">→</span>
                            </span>
                          ) : (
                            <span
                              aria-hidden="true"
                              className={[
                                "absolute right-0 top-0 bottom-0 flex items-center justify-center",
                                // 非焦点卡片：hover 时让箭头亮起 + 微微右移，暗示"点击会聚焦"
                                !isVisualFocus ? "ptv-focus-hint" : "",
                              ].join(" ")}
                              style={{ width: 24 }}
                            >
                              <span
                                className="ptv-focus-hint-arrow"
                                style={{
                                  fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                                  fontSize: 13,
                                  lineHeight: 1,
                                  letterSpacing: "0.18em",
                                  color: isLeaf
                                    ? isVisualFocus
                                      ? "rgba(248,230,176,1)"
                                      : "rgba(160,136,80,.55)"
                                    : "rgba(212,179,111,.85)",
                                  transition: "color 250ms ease-out, transform 250ms ease-out",
                                  display: "inline-block",
                                }}
                              >
                                {isLeaf ? "◦" : "▸"}
                              </span>
                            </span>
                          )}
                          <div className="flex items-center gap-2 min-w-0">
                            {isPillar ? <PillarMark /> : <SpokeMark dim={!isVisualFocus} />}
                            <IndexStateDot state={node.indexState} size={6} />
                            {/* 子页数 chip 已删 —— 与右上角"→ N 网址" CTA 概念冲突（都表达"卡下面有多少"）
                                统一用 CTA 一个数字作为"子树规模"指示器，URL 行只承担"我是谁"的语义 */}
                            {node.url === "/" && <HomeIcon size={11} className="shrink-0 text-manor-brassDim" />}
                            <span
                              className={[
                                "flex-1 min-w-0 truncate",
                                // 字号按距离分层：焦点 14 / 邻面 13.5 / 远槽 13；字重均 semibold（仅焦点超粗）
                                // 邻面字号略大 + 加深描边 → 在 3D 投影下仍能读清
                                isVisualFocus
                                  ? "text-[14px] font-semibold text-[#FBF1D9]"
                                  : dist === 1
                                    ? "text-[13.5px] font-semibold text-[#F2EBD5]"
                                    : "text-[13px] font-medium text-manor-ink",
                              ].join(" ")}
                              style={{
                                // 描边按距离分层：焦点双层 / 邻面加深 / 远槽轻描
                                // 强描边在 3D 投影下能让字"压"在背景上，不被金绿底色吞掉
                                textShadow: isVisualFocus
                                  ? "0 1px 0 rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.5)"
                                  : dist === 1
                                    ? "0 1px 0 rgba(0,0,0,0.75), 0 0 1px rgba(0,0,0,0.5)"
                                    : "0 1px 0 rgba(0,0,0,0.55)",
                                letterSpacing: "0.01em",
                              }}
                            >
                              {node.url || "/"}
                            </span>
                          </div>
                          {showMetricsRow ? (
                            <div
                              className="flex items-center gap-1.5 mt-1 min-w-0"
                              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                            >
                              <span className="shrink-0">
                                <PageTypeChip value={node.pageType} size="sm" />
                              </span>
                              <span className="flex-1 min-w-0" />
                              {/* 数字栏位明确化 —— CLK / IMP / CTR 微型上标 + 数字间柔分隔点
                                  CTR = clicks / impressions（百分比），由 CLK 和 IMP 派生但单独显示效率指标
                                  R20：缩小到 label 8.5 / num 11px + gap-1.5，避免 3 个指标 + chip + CTA 把宽度撑爆 */}
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#F0E2B5]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/85 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  CLK
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {subAgg.clicks > 0 ? subAgg.clicks.toLocaleString() : "—"}
                                </span>
                              </span>
                              <span aria-hidden="true" className="shrink-0 text-manor-brass/40 text-[9px]">·</span>
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#D9C9A0]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/75 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  IMP
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {subAgg.impressions > 0 ? formatLargeNumber(subAgg.impressions) : "—"}
                                </span>
                              </span>
                              <span aria-hidden="true" className="shrink-0 text-manor-brass/40 text-[9px]">·</span>
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#C8B68A]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/70 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  CTR
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {subAgg.impressions > 0 ? `${(subAgg.clicks / subAgg.impressions * 100).toFixed(1)}%` : "—"}
                                </span>
                              </span>
                            </div>
                          ) : showPageType ? (
                            // ±1 槽位 —— 投影中度压扁；只保留 pageType chip 一条次行，数字行省略
                            <div className="flex items-center gap-2 mt-0.5 min-w-0">
                              <span className="shrink-0 opacity-80">
                                <PageTypeChip value={node.pageType} size="sm" />
                              </span>
                            </div>
                          ) : null}
                          </div>
                        </button>
                      );
                    };

                    // 一体 8 棱柱：9 个虚拟槽位（focus ±4），内容按 (focus + offset) mod N 映射
                    //   N<8 时槽位内容会循环重复（"无限循环"原则）
                    //   N>=8 时只显示离焦点最近的 8 张
                    //   容器 rotateX(rot) — rot 在 0 / ±45° 间动画，复位时同步 focus shift
                    // ─── focus 2D 飘浮副本 ───
                    // axis div 内的所有 face 都在 preserve-3d 上下文 → GPU 合成层 → 文字糊
                    // overlay 在 axis 同级（column-anim 内、preserve-3d 外）→ 纯 2D 渲染 → 文字锐利
                    // 翻面动画期间 cyl.busy=true → overlay opacity 0；动画结束 busy=false → opacity 1
                    // 时序刚好：旧焦点内容淡出 → axis 翻完 → focus 已更新 → 新焦点内容淡入
                    const focusNode = col.nodes[focus];
                    const focusKids = focusNode ? (childrenMap.get(focusNode.id) ?? []) : [];
                    const focusIsLeaf = focusKids.length === 0;
                    const focusIsPillar = !!focusNode?.isPillar;
                    const focusSubAgg = focusNode
                      ? (focusIsLeaf
                          ? { pages: 1, clicks: focusNode.clicks, impressions: focusNode.impressions }
                          : aggregateSubtree(focusNode.id, childrenMap, byId))
                      : { pages: 0, clicks: 0, impressions: 0 };
                    const focusBorderCls = focusIsPillar
                      ? "border-manor-brassHi/80 border-[1.5px]"
                      : "border-manor-brassHi";
                    return (
                      <>
                        <div
                          key={`${col.key}-axis`}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            width: COL_WIDTH,
                            height: nodeH,
                            marginTop: -nodeH / 2,
                            transformStyle: "preserve-3d",
                            transform: `rotateX(${rot}deg)`,
                            transition: skipTrans
                              ? "none"
                              : `transform ${PRISM_TRANSITION_MS}ms cubic-bezier(0.22, 0.65, 0.3, 1)`,
                            willChange: "transform",
                          }}
                        >
                          {SLOT_OFFSETS_RENDER.map((slotOffset) => {
                            const nodeIdx = ((focus + slotOffset) % N + N) % N;
                            const node = col.nodes[nodeIdx];
                            return renderFace(node, nodeIdx, slotOffset);
                          })}
                        </div>
                        {/* ─ focus 2D 飘浮副本（焦点文字真正锐利之处）─ */}
                        {focusNode && (
                          <button
                            key={`${col.key}-focus-overlay`}
                            type="button"
                            onClick={() => onNodeClick(i, focus, focusNode, col.key, true)}
                            title={focusIsLeaf
                              ? "叶子页 · 点击切到列表查看详情"
                              : `${focusKids.length} 个子页 · 点击下钻到下一层棱柱`}
                            tabIndex={-1}
                            aria-hidden="true"
                            className={[
                              "group text-left flex flex-col justify-center px-3.5 pr-20 border rounded-md overflow-hidden",
                              focusBorderCls,
                              "bg-transparent",
                            ].join(" ")}
                            style={{
                              position: "absolute",
                              left: 0,
                              top: "50%",
                              width: COL_WIDTH,
                              height: nodeH,
                              marginTop: -nodeH / 2,
                              opacity: cyl.busy ? 0 : 1,
                              // 透视同步：原焦点 face 在 axis 内被 translateZ(R) 拉到观察者前 R 距离，
                              // perspective 透视后视觉放大比 = P/(P-R)。overlay 不在 3D 内、不被透视，
                              // 必须用 2D scale 模拟该放大，否则 overlay 视觉小一圈、跟原 face 错位。
                              // scale 是 2D transform，仍保留字体的 CPU subpixel 渲染（不 GPU 合成糊化）。
                              transform: `scale(${PRISM_PERSPECTIVE / (PRISM_PERSPECTIVE - PRISM_R(nodeH))})`,
                              transformOrigin: "center center",
                              transition: "opacity 80ms ease-out",
                              zIndex: 10,
                              // 关键：subpixel-antialiased + 默认 text-rendering → 2D 渲染管线最优
                              WebkitFontSmoothing: "subpixel-antialiased",
                              MozOsxFontSmoothing: "auto",
                              textRendering: "optimizeLegibility",
                              // 边框 / 背景留给底下原 face，自身只画"内容外形" — 透明边框允许底层金边透出
                              borderColor: "transparent",
                            }}
                          >
                            {/* CTA 胶囊 / 详情标签 */}
                            {!focusIsLeaf ? (
                              // 非叶子 → 数字框常驻显示（仅 N，无文字标签）；点 = 下钻
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleDrillIntoChildren(e, focusNode, i)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDrillIntoChildren(e, focusNode, i);
                                  }
                                }}
                                title={`下钻 · ${focusKids.length} 个直接子页`}
                                data-cta-pill="true"
                                className="ptv-cta-pulse absolute right-1.5 top-1 inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-[3px] border border-manor-brassHi/70 bg-[rgba(20,42,28,.92)] text-manor-brassHi text-[12px] font-semibold tabular-nums hover:border-manor-brassHi hover:bg-[rgba(36,68,42,.96)] hover:shadow-[0_0_14px_-2px_rgba(239,216,154,.95)] transition-colors cursor-pointer select-none"
                                style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                              >
                                {focusKids.length}
                              </span>
                            ) : focusIsLeaf && pendingActionId === focusNode.id ? (
                              // 叶子 + 已点击揭示 → "详情 →" CTA：再点一次才切到列表视图
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { setPendingActionId(null); handleRequestListView(e, focusNode); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setPendingActionId(null);
                                    handleRequestListView(e as unknown as React.MouseEvent, focusNode);
                                  }
                                }}
                                title="查看本页详情 → 切到列表视图（抽屉只能从列表网址行打开）"
                                data-cta-pill="true"
                                className="ptv-cta-pulse absolute right-1.5 top-1 inline-flex items-center gap-1 px-2 h-6 rounded-[3px] border border-manor-brassHi/70 bg-[rgba(20,42,28,.92)] text-manor-brassHi text-[10.5px] tracking-[0.12em] hover:border-manor-brassHi hover:bg-[rgba(36,68,42,.96)] hover:shadow-[0_0_14px_-2px_rgba(239,216,154,.95)] transition-colors cursor-pointer select-none"
                                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
                              >
                                <span aria-hidden="true">详情</span>
                                <span aria-hidden="true" className="ptv-cta-arrow">→</span>
                              </span>
                            ) : null}
                            {/* url 行 */}
                            <div className="flex items-center gap-2 min-w-0">
                              {focusIsPillar ? <PillarMark /> : <SpokeMark dim={false} />}
                              <IndexStateDot state={focusNode.indexState} size={6} />
                              {/* 子页数 chip 已删 —— 与右上角 CTA 概念冲突，统一用 CTA 表达"子树规模" */}
                              {focusNode.url === "/" && <HomeIcon size={11} className="shrink-0 text-manor-brassDim" />}
                              <span
                                className="flex-1 min-w-0 truncate text-[14px] font-semibold text-[#FBF1D9]"
                                style={{
                                  textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.5)",
                                  letterSpacing: "0.01em",
                                }}
                              >
                                {focusNode.url || "/"}
                              </span>
                            </div>
                            {/* metrics 行 */}
                            <div
                              className="flex items-center gap-1.5 mt-1 min-w-0"
                              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                            >
                              <span className="shrink-0">
                                <PageTypeChip value={focusNode.pageType} size="sm" />
                              </span>
                              <span className="flex-1 min-w-0" />
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#F0E2B5]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/85 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  CLK
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {focusSubAgg.clicks > 0 ? focusSubAgg.clicks.toLocaleString() : "—"}
                                </span>
                              </span>
                              <span aria-hidden="true" className="shrink-0 text-manor-brass/40 text-[9px]">·</span>
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#D9C9A0]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/75 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  IMP
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {focusSubAgg.impressions > 0 ? formatLargeNumber(focusSubAgg.impressions) : "—"}
                                </span>
                              </span>
                              <span aria-hidden="true" className="shrink-0 text-manor-brass/40 text-[9px]">·</span>
                              <span
                                className="shrink-0 inline-flex items-baseline gap-[2px] tabular-nums text-[#C8B68A]"
                                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}
                              >
                                <span
                                  className="text-manor-brassHi/70 tracking-[0.10em] font-semibold"
                                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 8.5 }}
                                >
                                  CTR
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {focusSubAgg.impressions > 0 ? `${(focusSubAgg.clicks / focusSubAgg.impressions * 100).toFixed(1)}%` : "—"}
                                </span>
                              </span>
                            </div>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* 空列占位（无子树的叶子列） */}
              {!col.isSiteRoot && col.nodes.length === 0 && (
                <div
                  className="absolute text-manor-inkGhost text-[11px] italic"
                  style={{ top: contentTop, left: 8 }}
                >
                  叶子节点
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-3 h-full flex flex-col">
      <div className="glass-panel overflow-hidden flex-1 flex flex-col min-h-0" style={{ borderRadius: 4 }}>
        {renderHeader(false)}
        {/* 主视图：小窗 nodeH=60；列头条单独挂在顶部（不被 items-center 裁切）；canvas 居中 */}
        <div className="shrink-0 overflow-hidden">
          {renderColHeaderBar(false)}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex items-center">
          {renderCanvas(false)}
        </div>
      </div>

      {/* 放大全景：fixed overlay + 同一棵树（共享 state） */}
      {expanded && mounted && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{
            background: "rgba(6,12,8,.78)",
            backdropFilter: "blur(6px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div
            className="glass-panel overflow-hidden flex flex-col"
            style={{
              width: "94vw",
              height: "92vh",
              maxWidth: 1840,
              borderRadius: 6,
              boxShadow:
                "0 0 0 1px rgba(239,216,154,.25), 0 20px 60px -10px rgba(0,0,0,.8), 0 0 40px -4px rgba(239,216,154,.18)",
            }}
          >
            {renderHeader(true)}
            {/* 全景：大窗 nodeH=80，列头条单独挂顶，canvas 居中铺满弹层 */}
            <div className="shrink-0 overflow-hidden">
              {renderColHeaderBar(true)}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden flex items-center">
              {renderCanvas(true)}
            </div>
          </div>
        </div>,
        document.body
      )}

      <style jsx>{`
        .column-anim {
          animation: colSlideIn 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        @keyframes colSlideIn {
          0%   { opacity: 0; transform: translateX(-24px); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {/* 全局 keyframes — offset-distance 0%→100% 让箭头沿 offset-path 走完一遍
          用 :global 是因为目标元素（SVG g）在 JSX 里没有承载 styled-jsx 局部类的 className */}
      <style jsx global>{`
        @keyframes pageTreeFlow {
          from { offset-distance: 0%; }
          to   { offset-distance: 100%; }
        }
        /* CTA 胶囊柔和金色 pulse —— 引导眼球到"切列表"路径
           不抢戏：仅在非 hover 时呼吸；hover 即停（避免动态干扰精确点击） */
        @keyframes ptvCtaPulse {
          0%   { box-shadow: 0 0 0 0 rgba(239,216,154,0.55), 0 0 6px -1px rgba(239,216,154,0.35); }
          55%  { box-shadow: 0 0 0 5px rgba(239,216,154,0),    0 0 14px -1px rgba(239,216,154,0.65); }
          100% { box-shadow: 0 0 0 0 rgba(239,216,154,0),      0 0 6px -1px rgba(239,216,154,0.35); }
        }
        .ptv-cta-pulse {
          animation: ptvCtaPulse 2.4s cubic-bezier(.4,0,.2,1) infinite;
        }
        .ptv-cta-pulse:hover {
          animation: none;
        }
        /* CTA 内部箭头微微平移 —— 暗示"走出去 = 切列表"
           hover 时再加力，强化点击动作的方向感 */
        @keyframes ptvCtaArrowGlide {
          0%, 100% { transform: translateX(0); opacity: 0.9; }
          50%      { transform: translateX(2px); opacity: 1; }
        }
        .ptv-cta-arrow {
          display: inline-block;
          animation: ptvCtaArrowGlide 2.4s cubic-bezier(.4,0,.2,1) infinite;
        }
        .ptv-cta-pulse:hover .ptv-cta-arrow {
          animation: none;
          transform: translateX(3px);
          transition: transform 180ms ease-out;
        }
        /* 非焦点卡片 hover —— ▸ 箭头亮起 + 右移，提示"按一下会聚焦"
           不改 border / bg（已有 hover），只动右侧装饰箭头，避免双重视觉噪声 */
        .ptv-focus-hint:hover .ptv-focus-hint-arrow {
          color: rgba(248,230,176,1) !important;
          transform: translateX(3px);
          text-shadow: 0 0 6px rgba(239,216,154,0.65);
        }
        /* 列表→树过渡微提示 —— 1.5s 金色 glow 渐隐
           list→tree 切回瞬间：让"刚看完的那一行"在树里点亮一下，建立"行↔节点"的视觉锚定
           三段式：起始外圈 4px 高亮 → 50% 衰减一半 → 100% 完全消失（交还焦点态自带的 shadow） */
        @keyframes ptvNodeFlash {
          0%   { box-shadow: 0 0 0 4px rgba(239,216,154,.85), 0 0 50px 8px rgba(239,216,154,.95); }
          50%  { box-shadow: 0 0 0 3px rgba(239,216,154,.55), 0 0 32px 4px rgba(239,216,154,.55); }
          100% { box-shadow: 0 0 0 0 rgba(239,216,154,0),     0 0 0 0 rgba(239,216,154,0); }
        }
        .ptv-node-flash {
          animation: ptvNodeFlash 1.5s cubic-bezier(.2,.6,.2,1) forwards;
          z-index: 5;
        }
      `}</style>
    </div>
  );
}

// ─── 工具：从 scope.pageId 反推完整 path ───
function buildPathFromScope(pageId: string, data: PageRow[]): string[] {
  const byId = new Map(data.map((p) => [p.id, p]));
  const chain: string[] = [];
  let cur = byId.get(pageId);
  while (cur) {
    chain.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

// ─── 视觉标记：枢纽（实心金钻） / 辐射（空心圆点） ───
function PillarMark() {
  return (
    <span
      aria-hidden="true"
      title="枢纽页 PILLAR"
      style={{
        width: 7,
        height: 7,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, #F8E6B0 0%, #D4B36F 50%, #A08850 100%)",
        boxShadow: "0 0 8px rgba(239,216,154,.85)",
        flexShrink: 0,
        borderRadius: 1,
      }}
    />
  );
}
function SpokeMark({ dim = false }: { dim?: boolean }) {
  return (
    <span
      aria-hidden="true"
      title="辐射页 SPOKE"
      style={{
        width: 6,
        height: 6,
        borderRadius: 9999,
        border: `1px solid ${dim ? "rgba(160,136,80,.55)" : "rgba(239,216,154,.85)"}`,
        background: "transparent",
        flexShrink: 0,
      }}
    />
  );
}
