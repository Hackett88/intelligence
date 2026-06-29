"use client";

import * as React from "react";
import { formatLargeNumber } from "./_utils";

// ───────────────────────────────────────────────────────────────────────────
// API 类型
// ───────────────────────────────────────────────────────────────────────────

export interface TrendDay {
  date: string; // "2026-03-30"
  clicks: number;
  impressions: number;
}

export interface TrendData {
  ok: boolean;
  startDate: string | null;
  series: TrendDay[];
}

// ───────────────────────────────────────────────────────────────────────────
// hook: 抽屉打开/切换页时拉趋势数据
// ───────────────────────────────────────────────────────────────────────────

type TrendState = {
  data: TrendData | null;
  loading: boolean;
  error: string | null;
};

type TrendAction =
  | { type: "reset" }
  | { type: "fetch" }
  | { type: "ok"; data: TrendData }
  | { type: "err"; message: string };

function trendReducer(_s: TrendState, a: TrendAction): TrendState {
  switch (a.type) {
    case "reset":
      return { data: null, loading: false, error: null };
    case "fetch":
      return { data: null, loading: true, error: null };
    case "ok":
      return { data: a.data, loading: false, error: null };
    case "err":
      return { data: null, loading: false, error: a.message };
  }
}

const TREND_INIT: TrendState = { data: null, loading: false, error: null };

export function usePageTrend(url: string | null, isSynthetic: boolean) {
  const [state, dispatch] = React.useReducer(trendReducer, TREND_INIT);

  React.useEffect(() => {
    if (!url || isSynthetic) {
      dispatch({ type: "reset" });
      return;
    }

    let cancelled = false;
    dispatch({ type: "fetch" });

    fetch(`/api/indexing/page-trend?path=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { message?: string }).message || `HTTP ${res.status}`
          );
        }
        return res.json() as Promise<TrendData>;
      })
      .then((d) => {
        if (!cancelled) dispatch({ type: "ok", data: d });
      })
      .catch((e) => {
        if (!cancelled)
          dispatch({
            type: "err",
            message: e instanceof Error ? e.message : "加载失败",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [url, isSynthetic]);

  return state;
}

// ───────────────────────────────────────────────────────────────────────────
// 累计计算
// ───────────────────────────────────────────────────────────────────────────

interface CumulativeDay extends TrendDay {
  cumClicks: number;
  cumImpressions: number;
}

function buildCumulative(series: TrendDay[]): CumulativeDay[] {
  let cumClicks = 0;
  let cumImpressions = 0;
  return series.map((d) => {
    cumClicks += d.clicks;
    cumImpressions += d.impressions;
    return { ...d, cumClicks, cumImpressions };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 日期格式化 — X 轴标签
// ───────────────────────────────────────────────────────────────────────────

function fmtDateShort(dateStr: string): string {
  // "2026-03-30" → "3/30"
  const parts = dateStr.split("-");
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

function fmtDateFull(dateStr: string): string {
  // "2026-03-30" → "2026-03-30"
  return dateStr;
}

// ───────────────────────────────────────────────────────────────────────────
// 合并双轴图：曝光(左轴) + 点击(右轴) 同框
// ───────────────────────────────────────────────────────────────────────────

// 配色
const COLORS = {
  // 曝光: 偏冷金 (steel-brass)
  imprLine: "#C9D4A0",       // 冷亮金
  imprLineShadow: "rgba(201,212,160,.35)",
  imprFill: "rgba(138,150,112,.18)",

  // 点击: 偏暖金 (warm-brass)
  clickLine: "#F0DEA0",      // 亮金
  clickLineShadow: "rgba(240,222,160,.35)",
  clickFill: "rgba(201,167,105,.18)",

  axis: "rgba(201,169,97,.25)",
  axisLabel: "rgba(201,169,97,.55)",
  gridLine: "rgba(201,169,97,.08)",
  tooltipBg: "rgba(12,28,18,.95)",
  tooltipBorder: "rgba(201,169,97,.45)",
};

const CHART_W = 370;
const CHART_H = 184; // 加高，给「悬浮卡片浮在数据点正上方」留出顶部空间
const PAD = { top: 8, right: 34, bottom: 20, left: 34 };
const INNER_W = CHART_W - PAD.left - PAD.right;
const INNER_H = CHART_H - PAD.top - PAD.bottom;

// X 轴只标几个标签（自适应数据量）
function pickXLabels(n: number): number[] {
  if (n <= 7) return Array.from({ length: n }, (_, i) => i);
  if (n <= 14) {
    // 首/尾 + 每隔 ~3 天
    const step = Math.ceil(n / 5);
    const labels: number[] = [0];
    for (let i = step; i < n - 1; i += step) labels.push(i);
    labels.push(n - 1);
    return labels;
  }
  // 首/尾 + 约每 2 周
  const step = Math.max(7, Math.ceil(n / 6));
  const labels: number[] = [0];
  for (let i = step; i < n - 1; i += step) labels.push(i);
  labels.push(n - 1);
  return labels;
}

// Y 轴归一化上限 — 取到最近的 nice 整数
function calcNiceMax(maxVal: number): number {
  if (maxVal <= 0) return 1;
  const order = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const norm = maxVal / order;
  if (norm <= 1) return order;
  if (norm <= 2) return 2 * order;
  if (norm <= 5) return 5 * order;
  return 10 * order;
}

// ── 合并图组件 ──────────────────────────────────────────────────────────────

function UnifiedTrendChart({ data }: { data: CumulativeDay[] }) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const n = data.length;
  if (n === 0) return null;

  // 双轴各自的 nice 上限
  const imprCeil = calcNiceMax(Math.max(...data.map((d) => d.impressions), 1));
  const clickCeil = calcNiceMax(Math.max(...data.map((d) => d.clicks), 1));

  // 坐标映射
  const xPos = (i: number) =>
    PAD.left + (n > 1 ? (i / (n - 1)) * INNER_W : INNER_W / 2);
  const yImpr = (v: number) =>
    PAD.top + INNER_H - (v / imprCeil) * INNER_H;
  const yClick = (v: number) =>
    PAD.top + INNER_H - (v / clickCeil) * INNER_H;
  const baseline = PAD.top + INNER_H;

  // 折线 / 面积 path（n >= 2 才画线）
  let imprLinePath = "";
  let clickLinePath = "";
  let imprAreaPath = "";
  let clickAreaPath = "";

  if (n >= 2) {
    imprLinePath = data
      .map(
        (d, i) =>
          `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yImpr(d.impressions).toFixed(1)}`
      )
      .join(" ");
    clickLinePath = data
      .map(
        (d, i) =>
          `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yClick(d.clicks).toFixed(1)}`
      )
      .join(" ");
    imprAreaPath = `${imprLinePath} L${xPos(n - 1).toFixed(1)},${baseline} L${xPos(0).toFixed(1)},${baseline} Z`;
    clickAreaPath = `${clickLinePath} L${xPos(n - 1).toFixed(1)},${baseline} L${xPos(0).toFixed(1)},${baseline} Z`;
  }

  const xLabels = pickXLabels(n);

  // Y 轴刻度值（0 + 上限；中间值仅在整数时加）
  const imprYTicks: number[] = [0, imprCeil];
  const imprMid = imprCeil / 2;
  if (imprMid > 0 && imprMid === Math.floor(imprMid))
    imprYTicks.splice(1, 0, imprMid);
  const clickYTicks: number[] = [0, clickCeil];
  const clickMid = clickCeil / 2;
  if (clickMid > 0 && clickMid === Math.floor(clickMid))
    clickYTicks.splice(1, 0, clickMid);

  // hover
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD.left;
    if (n === 1) {
      setHoverIdx(0);
      return;
    }
    const idx = Math.round((x / INNER_W) * (n - 1));
    setHoverIdx(idx >= 0 && idx < n ? idx : null);
  };

  const hoveredDay = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={CHART_W}
        height={CHART_H}
        className="block"
        aria-label="流量趋势图 -- 曝光与点击"
        role="img"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ cursor: "crosshair" }}
      >
        {/* 水平网格线 */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = PAD.top + INNER_H * (1 - frac);
          return (
            <line
              key={frac}
              x1={PAD.left}
              y1={y}
              x2={PAD.left + INNER_W}
              y2={y}
              stroke={COLORS.gridLine}
              strokeWidth={0.5}
            />
          );
        })}

        {/* X 轴底线 */}
        <line
          x1={PAD.left}
          y1={baseline}
          x2={PAD.left + INNER_W}
          y2={baseline}
          stroke={COLORS.axis}
          strokeWidth={0.5}
        />

        {/* 左 Y 轴刻度（曝光） */}
        {imprYTicks.map((v) => (
          <text
            key={`li${v}`}
            x={PAD.left - 4}
            y={yImpr(v) + (v === 0 ? -3 : 0)}
            textAnchor="end"
            dominantBaseline="middle"
            fill={COLORS.imprLine}
            fontSize={7.5}
            opacity={0.75}
            fontFamily="var(--font-sc), 'Cormorant SC', serif"
          >
            {v === 0 ? "0" : formatLargeNumber(v)}
          </text>
        ))}

        {/* 右 Y 轴刻度（点击） */}
        {clickYTicks.map((v) => (
          <text
            key={`rc${v}`}
            x={PAD.left + INNER_W + 4}
            y={yClick(v) + (v === 0 ? -3 : 0)}
            textAnchor="start"
            dominantBaseline="middle"
            fill={COLORS.clickLine}
            fontSize={7.5}
            opacity={0.75}
            fontFamily="var(--font-sc), 'Cormorant SC', serif"
          >
            {v === 0 ? "0" : formatLargeNumber(v)}
          </text>
        ))}

        {/* 数据系列 */}
        {n >= 2 ? (
          <>
            {/* 曝光 — 面积 + 线 */}
            <path d={imprAreaPath} fill={COLORS.imprFill} />
            <path
              d={imprLinePath}
              fill="none"
              stroke={COLORS.imprLine}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
            {/* 点击 — 面积 + 线 */}
            <path d={clickAreaPath} fill={COLORS.clickFill} />
            <path
              d={clickLinePath}
              fill="none"
              stroke={COLORS.clickLine}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          </>
        ) : (
          <>
            {/* 单日数据 — 仅显示点 */}
            <circle
              cx={xPos(0)}
              cy={yImpr(data[0].impressions)}
              r={3.5}
              fill={COLORS.imprLine}
              opacity={0.9}
            />
            <circle
              cx={xPos(0)}
              cy={yClick(data[0].clicks)}
              r={3.5}
              fill={COLORS.clickLine}
              opacity={0.9}
            />
          </>
        )}

        {/* hover 竖线 + 两个指示点 */}
        {hoverIdx !== null && (
          <>
            <line
              x1={xPos(hoverIdx)}
              y1={PAD.top}
              x2={xPos(hoverIdx)}
              y2={baseline}
              stroke={COLORS.tooltipBorder}
              strokeWidth={0.5}
              strokeDasharray="2,2"
              opacity={0.5}
            />
            <circle
              cx={xPos(hoverIdx)}
              cy={yImpr(data[hoverIdx].impressions)}
              r={3}
              fill={COLORS.imprLine}
              stroke={COLORS.tooltipBg}
              strokeWidth={1.5}
            />
            <circle
              cx={xPos(hoverIdx)}
              cy={yClick(data[hoverIdx].clicks)}
              r={3}
              fill={COLORS.clickLine}
              stroke={COLORS.tooltipBg}
              strokeWidth={1.5}
            />
          </>
        )}

        {/* X 轴标签 */}
        {xLabels.map((idx) => (
          <text
            key={idx}
            x={xPos(idx)}
            y={CHART_H - 3}
            textAnchor="middle"
            fill={COLORS.axisLabel}
            fontSize={8}
            fontFamily="var(--font-sc), 'Cormorant SC', serif"
          >
            {fmtDateShort(data[idx].date)}
          </text>
        ))}
      </svg>

      {/* 统一 Tooltip — 浮在所指数据点的正上方，随该点曲线峰值上下移动；
          横向跟随该点、纵向贴着两线中更高的那条，不压住趋势线，靠近顶部时夹住不溢出 */}
      {hoveredDay &&
        hoverIdx !== null &&
        (() => {
          const CARD_W = 176;
          const CARD_H = 66;
          const GAP = 26; // 卡片底边距数据点（顶点）的间隙——留出明显距离，不贴着峰值
          // 两条线在该 x 处更高（y 更小）的那个标记点 → 卡片贴它上方
          const markerTopY = Math.min(
            yImpr(hoveredDay.impressions),
            yClick(hoveredDay.clicks)
          );
          const left = Math.max(
            2,
            Math.min(CHART_W - CARD_W - 2, xPos(hoverIdx) - CARD_W / 2)
          );
          const top = Math.max(2, markerTopY - GAP - CARD_H);
          return (
            <div
              className="absolute pointer-events-none z-10 px-3 py-2 rounded-md leading-snug"
              style={{
                background: COLORS.tooltipBg,
                border: `1px solid ${COLORS.tooltipBorder}`,
                boxShadow: "0 6px 18px rgba(0,0,0,.6)",
                left,
                top,
                width: CARD_W,
                whiteSpace: "nowrap",
              }}
            >
              <div className="text-manor-brassHi tabular-nums text-[11px] mb-1">
                {fmtDateFull(hoveredDay.date)}
              </div>
              <div className="flex items-baseline justify-between tabular-nums mb-0.5">
                <span className="text-[11px]" style={{ color: COLORS.imprLine }}>
                  曝光{" "}
                  <span className="font-semibold text-[13px]">
                    {hoveredDay.impressions.toLocaleString()}
                  </span>
                </span>
                <span className="text-manor-inkDim text-[10px]">
                  累计 {formatLargeNumber(hoveredDay.cumImpressions)}
                </span>
              </div>
              <div className="flex items-baseline justify-between tabular-nums">
                <span className="text-[11px]" style={{ color: COLORS.clickLine }}>
                  点击{" "}
                  <span className="font-semibold text-[13px]">
                    {hoveredDay.clicks.toLocaleString()}
                  </span>
                </span>
                <span className="text-manor-inkDim text-[10px]">
                  累计 {formatLargeNumber(hoveredDay.cumClicks)}
                </span>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 主组件: 流量趋势区
// ───────────────────────────────────────────────────────────────────────────

export function PageTrendSection({
  data,
  loading,
  error,
}: {
  data: TrendData | null;
  loading: boolean;
  error: string | null;
}) {
  // loading 态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2">
        <span
          className="inline-block w-3 h-3 border border-manor-brassHi/50 border-t-manor-brassHi rounded-full animate-spin"
          aria-hidden="true"
        />
        <span
          className="text-manor-inkDim text-[11px] tracking-[0.12em]"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
        >
          加载趋势数据...
        </span>
      </div>
    );
  }

  // 错误态
  if (error) {
    return (
      <div
        className="px-3 py-3 rounded text-[11px] leading-relaxed text-manor-inkFaint"
        style={{
          background: "rgba(196,107,90,.08)",
          border: "1px solid rgba(196,107,90,.25)",
        }}
      >
        <span className="block text-manor-oxbloodHi/80 mb-0.5">
          趋势加载失败
        </span>
        <span className="text-manor-inkFaint">{error}</span>
      </div>
    );
  }

  // 空态 (series 为空)
  if (!data || data.series.length === 0) {
    return (
      <div
        className="px-3 py-4 rounded text-center"
        style={{
          background: "rgba(255,255,255,.025)",
          border: "1px solid rgba(224,197,122,.14)",
        }}
      >
        <span
          className="block text-manor-inkDim text-[11px] mb-1"
          style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
        >
          计数刚开始，趋势将逐日累积
        </span>
        <span className="text-manor-inkFaint text-[10px]">
          数据自 GSC 每日同步后逐渐积累，通常需要数日才有可视化趋势。
        </span>
      </div>
    );
  }

  // 有数据 — 计算累计
  const cum = buildCumulative(data.series);
  const totalImpr = cum[cum.length - 1].cumImpressions;
  const totalClicks = cum[cum.length - 1].cumClicks;

  return (
    <div className="flex flex-col gap-3">
      {/* 累计总览行 */}
      <div
        className="px-3 py-2 rounded text-[11px] leading-relaxed flex items-center gap-2 flex-wrap"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,42,28,.6) 0%, rgba(10,24,16,.7) 100%)",
          border: "1px solid rgba(201,169,97,.2)",
        }}
      >
        <span
          className="text-manor-brassHi/80 tracking-[0.18em] shrink-0"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 9,
          }}
        >
          SUMMA
        </span>
        {data.startDate && (
          <span className="text-manor-inkFaint text-[10px]">
            起 {data.startDate}
          </span>
        )}
        <span className="text-manor-inkGhost mx-0.5">|</span>
        <span className="text-manor-ink tabular-nums">
          累计{" "}
          <span className="text-manor-brassHi font-medium">
            {formatLargeNumber(totalImpr)}
          </span>{" "}
          曝光
        </span>
        <span className="text-manor-inkGhost">-</span>
        <span className="text-manor-ink tabular-nums">
          <span className="text-manor-brassHi font-medium">
            {formatLargeNumber(totalClicks)}
          </span>{" "}
          点击
        </span>
      </div>

      {/* 图例 + 标题行 */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{
            width: 3,
            height: 3,
            transform: "rotate(45deg)",
            background: `linear-gradient(135deg, ${COLORS.imprLine} 0%, ${COLORS.clickLine} 100%)`,
            boxShadow: `0 0 4px ${COLORS.imprLineShadow}`,
          }}
        />
        <span
          className="tracking-[0.22em]"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 8.5,
            color: COLORS.imprLine,
            opacity: 0.85,
          }}
        >
          CONSPECTUS
        </span>
        <span className="text-manor-inkDim text-[10px]">流量趋势</span>
        {/* 图例 */}
        <span className="ml-auto flex items-center gap-2.5 text-[9px] text-manor-inkFaint">
          <span className="inline-flex items-center gap-1">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 2,
                borderRadius: 1,
                background: COLORS.imprLine,
                opacity: 0.9,
              }}
            />
            曝光 &middot; 左轴
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 2,
                borderRadius: 1,
                background: COLORS.clickLine,
                opacity: 0.9,
              }}
            />
            点击 &middot; 右轴
          </span>
        </span>
      </div>

      {/* 合并双轴图 */}
      <UnifiedTrendChart data={cum} />
    </div>
  );
}
