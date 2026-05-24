"use client";

import * as React from "react";
import { X, ExternalLink } from "lucide-react";
import { Sparkline } from "../../keywords/_components/_utils";
import type { PageDetail, QueryRow } from "./_mock";
import type { TimeWindow } from "./FilterBar";
import {
  MARKET_LABELS,
  PageTypeChip,
  IndexStateChip,
  formatPosition,
  formatCtr,
  formatLargeNumber,
  indexStateLabel,
} from "./_utils";

interface DetailDrawerProps {
  page: PageDetail | null;
  timeWindow: TimeWindow;
  onTimeWindowChange: (v: TimeWindow) => void;
  onClose: () => void;
}

// ───────────────────────────────────────────────────────────────────────────
// 内联子组件：Field / Section / Metric tile / Mini segmented
// ───────────────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-manor-inkDim uppercase tracking-wider leading-none">
        {label}
      </span>
      <div className="text-manor-ink text-sm font-medium leading-snug break-all">
        {value === null || value === undefined || value === ""
          ? <span className="text-manor-inkGhost font-normal">—</span>
          : value}
      </div>
    </div>
  );
}

const SECTION_LATIN: Record<string, string> = {
  "基本信息":     "CARTA · PAGINAE",
  "性能指标":     "METRICA · GSC",
  "12 月趋势":    "ANNUS · TRENDORUM",
  "页面关键词排名": "QUAERELAE · IN PAGINA",
  "关联词库":     "NEXUS · ARCHIVUM",
};

function Section({
  title,
  children,
  extra,
  grid = true,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
  grid?: boolean;
}) {
  const latin = SECTION_LATIN[title] ?? "SECTIO";
  return (
    <div className="glass-panel overflow-hidden relative" style={{ borderRadius: 4 }}>
      <div
        className="px-3 py-2.5 border-b border-manor-brass/35 flex items-center gap-2 relative"
        style={{
          background:
            "linear-gradient(180deg, rgba(26,52,36,.95) 0%, rgba(12,28,18,.97) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(239,216,154,.2), inset 0 -1px 0 rgba(0,0,0,.45)",
        }}
      >
        <span
          aria-hidden="true"
          className="shrink-0"
          style={{
            width: 5,
            height: 5,
            borderRadius: 9999,
            background:
              "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
            boxShadow: "0 0 6px rgba(239,216,154,.65)",
          }}
        />
        <h3
          className="text-brass-gradient font-serif font-semibold leading-none"
          style={{
            fontFamily: "var(--font-serif), 'EB Garamond', serif",
            fontSize: 14,
            letterSpacing: "0.03em",
          }}
        >
          {title}
        </h3>
        <span
          className="font-sc tracking-[0.32em] text-manor-brassHi leading-none"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9.5 }}
        >
          〔{latin}〕
        </span>
        <span className="brass-divider flex-1 opacity-60 self-center" />
        {extra && <span className="shrink-0">{extra}</span>}
      </div>
      <div className={grid ? "p-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs" : "p-3 text-xs"}>
        {children}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  latin,
  value,
  subline,
}: {
  label: string;
  latin: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
}) {
  return (
    <div
      className="px-3 py-2.5 relative overflow-hidden"
      style={{
        borderRadius: 4,
        background:
          "linear-gradient(180deg, rgba(20,42,28,.92) 0%, rgba(10,24,16,.96) 100%)",
        border: "1px solid rgba(201, 169, 97, .25)",
        boxShadow:
          "inset 0 1px 0 rgba(224, 197, 122, .15), inset 0 -1px 0 rgba(0, 0, 0, .5)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          aria-hidden="true"
          style={{
            width: 3,
            height: 3,
            transform: "rotate(45deg)",
            background:
              "linear-gradient(135deg, #EFD89A 0%, #A08850 100%)",
            boxShadow: "0 0 4px rgba(239,216,154,.55)",
          }}
        />
        <span
          className="text-manor-brassHi/85 tracking-[0.22em]"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 8.5,
          }}
        >
          {latin}
        </span>
      </div>
      <p
        className="text-brass-gradient font-semibold tabnum leading-none"
        style={{
          fontFamily: "var(--font-serif), 'EB Garamond', serif",
          fontSize: 19,
        }}
      >
        {value}
      </p>
      <p
        className="text-manor-ink/70 mt-1"
        style={{
          fontFamily: "var(--font-serif), 'EB Garamond', serif",
          fontSize: 10.5,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      {subline && (
        <p className="text-manor-inkFaint text-[10px] mt-0.5">{subline}</p>
      )}
    </div>
  );
}

function MiniSegmented({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  const opts: { value: TimeWindow; label: string }[] = [
    { value: "7d",  label: "7d" },
    { value: "28d", label: "28d" },
    { value: "90d", label: "90d" },
  ];
  return (
    <div
      className="inline-flex items-center border border-manor-brass/30 rounded overflow-hidden"
      style={{ height: 20 }}
    >
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "px-1.5 text-[10px] tracking-wide transition-colors border-r border-manor-brass/15 last:border-r-0",
              active
                ? "text-manor-brassHi bg-manor-brassDim/15"
                : "text-manor-inkDim hover:text-manor-brassHi",
            ].join(" ")}
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Query rank table (内联 — 不需要 useReactTable 这种重武器)
// ───────────────────────────────────────────────────────────────────────────

function QueryRankTable({ rows }: { rows: QueryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-6 text-manor-inkFaint"
        style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 12 }}
      >
        〔 QUAERELAE · VACUUM 〕<br />
        <span className="text-manor-inkGhost text-[11px]">本页面暂无关键词曝光</span>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-3 px-3">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-manor-brassHi/85">
            <th className="text-left py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">#</th>
            <th className="text-left py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">查询</th>
            <th className="text-right py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">点击</th>
            <th className="text-right py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">曝光</th>
            <th className="text-right py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">CTR</th>
            <th className="text-right py-1.5 px-1.5 font-sc tracking-[0.18em] font-medium border-b border-manor-brass/30">排名</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q, i) => (
            <tr
              key={q.query}
              style={{
                borderBottom: "1px solid rgba(201,169,97,.08)",
                background: i % 2 === 0 ? "rgba(16,32,22,.25)" : "transparent",
              }}
            >
              <td className="py-1.5 px-1.5 text-manor-inkFaint tabular-nums">{i + 1}</td>
              <td className="py-1.5 px-1.5 text-manor-ink truncate max-w-[180px]" title={q.query}>
                {q.query}
              </td>
              <td className="py-1.5 px-1.5 text-right text-manor-ink tabular-nums">
                {q.clicks.toLocaleString()}
              </td>
              <td className="py-1.5 px-1.5 text-right text-manor-inkDim tabular-nums">
                {formatLargeNumber(q.impressions)}
              </td>
              <td className="py-1.5 px-1.5 text-right">{formatCtr(q.ctr)}</td>
              <td className="py-1.5 px-1.5 text-right">{formatPosition(q.position)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Main drawer
// ───────────────────────────────────────────────────────────────────────────

export function DetailDrawer({ page, timeWindow, onTimeWindowChange, onClose }: DetailDrawerProps) {
  if (!page) return null;

  const marketLabel = page.market
    ? MARKET_LABELS[page.market.toLowerCase()] ?? page.market.toUpperCase()
    : null;
  const flag = page.market
    ? ({ uk: "🇬🇧", us: "🇺🇸", sa: "🇸🇦", ae: "🇦🇪", my: "🇲🇾", id: "🇮🇩", fr: "🇫🇷", de: "🇩🇪", au: "🇦🇺", tr: "🇹🇷", eg: "🇪🇬", pk: "🇵🇰", bd: "🇧🇩", ng: "🇳🇬", ma: "🇲🇦", ca: "🇨🇦" } as Record<string, string>)[page.market.toLowerCase()]
    : null;

  return (
    <div className="flex flex-col min-w-[440px]">
      {/* 面板顶部 */}
      <div className="px-5 py-4 border-b border-manor-brass/25 sticky top-0 bg-manor-bg3 z-10 flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-3">
          <div
            className="font-sc tracking-[0.28em] text-manor-brassHi/80 mb-1.5"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
          >
            ◆ INSPICIO · 页面详情
          </div>
          <h2
            className="text-brass-gradient font-serif font-semibold leading-tight break-all"
            style={{
              fontFamily: "var(--font-serif), 'EB Garamond', serif",
              fontSize: 18,
              letterSpacing: "0.02em",
            }}
            title={page.fullUrl}
          >
            {page.url}
          </h2>
          <p
            className="text-manor-brassDim text-[10px] mt-2 tabnum tracking-[0.18em]"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            卷号 № {page.id.replace("pg_", "")}
            <span className="mx-2 text-manor-inkGhost">·</span>
            <a
              href={page.fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-manor-brassHi transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              访问页面
              <ExternalLink size={10} />
            </a>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-manor-brassDim hover:text-manor-brassHi transition-colors mt-0.5 shrink-0"
          aria-label="关闭抽屉"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* 基本信息 */}
        <Section title="基本信息">
          <Field
            label="市场"
            value={
              marketLabel
                ? <span className="inline-flex items-center gap-1.5">{flag && <span>{flag}</span>}{marketLabel}</span>
                : null
            }
          />
          <Field label="页面类型" value={<PageTypeChip value={page.pageType} />} />
          <Field
            label="主关键词"
            value={page.topQuery === "—" ? null : page.topQuery}
          />
          <Field label="收录状态" value={<IndexStateChip state={page.indexState} />} />
          <div className="col-span-2">
            <Field
              label="URL"
              value={
                <a
                  href={page.fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-manor-ink hover:text-manor-brassHi underline decoration-manor-brass/30 underline-offset-2 text-xs break-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  {page.fullUrl}
                </a>
              }
            />
          </div>
        </Section>

        {/* 性能指标 */}
        <Section
          title="性能指标"
          grid={false}
          extra={
            <MiniSegmented value={timeWindow} onChange={onTimeWindowChange} />
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label="总点击次数"
              latin="CLICKS"
              value={page.clicks > 0 ? page.clicks.toLocaleString() : "—"}
            />
            <MetricTile
              label="总曝光次数"
              latin="VISUS"
              value={page.impressions > 0 ? formatLargeNumber(page.impressions) : "—"}
            />
            <MetricTile
              label="点击率"
              latin="PROPORTIO"
              value={page.ctr > 0 ? `${(page.ctr * 100).toFixed(1)}%` : "—"}
            />
            <MetricTile
              label="平均排名"
              latin="POSITIO"
              value={page.position > 0 ? page.position.toFixed(1) : "—"}
              subline={
                page.position > 0
                  ? page.position <= 3 ? "1-3 首位"
                    : page.position <= 10 ? "4-10 首页"
                    : page.position <= 20 ? "11-20 第二页"
                    : "21+ 深页"
                  : indexStateLabel(page.indexState)
              }
            />
          </div>
        </Section>

        {/* 12 月趋势 */}
        <Section title="12 月趋势" grid={false}>
          {page.trend12m && page.trend12m.some((v) => v > 0) ? (
            <div className="flex items-center gap-2">
              <Sparkline data={page.trend12m} width={380} height={80} variant="bar" />
              <span className="text-[10px] text-manor-inkFaint">12 月点击</span>
            </div>
          ) : (
            <span className="text-manor-inkGhost text-xs">—</span>
          )}
        </Section>

        {/* 页面关键词排名 */}
        <Section title="页面关键词排名" grid={false}>
          <QueryRankTable rows={page.queries} />
        </Section>

        {/* 关联词库 */}
        <Section title="关联词库" grid={false}>
          {page.poolMatches > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-manor-ink text-xs">
                <span className="text-brass-gradient font-semibold tabular-nums text-sm">
                  {page.poolMatches}
                </span>
                <span className="text-manor-inkDim ml-1.5">条 query 命中 keywords_pool</span>
              </span>
              <span className="text-[10px] text-manor-inkFaint">点击查询以联动词库视图（即将上线）</span>
            </div>
          ) : (
            <span className="text-manor-inkGhost text-xs">该页面尚未与词库关联</span>
          )}
        </Section>
      </div>
    </div>
  );
}
