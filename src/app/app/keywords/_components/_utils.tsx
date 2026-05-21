"use client";

import * as React from "react";

const BP_LABELS: Record<number, string> = {
  3: "产品不可替代",
  2: "产品明显有助",
  1: "可顺带提及",
  0: "无关联",
};

const CS_LABELS: Record<number, string> = {
  3: "商业型",
  2: "混合型",
  1: "信息型",
  0: "无商业信号",
};

const SCORE_COLOR: Record<number, string> = {
  3: "bg-manor-bg3 text-manor-brassHi border-manor-sageDim/60",
  2: "bg-manor-bg3 text-manor-brassHi border-manor-line2",
  1: "bg-manor-brassDim/15 text-manor-brassHi border-manor-brassDim/50",
  0: "bg-manor-bg text-manor-inkDim border-manor-line",
};

const INTENT_LABELS: Record<string, string> = {
  informational: "信息型",
  commercial: "商业型",
  mixed: "混合型",
  navigational: "导航型",
  transactional: "交易型",
};

const INTENT_COLOR: Record<string, string> = {
  informational: "bg-manor-bg3 text-manor-sage border-manor-line2",
  commercial: "bg-manor-bg3 text-manor-brassHi border-manor-line2",
  mixed: "bg-manor-bg3 text-manor-brassHi border-manor-line2",
  navigational: "bg-manor-brassDim/15 text-manor-brassHi border-manor-brassDim/50",
  transactional: "bg-manor-bg3 text-manor-brassHi border-manor-sageDim/60",
};

export function bpLabel(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return BP_LABELS[value] ?? null;
}

export function csLabel(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return CS_LABELS[value] ?? null;
}

export function formatBP(value: number | null | undefined): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-manor-inkGhost">—</span>;
  }
  const label = BP_LABELS[value] ?? "";
  const cls = SCORE_COLOR[value] ?? SCORE_COLOR[0];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${cls}`}>
      <span className="font-semibold mr-1">{value}</span>
      {label}
    </span>
  );
}

export function formatCS(value: number | null | undefined): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-manor-inkGhost">—</span>;
  }
  const label = CS_LABELS[value] ?? "";
  const cls = SCORE_COLOR[value] ?? SCORE_COLOR[0];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${cls}`}>
      <span className="font-semibold mr-1">{value}</span>
      {label}
    </span>
  );
}

function translateIntentToken(token: string): string | null {
  const key = token.trim().toLowerCase();
  if (!key) return null;
  return INTENT_LABELS[key] ?? null;
}

export function intentLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const tokens = value.split(/[,、|/]/).map(translateIntentToken).filter(Boolean) as string[];
  if (tokens.length === 0) return null;
  return tokens.join(" / ");
}

export function formatIntent(value: string | null | undefined): React.ReactNode {
  if (!value) return <span className="text-manor-inkGhost">—</span>;
  const tokens = value.split(/[,、|/]/);
  const labels = tokens.map(translateIntentToken).filter(Boolean) as string[];
  if (labels.length === 0) return <span className="text-manor-inkGhost">—</span>;
  const primaryKey = tokens[0].trim().toLowerCase();
  const cls = INTENT_COLOR[primaryKey] ?? "bg-manor-bg text-manor-inkDim border-manor-line";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${cls}`}>
      {labels.join(" / ")}
    </span>
  );
}

export function parseTrends(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const parts = value
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  if (parts.length !== 12) return null;
  return parts;
}

interface SparklineProps {
  data: number[] | null;
  width?: number;
  height?: number;
  variant?: "bar" | "line";
}

export function Sparkline({
  data,
  width = 100,
  height = 24,
  variant = "bar",
}: SparklineProps) {
  const reactId = React.useId();
  if (!data || data.length === 0) {
    return <span className="text-manor-inkGhost text-xs">—</span>;
  }
  const max = Math.max(...data, 0.0001);
  const n = data.length;

  if (variant === "line") {
    const step = n > 1 ? width / (n - 1) : 0;
    const path = data
      .map((v, i) => {
        const x = i * step;
        const y = height - (v / max) * (height - 2) - 1;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <svg
        width={width}
        height={height}
        className="text-manor-brass inline-block align-middle"
        aria-hidden
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  const gap = 1;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  const isLarge = height >= 40;
  const gradId = `spark-glass-${reactId}`;
  const sideId = `spark-side-${reactId}`;
  const glowId = `spark-glow-${reactId}`;
  const topPad = isLarge ? 3 : 0;
  return (
    <svg
      width={width}
      height={height}
      className="inline-block align-middle"
      aria-hidden
      style={isLarge ? { overflow: "visible" } : undefined}
    >
      <defs>
        {/* Brass column body — vertical ramp, bright top to deep base. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#F0DEA0" />
          <stop offset="40%"  stopColor="#C9A769" />
          <stop offset="100%" stopColor="#5A4220" />
        </linearGradient>
        {/* Vertical inner glow band — warm brass light pooling at the
            upper section of each column. */}
        <linearGradient id={glowId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,247,210,0.55)" />
          <stop offset="100%" stopColor="rgba(255,247,210,0)" />
        </linearGradient>
        {/* Vignette on the column sides — very light edge darkening
            for a faint hint of curvature without faux-3D drama. */}
        <linearGradient id={sideId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(0,0,0,0.35)" />
          <stop offset="50%"  stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.4)" />
        </linearGradient>

      </defs>

      {/* Faint horizontal grid + bottom baseline, only on the large chart */}
      {isLarge && (
        <g>
          <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25}
                stroke="#D4B36F" strokeOpacity="0.16"
                strokeDasharray="2 4" strokeWidth="0.4" />
          <line x1="0" y1={height * 0.50} x2={width} y2={height * 0.50}
                stroke="#D4B36F" strokeOpacity="0.16"
                strokeDasharray="2 4" strokeWidth="0.4" />
          <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75}
                stroke="#D4B36F" strokeOpacity="0.16"
                strokeDasharray="2 4" strokeWidth="0.4" />
          <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5}
                stroke="#D4B36F" strokeOpacity="0.55" strokeWidth="0.7" />
        </g>
      )}

      {data.map((v, i) => {
        const h = Math.max(1, (v / max) * (height - topPad));
        const x = i * (barW + gap);
        const y = height - h;
        const isPeak = isLarge && v === max;
        const cx = x + barW / 2;

        // Small bars in the table sparkline stay simple
        if (!isLarge) {
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h}
                    fill={`url(#${gradId})`} rx={0.5} />
              <rect x={x} y={y} width={barW} height={h}
                    fill={`url(#${sideId})`} rx={0.5} />
            </g>
          );
        }

        // Top-quarter inner glow — emerald light pooling at the tip
        const glowH = Math.min(Math.max(6, h * 0.28), h - 2);

        return (
          <g
            key={i}
            style={
              isPeak
                ? { filter: "drop-shadow(0 0 4px rgba(255,232,168,.6))" }
                : undefined
            }
          >
            {/* 1. Ground contact shadow — subtle pool at the base */}
            <ellipse
              cx={cx + 0.3} cy={height - 0.3}
              rx={barW * 0.5} ry={1.5}
              fill="rgba(0,0,0,0.5)"
            />
            {/* 2. Glass tube body — emerald gradient fill + 1px brass
                   outline. This single stroked rect carries most of
                   the "this is a column" reading. */}
            <rect
              x={x + 0.5} y={y + 0.5}
              width={barW - 1} height={h - 1}
              fill={`url(#${gradId})`}
              stroke="url(#g-brass)"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
            />
            {/* 3. Soft side vignette — barely-there edge darkening */}
            <rect
              x={x + 0.5} y={y + 0.5}
              width={barW - 1} height={h - 1}
              fill={`url(#${sideId})`}
            />
            {/* 3b. Column fluting — two bright reeds + two thin shadow
                    grooves give the brass shaft a "polished organ pipe"
                    reading. Same on every column for ensemble unity. */}
            {h > 8 && (() => {
              const reedOffset = barW * 0.18;
              const fluteTop = y + 3.6;
              const fluteBottom = y + h - 1.2;
              return (
                <g>
                  {/* Outer shadow grooves (sit on the dark side of each reed) */}
                  <line
                    x1={cx - reedOffset - 1.1} y1={fluteTop}
                    x2={cx - reedOffset - 1.1} y2={fluteBottom}
                    stroke="rgba(0,0,0,0.42)" strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={cx + reedOffset + 1.1} y1={fluteTop}
                    x2={cx + reedOffset + 1.1} y2={fluteBottom}
                    stroke="rgba(0,0,0,0.42)" strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Bright reeds */}
                  <line
                    x1={cx - reedOffset} y1={fluteTop}
                    x2={cx - reedOffset} y2={fluteBottom}
                    stroke="rgba(255,237,178,0.55)" strokeWidth="0.7"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={cx + reedOffset} y1={fluteTop}
                    x2={cx + reedOffset} y2={fluteBottom}
                    stroke="rgba(255,237,178,0.55)" strokeWidth="0.7"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })()}
            {/* 4. Inner warm glow at the upper section — the
                   "light has settled here" effect. */}
            <rect
              x={x + 1.2} y={y + 1.2}
              width={barW - 2.4} height={glowH}
              fill={`url(#${glowId})`}
            />
            {/* 5. Brass cap — a thin bright line sealing the top of
                   the glass tube. Provides the precise visual stop
                   that says "this column ends here, polished". */}
            <rect
              x={x + 0.8} y={y + 0.4}
              width={barW - 1.6} height={1.4}
              fill="#EFD89A"
            />
            {/* 5b. Capital collar — a bright/dark double-line ring
                   just below the cap. Anchors the fluting and gives
                   each column a proper "柱头" termination. */}
            {h > 10 && (
              <g>
                <line
                  x1={x + 0.4} y1={y + 2.2}
                  x2={x + barW - 0.4} y2={y + 2.2}
                  stroke="rgba(255,237,178,0.9)" strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={x + 0.4} y1={y + 2.95}
                  x2={x + barW - 0.4} y2={y + 2.95}
                  stroke="rgba(0,0,0,0.55)" strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            {/* 6. Mongolian auspicious inscription — one per column,
                   each a different classical wish-word. Twelve total
                   to mirror the twelve months of trend data, engraved
                   into the protruding upper section of every brass
                   column. Black ink on brass with a faint gold halo
                   = classic "黑金" seal aesthetic. */}
            {h > 22 && (() => {
              const MONGOLIAN_WORDS = [
                "ᠠᠮᠤᠷ",  /* amur · 平安 */
                "ᠮᠡᠨᠳᠦ", /* mendu · 安康 */
                "ᠦᠯᠵᠡᠢ", /* öljei · 吉祥 */
                "ᠬᠡᠰᠢᠭ", /* keshig · 福泽 */
                "ᠪᠠᠶᠠᠨ", /* bayan · 富贵 */
                "ᠪᠠᠶᠠᠷ", /* bayar · 喜庆 */
                "ᠪᠤᠶᠠᠨ", /* buyan · 德善 */
                "ᠵᠢᠷᠭᠠᠯ",/* jirgal · 安乐 */
                "ᠠᠵᠠ",   /* aja · 鸿运 */
                "ᠠᠯᠳᠠᠷ", /* aldar · 荣耀 */
                "ᠡᠩᠬᠡ",  /* engke · 太平 */
                "ᠡᠷᠡᠭᠦᠯ",/* eregül · 康健 */
              ];
              const word = MONGOLIAN_WORDS[i % MONGOLIAN_WORDS.length];
              return (
                <foreignObject
                  x={x}
                  y={y + 4}
                  width={barW}
                  height={h - 5}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    xmlns="http://www.w3.org/1999/xhtml"
                    style={{
                      writingMode: "vertical-lr",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily:
                        '"Mongolian Baiti", "Noto Sans Mongolian", "Noto Serif Mongolian", serif',
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#0A0703",
                      textShadow:
                        "0 0 1.6px rgba(239,216,154,0.9), 0 0 0.5px rgba(255,237,178,0.7)",
                      lineHeight: 1,
                      letterSpacing: "-1.5px",
                      userSelect: "none",
                      overflow: "hidden",
                    }}
                  >
                    {word}
                  </div>
                </foreignObject>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}
