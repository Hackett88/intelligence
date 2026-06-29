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
// 帕累托双图组件 — 每日柱 + 累计线
// ───────────────────────────────────────────────────────────────────────────

// 配色
const COLORS = {
  // 曝光: 偏冷金 (steel-brass)
  imprBar: "#8A9670",        // 日柱体 — 冷橄榄
  imprBarHi: "#A8B88A",      // 日柱体高光
  imprLine: "#C9D4A0",       // 累计线 — 冷亮金
  imprLineShadow: "rgba(201,212,160,.35)",
  imprFill: "rgba(138,150,112,.12)", // 日柱淡填充

  // 点击: 偏暖金 (warm-brass)
  clickBar: "#C9A769",       // 日柱体 — 暖金
  clickBarHi: "#EFD89A",     // 日柱体高光
  clickLine: "#F0DEA0",      // 累计线 — 亮金
  clickLineShadow: "rgba(240,222,160,.35)",
  clickFill: "rgba(201,167,105,.12)",

  axis: "rgba(201,169,97,.25)",
  axisLabel: "rgba(201,169,97,.55)",
  gridLine: "rgba(201,169,97,.08)",
  tooltipBg: "rgba(12,28,18,.95)",
  tooltipBorder: "rgba(201,169,97,.45)",
};

const CHART_W = 370;
const CHART_H = 90;
const PAD = { top: 6, right: 4, bottom: 18, left: 0 };
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

interface ParetoChartProps {
  data: CumulativeDay[];
  dailyKey: "clicks" | "impressions";
  cumKey: "cumClicks" | "cumImpressions";
  barColor: string;
  barHiColor: string;
  lineColor: string;
  lineShadowColor: string;
  label: string;
  latin: string;
  uid: string;
}

function ParetoChart({
  data,
  dailyKey,
  cumKey,
  barColor,
  barHiColor,
  lineColor,
  lineShadowColor,
  label,
  latin,
  uid,
}: ParetoChartProps) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const n = data.length;
  if (n === 0) return null;

  const maxDaily = Math.max(...data.map((d) => d[dailyKey]), 1);
  const maxCum = Math.max(...data.map((d) => d[cumKey]), 1);

  const barGap = n > 60 ? 0 : 0.5;
  const barW = Math.max(1, (INNER_W - barGap * (n - 1)) / n);

  // 日柱高度 (按 dailyMax 归一化)
  const barX = (i: number) => PAD.left + i * (barW + barGap);
  const barH = (v: number) => (v / maxDaily) * (INNER_H * 0.88); // 留 12% 给累计线顶部
  const barY = (v: number) => PAD.top + INNER_H - barH(v);

  // 累计线坐标 (按 cumMax 归一化，使用全高)
  const lineX = (i: number) => barX(i) + barW / 2;
  const lineY = (v: number) => PAD.top + INNER_H - (v / maxCum) * INNER_H;

  // 累计线 path
  const linePath = data
    .map((d, i) => {
      const x = lineX(i);
      const y = lineY(d[cumKey]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // X 轴标签位置
  const xLabels = pickXLabels(n);

  // hover 交互
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD.left;
    const idx = Math.round(x / (barW + barGap));
    if (idx >= 0 && idx < n) {
      setHoverIdx(idx);
    } else {
      setHoverIdx(null);
    }
  };

  const hoveredDay = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="flex flex-col gap-1">
      {/* 小标题行 */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{
            width: 3,
            height: 3,
            transform: "rotate(45deg)",
            background: `linear-gradient(135deg, ${lineColor} 0%, ${barColor} 100%)`,
            boxShadow: `0 0 4px ${lineShadowColor}`,
          }}
        />
        <span
          className="tracking-[0.22em]"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 8.5,
            color: lineColor,
            opacity: 0.85,
          }}
        >
          {latin}
        </span>
        <span className="text-manor-inkDim text-[10px]">{label}</span>
        {/* 图例 */}
        <span className="ml-auto flex items-center gap-2 text-[9px] text-manor-inkFaint">
          <span className="inline-flex items-center gap-1">
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: 1,
                background: barColor,
                opacity: 0.7,
              }}
            />
            每日
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 1.5,
                borderRadius: 1,
                background: lineColor,
              }}
            />
            累计
          </span>
        </span>
      </div>

      {/* SVG 图 */}
      <div className="relative">
        <svg
          ref={svgRef}
          width={CHART_W}
          height={CHART_H}
          className="block"
          aria-label={`${label}趋势图`}
          role="img"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          style={{ cursor: "crosshair" }}
        >
          <defs>
            <linearGradient id={`bar-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={barHiColor} />
              <stop offset="100%" stopColor={barColor} stopOpacity={0.5} />
            </linearGradient>
          </defs>

          {/* 水平网格线 (3 条) */}
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
            y1={PAD.top + INNER_H}
            x2={PAD.left + INNER_W}
            y2={PAD.top + INNER_H}
            stroke={COLORS.axis}
            strokeWidth={0.5}
          />

          {/* 日柱 */}
          {data.map((d, i) => {
            const h = barH(d[dailyKey]);
            const isHover = hoverIdx === i;
            return (
              <rect
                key={i}
                x={barX(i)}
                y={barY(d[dailyKey])}
                width={barW}
                height={Math.max(0.5, h)}
                rx={barW > 3 ? 1 : 0}
                fill={`url(#bar-grad-${uid})`}
                opacity={isHover ? 1 : 0.6}
                style={{ transition: "opacity 0.1s" }}
              />
            );
          })}

          {/* 累计线 */}
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.9}
          />

          {/* hover 竖线 */}
          {hoverIdx !== null && (
            <>
              <line
                x1={lineX(hoverIdx)}
                y1={PAD.top}
                x2={lineX(hoverIdx)}
                y2={PAD.top + INNER_H}
                stroke={lineColor}
                strokeWidth={0.5}
                strokeDasharray="2,2"
                opacity={0.5}
              />
              {/* 累计线上的点 */}
              <circle
                cx={lineX(hoverIdx)}
                cy={lineY(data[hoverIdx][cumKey])}
                r={3}
                fill={lineColor}
                stroke={COLORS.tooltipBg}
                strokeWidth={1.5}
              />
            </>
          )}

          {/* X 轴标签 */}
          {xLabels.map((idx) => (
            <text
              key={idx}
              x={lineX(idx)}
              y={CHART_H - 2}
              textAnchor="middle"
              fill={COLORS.axisLabel}
              fontSize={8}
              fontFamily="var(--font-sc), 'Cormorant SC', serif"
            >
              {fmtDateShort(data[idx].date)}
            </text>
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredDay && hoverIdx !== null && (
          <div
            className="absolute pointer-events-none z-10 px-2 py-1.5 rounded text-[10px] leading-snug"
            style={{
              background: COLORS.tooltipBg,
              border: `1px solid ${COLORS.tooltipBorder}`,
              boxShadow: "0 2px 8px rgba(0,0,0,.5)",
              left: Math.min(
                lineX(hoverIdx),
                CHART_W - 120
              ),
              top: -4,
              transform: "translateX(-50%) translateY(-100%)",
              whiteSpace: "nowrap",
            }}
          >
            <div className="text-manor-brassHi/90 tabular-nums mb-0.5">
              {fmtDateFull(hoveredDay.date)}
            </div>
            <div className="text-manor-ink tabular-nums">
              {dailyKey === "impressions" ? "当日曝光" : "当日点击"}{" "}
              <span className="text-manor-brassHi font-medium">
                {hoveredDay[dailyKey].toLocaleString()}
              </span>
            </div>
            <div className="text-manor-inkDim tabular-nums">
              累计{" "}
              <span className="font-medium" style={{ color: lineColor }}>
                {formatLargeNumber(hoveredDay[cumKey])}
              </span>
            </div>
          </div>
        )}
      </div>
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
        <span className="block text-manor-oxbloodHi/80 mb-0.5">趋势加载失败</span>
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
          background: "linear-gradient(180deg, rgba(20,42,28,.6) 0%, rgba(10,24,16,.7) 100%)",
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
          </span>
          {" "}曝光
        </span>
        <span className="text-manor-inkGhost">-</span>
        <span className="text-manor-ink tabular-nums">
          <span className="text-manor-brassHi font-medium">
            {formatLargeNumber(totalClicks)}
          </span>
          {" "}点击
        </span>
      </div>

      {/* 曝光帕累托图 */}
      <ParetoChart
        data={cum}
        dailyKey="impressions"
        cumKey="cumImpressions"
        barColor={COLORS.imprBar}
        barHiColor={COLORS.imprBarHi}
        lineColor={COLORS.imprLine}
        lineShadowColor={COLORS.imprLineShadow}
        label="曝光"
        latin="VISUS"
        uid="impr"
      />

      {/* 点击帕累托图 */}
      <ParetoChart
        data={cum}
        dailyKey="clicks"
        cumKey="cumClicks"
        barColor={COLORS.clickBar}
        barHiColor={COLORS.clickBarHi}
        lineColor={COLORS.clickLine}
        lineShadowColor={COLORS.clickLineShadow}
        label="点击"
        latin="CLICKS"
        uid="click"
      />
    </div>
  );
}
