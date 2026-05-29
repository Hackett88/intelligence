"use client";

/**
 * 主题与页面规划 · 视觉助手
 * 角色(支柱/集群) / 状态(已上线/需优化/待新建) / 覆盖率 / 机会分 的统一渲染，
 * 并复用关键词库 & 收录页已有的 chip 体系（layer / page_planning_intent / behavior）。
 */
import * as React from "react";
import type { PageNodeWithRollup, PlanStatus, PageRole, Market } from "./_data";

// 复用既有 chip：page_planning_intent 既是关键词维度，也正是这里的"页面类型"
export {
  formatLayerLevel,
  formatPagePlanningIntent,
  formatBehaviorIntent,
  formatIntent,
} from "../../keywords/_components/_utils";

// ── 市场旗标 ────────────────────────────────────────────────────────────────
export const MARKET_FLAG: Record<string, string> = {
  us: "🇺🇸", uk: "🇬🇧", sa: "🇸🇦", id: "🇮🇩", my: "🇲🇾", ae: "🇦🇪",
  de: "🇩🇪", tr: "🇹🇷", fr: "🇫🇷", au: "🇦🇺", ar: "🇸🇦",
};
export function marketFlag(m: string | null | undefined): string {
  if (!m) return "🌐";
  return MARKET_FLAG[m] ?? "🌐";
}

// ── 角色：支柱(pillar) / 集群(cluster)───────────────────────────────────────
export const ROLE_META: Record<PageRole, { label: string; latin: string }> = {
  pillar: { label: "支柱", latin: "COLUMNA" },
  cluster: { label: "集群", latin: "SATELLES" },
};

/** 支柱 = 实心铜菱形；集群 = 空心铜圆点。沿用收录树 PillarMark/SpokeMark 语汇。 */
export function RoleMark({ role, size = 9 }: { role: PageRole; size?: number }) {
  if (role === "pillar") {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          transform: "rotate(45deg)",
          display: "inline-block",
          background: "linear-gradient(135deg, #F8E6B0 0%, #D4B36F 55%, #A08850 100%)",
          boxShadow: "0 0 8px rgba(239,216,154,.7)",
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size - 1,
        height: size - 1,
        borderRadius: 9999,
        display: "inline-block",
        border: "1.5px solid rgba(201,169,97,.6)",
        background: "rgba(8,19,13,.6)",
      }}
    />
  );
}

// ── 状态：已上线 / 需优化 / 待新建（仿 INDEX_STATE_META 配色分层）─────────────
export const STATUS_META: Record<
  PlanStatus,
  { label: string; latin: string; dot: string; ring: string; text: string; chip: string; hint: string }
> = {
  live: {
    label: "已上线",
    latin: "VIVUS",
    dot: "radial-gradient(circle at 30% 30%, #BDE6B1, #7BA67D 55%, #3D5C46)",
    ring: "rgba(189,230,177,.6)",
    text: "text-manor-sageHi",
    chip: "bg-manor-bg3 text-manor-sageHi border-manor-sageDim/55",
    hint: "已有页面在排名，规划重点是内链承接与持续优化。",
  },
  optimize: {
    label: "需优化",
    latin: "EMENDA",
    dot: "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
    ring: "rgba(239,216,154,.6)",
    text: "text-manor-brassHi",
    chip: "bg-manor-bg3 text-manor-brassHi border-manor-brassDim/55",
    hint: "页面已存在但排名偏后或形态不对，应改造/升级而非新建。",
  },
  gap: {
    label: "待新建",
    latin: "DESIDERATUM",
    dot: "radial-gradient(circle at 30% 30%, #6E665A, #46413A 55%, #2A2722)",
    ring: "rgba(201,169,97,.3)",
    text: "text-manor-inkDim",
    chip: "bg-manor-bg3 text-manor-inkDim border-manor-line2 border-dashed",
    hint: "站内无承接页 —— 内容缺口，需新建。",
  },
};

export function StatusDot({ status, size = 9 }: { status: PlanStatus; size?: number }) {
  const m = STATUS_META[status];
  const gap = status === "gap";
  return (
    <span
      aria-hidden="true"
      title={m.label}
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        display: "inline-block",
        background: m.dot,
        boxShadow: gap ? "none" : `0 0 7px ${m.ring}`,
        border: gap ? "1px dashed rgba(201,169,97,.45)" : `1px solid ${m.ring}`,
        opacity: gap ? 0.85 : 1,
      }}
    />
  );
}

export function StatusChip({ status, size = "md" }: { status: PlanStatus; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  const pad = size === "sm" ? "px-1 py-0 text-[10px]" : "px-1.5 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 rounded border ${pad} ${m.chip}`}>
      <StatusDot status={status} size={size === "sm" ? 6 : 7} />
      {m.label}
    </span>
  );
}

// ── 数值格式 ────────────────────────────────────────────────────────────────
export function formatSv(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

/** 当前排名着色（沿用收录页 formatPosition 阈值）。 */
export function positionText(pos: number | null | undefined): { text: string; cls: string } {
  if (pos == null) return { text: "—", cls: "text-manor-inkGhost" };
  const cls =
    pos <= 3 ? "text-manor-brassHi"
    : pos <= 10 ? "text-manor-brassDim"
    : pos <= 20 ? "text-manor-inkDim"
    : "text-manor-oxbloodHi";
  return { text: `#${pos}`, cls };
}

// ── 机会分（演示用排序键）──────────────────────────────────────────────────
// 思路：搜索量越大、难度越低、且越是"缺口/需优化"越值得做。纯展示，不接真模型。
export function opportunityScore(n: PageNodeWithRollup): number {
  const statusBoost = n.status === "gap" ? 1.6 : n.status === "optimize" ? 1.3 : 0.8;
  const kdFactor = 1 - Math.min(n.avgKd, 60) / 100; // KD 越低分越高
  return Math.round((n.sv + 1) * statusBoost * (0.5 + kdFactor));
}

export function opportunityTier(score: number): { label: string; cls: string } {
  if (score >= 20000) return { label: "极高", cls: "text-manor-brassHi" };
  if (score >= 6000) return { label: "高", cls: "text-manor-sageHi" };
  if (score >= 1500) return { label: "中", cls: "text-manor-brassDim" };
  return { label: "低", cls: "text-manor-inkDim" };
}

// ── 覆盖率条 ────────────────────────────────────────────────────────────────
export function CoverageBar({
  coverage,
  width = 64,
}: {
  coverage: number;
  width?: number;
}) {
  const pct = Math.round(coverage * 100);
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={`覆盖率 ${pct}%`}>
      <span
        className="relative inline-block rounded-full overflow-hidden"
        style={{ width, height: 5, background: "rgba(0,0,0,.45)", border: "1px solid rgba(201,169,97,.2)" }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #A08850, #EFD89A)",
            boxShadow: "0 0 6px rgba(224,197,122,.5)",
          }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-manor-inkDim">{pct}%</span>
    </span>
  );
}

/** locale 旗标行（最多展示 maxN 个，溢出 +N） */
export function MarketFlags({ markets, maxN = 6 }: { markets: Market[] | string[]; maxN?: number }) {
  const shown = markets.slice(0, maxN);
  const extra = markets.length - shown.length;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px]" title={markets.join(" · ")}>
      {shown.map((m, i) => (
        <span key={i}>{marketFlag(m)}</span>
      ))}
      {extra > 0 && <span className="text-[9px] text-manor-inkFaint ml-0.5">+{extra}</span>}
    </span>
  );
}
