"use client";

/**
 * RadialView -- Hub & Spoke / "Radial Constellation" view of the strategy map.
 *
 * Centre = Zikr Ring (the one core product that all traffic flows toward).
 * Satellites = every other theme's pillar, grouped by territory into angular sectors.
 * Lines  = brass-coloured connectors from each satellite to the centre.
 *
 * Pure SVG rendering; layout via trigonometry; responsive via viewBox.
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { WbPage, RawKeyword, Territory, PageRelation } from "./_workbench";
import { isHardCannibalization } from "./_workbench";
import { StatusDot } from "./_utils";

// ── Constants ────────────────────────────────────────────────────────────────
const CORE_THEME_ID = "zikr-ring";

// Layout (in viewBox coords, centred at 0,0)
const VB_SIZE = 800;           // viewBox: -400..+400
const CENTRE_R = 52;           // core node outer radius
const ORBIT_R = 260;           // distance from centre to satellite centres
const SAT_R = 36;              // satellite node radius
const LABEL_OFFSET = 14;       // text offset below node centre

// Territory sector order & colour tints (subtle tint on the satellite ring)
const TERRITORY_ORDER: Territory[] = ["产品", "知识", "工具", "场景", "品牌"];
const TERRITORY_TINT: Record<Territory, string> = {
  "产品": "#EFD89A",  // brass gold
  "知识": "#7BA67D",  // sage green
  "工具": "#D4A574",  // amber
  "场景": "#D88876",  // oxblood rose
  "品牌": "#A08850",  // dim brass
};
const TERRITORY_LABEL: Record<Territory, string> = {
  "产品": "MERX",
  "知识": "SCIENTIA",
  "工具": "INSTRUMENTA",
  "场景": "SCAENA",
  "品牌": "SIGNUM",
};

// ── Types ────────────────────────────────────────────────────────────────────
interface RadialViewProps {
  pages: WbPage[];
  boundByPage: Map<string, RawKeyword[]>;
  highlightPageId: string | null;
  selectedPageId: string | null;
  onPageSelect: (id: string) => void;
  conflicts?: PageRelation[];
}

// Computed satellite position
type SatNode = {
  page: WbPage;
  angle: number;     // radians
  x: number;
  y: number;
  territory: Territory;
  kwCount: number;
  hasConflict: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Component ────────────────────────────────────────────────────────────────
export function RadialView({
  pages,
  boundByPage,
  highlightPageId,
  selectedPageId,
  onPageSelect,
  conflicts = [],
}: RadialViewProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  // The core theme's pillar page
  const corePillar = React.useMemo(
    () => pages.find((p) => p.themeId === CORE_THEME_ID && p.role === "pillar") ?? null,
    [pages],
  );

  // Hard-conflict set
  const hardConflictIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      if (isHardCannibalization(c)) {
        s.add(c.aId);
        s.add(c.bId);
      }
    }
    return s;
  }, [conflicts]);

  // Collect unique themes (pillars only), excluding core
  const satellites = React.useMemo(() => {
    const seen = new Set<string>();
    const pillars: WbPage[] = [];
    for (const p of pages) {
      if (p.role !== "pillar") continue;
      if (p.themeId === CORE_THEME_ID) continue;
      if (seen.has(p.themeId)) continue;
      seen.add(p.themeId);
      pillars.push(p);
    }
    return pillars;
  }, [pages]);

  // Compute positions: group by territory into angular sectors
  const satNodes = React.useMemo<SatNode[]>(() => {
    // Group satellites by territory
    const byTerritory = new Map<Territory, WbPage[]>();
    for (const t of TERRITORY_ORDER) byTerritory.set(t, []);
    for (const p of satellites) {
      const t = p.territory;
      if (!byTerritory.has(t)) byTerritory.set(t, []);
      byTerritory.get(t)!.push(p);
    }

    // Remove empty territories
    const activeTerritories: [Territory, WbPage[]][] = [];
    for (const t of TERRITORY_ORDER) {
      const ps = byTerritory.get(t);
      if (ps && ps.length > 0) activeTerritories.push([t, ps]);
    }

    if (activeTerritories.length === 0) return [];

    // Total count for proportional sector sizing
    const totalNodes = satellites.length;

    // Distribute angular space: each territory gets proportional arc,
    // with a small gap between sectors
    const GAP_RAD = 0.12; // gap between sectors
    const totalGap = GAP_RAD * activeTerritories.length;
    const availableArc = 2 * Math.PI - totalGap;

    const nodes: SatNode[] = [];
    let currentAngle = -Math.PI / 2; // start from top

    for (const [territory, tPages] of activeTerritories) {
      const sectorArc = (tPages.length / totalNodes) * availableArc;
      const step = tPages.length > 1 ? sectorArc / tPages.length : 0;
      const sectorStart = currentAngle + (tPages.length > 1 ? step / 2 : sectorArc / 2);

      for (let i = 0; i < tPages.length; i++) {
        const p = tPages[i];
        const angle = sectorStart + i * step;
        const kwCount = boundByPage.get(p.id)?.length ?? 0;
        nodes.push({
          page: p,
          angle,
          x: Math.cos(angle) * ORBIT_R,
          y: Math.sin(angle) * ORBIT_R,
          territory,
          kwCount,
          hasConflict: hardConflictIds.has(p.id),
        });
      }

      currentAngle += sectorArc + GAP_RAD;
    }

    return nodes;
  }, [satellites, boundByPage, hardConflictIds]);

  // Core stats
  const coreKwCount = corePillar ? (boundByPage.get(corePillar.id)?.length ?? 0) : 0;
  const coreClusterCount = corePillar
    ? pages.filter((p) => p.pillarId === corePillar.id).length
    : 0;

  const isCoreSelected = corePillar && selectedPageId === corePillar.id;
  const isCoreHovered = corePillar && hoveredId === corePillar.id;

  const sc = "Cormorant SC, serif";
  const serif = "EB Garamond, serif";

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
      <svg
        viewBox={`${-VB_SIZE / 2} ${-VB_SIZE / 2} ${VB_SIZE} ${VB_SIZE}`}
        className="w-full h-full max-w-full max-h-full"
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Brass gradient for lines */}
          <linearGradient id="radial-line-brass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A08850" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#D4B36F" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#EFD89A" stopOpacity="0.3" />
          </linearGradient>

          {/* Highlighted line gradient */}
          <linearGradient id="radial-line-active" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A08850" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#EFD89A" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#D4B36F" stopOpacity="0.5" />
          </linearGradient>

          {/* Core golden glow */}
          <radialGradient id="radial-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#EFD89A" stopOpacity="0.5" />
            <stop offset="60%" stopColor="#D4B36F" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#A08850" stopOpacity="0" />
          </radialGradient>

          {/* Core node fill */}
          <radialGradient id="radial-core-fill" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#1F3328" />
            <stop offset="60%" stopColor="#0C1A12" />
            <stop offset="100%" stopColor="#050C09" />
          </radialGradient>

          {/* Core brass ring */}
          <linearGradient id="radial-core-ring" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#F0DEA0" />
            <stop offset="40%" stopColor="#D4B36F" />
            <stop offset="100%" stopColor="#7A5E2E" />
          </linearGradient>

          {/* Satellite fill */}
          <radialGradient id="radial-sat-fill" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#122418" />
            <stop offset="60%" stopColor="#0C1A12" />
            <stop offset="100%" stopColor="#08130D" />
          </radialGradient>

          {/* Orbit ring (dashed) */}
          <radialGradient id="radial-orbit-ring">
            <stop offset="0%" stopColor="#D4B36F" stopOpacity="0" />
            <stop offset="95%" stopColor="#D4B36F" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#D4B36F" stopOpacity="0.15" />
          </radialGradient>

          {/* Animated pulse filter for core */}
          <filter id="core-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feFlood floodColor="#EFD89A" floodOpacity="0.35" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Selection glow filter */}
          <filter id="sat-select-filter" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feFlood floodColor="#EFD89A" floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Orbit ring ────────────────────────────────────────────── */}
        <circle
          cx={0}
          cy={0}
          r={ORBIT_R}
          fill="none"
          stroke="#D4B36F"
          strokeOpacity={0.08}
          strokeWidth={1}
          strokeDasharray="4 8"
        />

        {/* ── Outer decorative ring ──────────────────────────────────── */}
        <circle
          cx={0}
          cy={0}
          r={ORBIT_R + SAT_R + 20}
          fill="none"
          stroke="#D4B36F"
          strokeOpacity={0.04}
          strokeWidth={0.5}
        />

        {/* ── Territory sector labels (around outer rim) ─────────────── */}
        {(() => {
          // Compute territory label positions from satNodes
          const byTerritory = new Map<Territory, SatNode[]>();
          for (const n of satNodes) {
            if (!byTerritory.has(n.territory)) byTerritory.set(n.territory, []);
            byTerritory.get(n.territory)!.push(n);
          }

          return Array.from(byTerritory.entries()).map(([territory, nodes]) => {
            // Average angle of nodes in this territory
            const avgAngle =
              nodes.reduce((sum, n) => sum + n.angle, 0) / nodes.length;
            const labelR = ORBIT_R + SAT_R + 40;
            const lx = Math.cos(avgAngle) * labelR;
            const ly = Math.sin(avgAngle) * labelR;
            const tint = TERRITORY_TINT[territory];
            const latin = TERRITORY_LABEL[territory];

            // Rotate text to follow the arc (readable orientation)
            let textAngle = (avgAngle * 180) / Math.PI;
            // Keep text readable (not upside down)
            if (textAngle > 90 || textAngle < -90) {
              textAngle += 180;
            }

            return (
              <g key={territory}>
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={tint}
                  fillOpacity={0.4}
                  fontSize={9}
                  fontFamily={sc}
                  letterSpacing="0.28em"
                  transform={`rotate(${textAngle}, ${lx}, ${ly})`}
                >
                  {latin}
                </text>
                <text
                  x={lx}
                  y={ly + 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={tint}
                  fillOpacity={0.25}
                  fontSize={8}
                  fontFamily={serif}
                  transform={`rotate(${textAngle}, ${lx}, ${ly + 12})`}
                >
                  {territory}
                </text>
              </g>
            );
          });
        })()}

        {/* ── Connection lines (satellite -> core) ───────────────────── */}
        {satNodes.map((sat) => {
          const isActive =
            hoveredId === sat.page.id || selectedPageId === sat.page.id;
          const isAnyHovered = hoveredId !== null;
          const dimmed = isAnyHovered && !isActive && hoveredId !== corePillar?.id;

          return (
            <line
              key={`line-${sat.page.id}`}
              x1={0}
              y1={0}
              x2={sat.x}
              y2={sat.y}
              stroke={isActive ? "url(#radial-line-active)" : "url(#radial-line-brass)"}
              strokeWidth={isActive ? 2 : 1}
              strokeDasharray={isActive ? "none" : "6 4"}
              opacity={dimmed ? 0.15 : 1}
              style={{ transition: "opacity 0.3s, stroke-width 0.2s" }}
            />
          );
        })}

        {/* ── Small decorative dots on orbit ring ────────────────────── */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <circle
              key={`orb-dot-${deg}`}
              cx={Math.cos(a) * ORBIT_R}
              cy={Math.sin(a) * ORBIT_R}
              r={1.5}
              fill="#D4B36F"
              fillOpacity={0.15}
            />
          );
        })}

        {/* ── Satellite nodes ────────────────────────────────────────── */}
        {satNodes.map((sat) => {
          const isSelected = selectedPageId === sat.page.id;
          const isHovered = hoveredId === sat.page.id;
          const isHighlighted = highlightPageId === sat.page.id;
          const tint = TERRITORY_TINT[sat.territory];

          return (
            <g
              key={sat.page.id}
              transform={`translate(${sat.x}, ${sat.y})`}
              onClick={() => onPageSelect(sat.page.id)}
              onMouseEnter={() => setHoveredId(sat.page.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ cursor: "pointer" }}
              filter={isSelected || isHighlighted ? "url(#sat-select-filter)" : undefined}
            >
              {/* Selection / highlight outer ring */}
              {(isSelected || isHighlighted) && (
                <circle
                  cx={0}
                  cy={0}
                  r={SAT_R + 5}
                  fill="none"
                  stroke="#EFD89A"
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  strokeDasharray="3 3"
                >
                  {isHighlighted && (
                    <animate
                      attributeName="stroke-opacity"
                      values="0.6;0.2;0.6"
                      dur="1.2s"
                      repeatCount="3"
                    />
                  )}
                </circle>
              )}

              {/* Hover ring */}
              {isHovered && !isSelected && (
                <circle
                  cx={0}
                  cy={0}
                  r={SAT_R + 3}
                  fill="none"
                  stroke={tint}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                />
              )}

              {/* Node body */}
              <circle
                cx={0}
                cy={0}
                r={SAT_R}
                fill="url(#radial-sat-fill)"
                stroke={isSelected ? "#EFD89A" : tint}
                strokeWidth={isSelected ? 2 : 1.2}
                strokeOpacity={isSelected ? 0.8 : 0.45}
              />

              {/* Inner decorative ring */}
              <circle
                cx={0}
                cy={0}
                r={SAT_R - 4}
                fill="none"
                stroke={tint}
                strokeWidth={0.5}
                strokeOpacity={0.2}
              />

              {/* Territory diamond marker (top) */}
              <polygon
                points="0,-4 3,0 0,4 -3,0"
                fill={tint}
                fillOpacity={0.6}
                transform={`translate(0, ${-SAT_R + 8})`}
              />

              {/* Theme name */}
              <text
                x={0}
                y={-2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#E8E2D5"
                fontSize={11}
                fontFamily={serif}
              >
                {truncate(sat.page.themeName, 8)}
              </text>

              {/* Keyword count */}
              <text
                x={0}
                y={12}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#9B9384"
                fontSize={9}
                fontFamily={sc}
                letterSpacing="0.1em"
              >
                {sat.kwCount} 词
              </text>

              {/* Conflict indicator (red triangle) */}
              {sat.hasConflict && (
                <g transform={`translate(${SAT_R - 8}, ${-SAT_R + 8})`}>
                  <polygon
                    points="0,-6 5.2,3 -5.2,3"
                    fill="#C46B5A"
                    fillOpacity={0.9}
                  />
                  <text
                    x={0}
                    y={1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#E8E2D5"
                    fontSize={7}
                    fontWeight="bold"
                  >
                    !
                  </text>
                </g>
              )}

              {/* Status dot (bottom) */}
              <circle
                cx={0}
                cy={SAT_R - 8}
                r={3.5}
                fill={
                  sat.page.status === "live"
                    ? "#7BA67D"
                    : sat.page.status === "optimize"
                    ? "#D4B36F"
                    : "#46413A"
                }
                stroke={
                  sat.page.status === "gap"
                    ? "rgba(201,169,97,.35)"
                    : "none"
                }
                strokeWidth={sat.page.status === "gap" ? 1 : 0}
                strokeDasharray={sat.page.status === "gap" ? "2 2" : "none"}
              />
            </g>
          );
        })}

        {/* ── Centre: Core product node ──────────────────────────────── */}
        {corePillar && (
          <g
            onClick={() => onPageSelect(corePillar.id)}
            onMouseEnter={() => setHoveredId(corePillar.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ cursor: "pointer" }}
            filter="url(#core-glow-filter)"
          >
            {/* Outer golden halo */}
            <circle cx={0} cy={0} r={CENTRE_R + 16} fill="url(#radial-core-glow)">
              <animate
                attributeName="r"
                values={`${CENTRE_R + 14};${CENTRE_R + 20};${CENTRE_R + 14}`}
                dur="4s"
                repeatCount="indefinite"
              />
            </circle>

            {/* Selection ring */}
            {(isCoreSelected || isCoreHovered) && (
              <circle
                cx={0}
                cy={0}
                r={CENTRE_R + 6}
                fill="none"
                stroke="#EFD89A"
                strokeWidth={2}
                strokeOpacity={isCoreSelected ? 0.7 : 0.4}
              />
            )}

            {/* Outer brass bezel */}
            <circle
              cx={0}
              cy={0}
              r={CENTRE_R}
              fill="none"
              stroke="url(#radial-core-ring)"
              strokeWidth={3}
            />

            {/* Inner recessed well */}
            <circle
              cx={0}
              cy={0}
              r={CENTRE_R - 3}
              fill="url(#radial-core-fill)"
              stroke="#D4B36F"
              strokeWidth={0.6}
              strokeOpacity={0.4}
            />

            {/* Inner decorative ring */}
            <circle
              cx={0}
              cy={0}
              r={CENTRE_R - 8}
              fill="none"
              stroke="#D4B36F"
              strokeWidth={0.5}
              strokeOpacity={0.25}
              strokeDasharray="2 4"
            />

            {/* Core diamond emblem */}
            <polygon
              points="0,-8 6,0 0,8 -6,0"
              fill="url(#radial-core-ring)"
              transform="translate(0, -22)"
            />

            {/* Theme name */}
            <text
              x={0}
              y={-4}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#EFD89A"
              fontSize={14}
              fontFamily={serif}
              fontWeight={600}
              style={{ textShadow: "0 0 8px rgba(239,216,154,.4)" } as React.CSSProperties}
            >
              Zikr Ring
            </text>

            {/* Latin subtitle */}
            <text
              x={0}
              y={12}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#D4B36F"
              fillOpacity={0.55}
              fontSize={8}
              fontFamily={sc}
              letterSpacing="0.3em"
            >
              NUCLEUS
            </text>

            {/* Stats line */}
            <text
              x={0}
              y={28}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#9B9384"
              fontSize={9}
              fontFamily={serif}
            >
              {coreKwCount} 词 {coreClusterCount > 0 ? `· ${coreClusterCount} 集群` : ""}
            </text>

            {/* Position indicator (if available) */}
            {corePillar.position != null && (
              <text
                x={0}
                y={40}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={
                  corePillar.position <= 3
                    ? "#EFD89A"
                    : corePillar.position <= 10
                    ? "#D4B36F"
                    : "#9B9384"
                }
                fontSize={9}
                fontFamily={serif}
              >
                #{corePillar.position}
              </text>
            )}
          </g>
        )}

        {/* ── Compass points (decorative) ────────────────────────────── */}
        {[
          { label: "N", angle: -Math.PI / 2 },
          { label: "E", angle: 0 },
          { label: "S", angle: Math.PI / 2 },
          { label: "W", angle: Math.PI },
        ].map(({ label, angle }) => {
          const r = ORBIT_R + SAT_R + 58;
          return (
            <text
              key={label}
              x={Math.cos(angle) * r}
              y={Math.sin(angle) * r}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#D4B36F"
              fillOpacity={0.1}
              fontSize={10}
              fontFamily={sc}
              letterSpacing="0.2em"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
