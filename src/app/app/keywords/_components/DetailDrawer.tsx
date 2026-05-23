"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { Keyword } from "@/db/schema";
import { SerpFeatureChips } from "../fetch/_components/SerpFeatureChips";
import { appendHistory } from "@/lib/query-history";
import {
  bpLabel,
  csLabel,
  formatIntent,
  formatBehaviorIntent,
  formatPagePlanningIntent,
  formatLayerLevel,
  formatClusterId,
  parseTrends,
  Sparkline,
} from "./_utils";

interface DetailDrawerProps {
  keyword: Keyword | null;
  onClose: () => void;
}

// 同月判断：用户 local 月份对比 last_manual_w03_at 的 local 月份（YYYY-MM）。
// 入参为 Date | string | null，统一过 new Date()。
function isSameLocalMonth(ts: Date | string | null | undefined): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// 解析 SSE 流的最小实现：把 ReadableStream 的字节流按 \n\n 切分成 events，
// 抽取 data: 行的 JSON 内容。不区分 event: type —— 调用方按 payload.node_name 自行分发。
async function* readSseEvents(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string | null; data: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let evName: string | null = null;
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) evName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        try {
          yield { event: evName, data: JSON.parse(dataLines.join("\n")) };
        } catch {
          /* skip invalid */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface SerpFeaturesRowProps {
  rowKey: string | null;
  market: string | null;
  keywordText: string;
  initialCodes: string | null;
  initialLastManualW03At: Date | string | null;
}

// SERP 特征行：根据本地状态机决定显示 chips 和 🔍 按钮。
// 点击按钮 → 调 W03 SSE，监听 Refresh Pool 事件后乐观更新本地 state。
// 若用户重开 drawer，会从 server 重新拿到真实状态。
function SerpFeaturesRow({
  rowKey,
  market,
  keywordText,
  initialCodes,
  initialLastManualW03At,
}: SerpFeaturesRowProps) {
  const [codes, setCodes] = useState<string | null>(initialCodes);
  const [lastManualW03At, setLastManualW03At] = useState<Date | string | null>(
    initialLastManualW03At
  );
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // keyword 切换（drawer 切到另一行）时同步初始值
  useEffect(() => {
    setCodes(initialCodes);
    setLastManualW03At(initialLastManualW03At);
    setLoading(false);
    setErrMsg(null);
  }, [rowKey, initialCodes, initialLastManualW03At]);

  const hasCodes = !!codes && codes.trim() !== "";
  const usedThisMonth = isSameLocalMonth(lastManualW03At);
  const showButton = !hasCodes;
  const buttonDisabled = usedThisMonth || loading;

  async function handleClick() {
    if (!rowKey || !market || !keywordText || buttonDisabled) return;
    setLoading(true);
    setErrMsg(null);

    const params = new URLSearchParams({
      endpoint: "W03",
      keyword: keywordText,
      markets: market,
      display_limit: "1",
      refresh_pool: "1",
      row_key: rowKey,
    });
    const url = `/api/keywords/fetch?${params.toString()}`;

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 90_000);

    // 收集 SSE 流里的 rows + _done summary，结束后写一条 source="drawer" 的历史。
    let allRows: unknown[] = [];
    let unitsActual: number | undefined;
    let failedBatches: number | undefined;
    let doneStatus: string | undefined;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      for await (const ev of readSseEvents(res.body)) {
        // event: rows 是单独的 SSE event 名，payload 形如 { rows: [...] }
        if (ev.event === "rows") {
          const rowsData = ev.data as { rows?: unknown[] } | null;
          if (rowsData && Array.isArray(rowsData.rows)) {
            allRows = rowsData.rows;
          }
          continue;
        }
        const data = ev.data as { node_name?: string; node_status?: string; payload?: { codes?: string | null; pg_updated?: boolean; units_actual?: number; failed_batches?: number } } | null;
        if (!data) continue;
        if (data.node_name === "Refresh Pool") {
          const payload = data.payload ?? {};
          if (payload.pg_updated === true) {
            setLastManualW03At(new Date());
          }
          if (payload.codes !== null && payload.codes !== undefined) {
            setCodes(payload.codes);
          }
          if (data.node_status === "warning") {
            setErrMsg("实时查询出错，请稍后重试");
          }
        }
        if (data.node_name === "_done") {
          const payload = data.payload ?? {};
          if (typeof payload.units_actual === "number") unitsActual = payload.units_actual;
          if (typeof payload.failed_batches === "number") failedBatches = payload.failed_batches;
          doneStatus = data.node_status;
          break;
        }
      }

      // SSE 收尾成功（_done 到达）后，写一条 drawer 来源的 W03 历史。静默失败。
      if (doneStatus === "succeeded" || doneStatus === "warning") {
        const summary: {
          rowsTotal: number;
          totalBatches: number;
          unitsActual?: number;
          failedBatches?: number;
        } = {
          rowsTotal: allRows.length,
          totalBatches: 1,
        };
        if (typeof unitsActual === "number") summary.unitsActual = unitsActual;
        if (typeof failedBatches === "number") summary.failedBatches = failedBatches;

        appendHistory(
          "W03",
          {
            label: keywordText,
            tooltip: `${keywordText} · ${market.toUpperCase()} · 来自详情抽屉`,
            rows: allRows,
            summary,
            dataSource: "semrush_phrase_organic（实时）",
            params: { keyword: keywordText, market, display_limit: 1 },
          },
          "drawer"
        ).catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(`实时查询失败：${msg}`);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <SerpFeatureChips codes={codes} />
        </div>
        {showButton && (
          <button
            type="button"
            onClick={handleClick}
            disabled={buttonDisabled}
            title={
              loading
                ? undefined
                : usedThisMonth
                  ? undefined
                  : "实时查询 SERP 特征"
            }
            className={[
              "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border transition-colors",
              buttonDisabled
                ? "border-manor-line text-manor-inkGhost cursor-not-allowed bg-manor-bg"
                : "border-manor-line2 text-manor-inkDim hover:border-manor-brass hover:text-manor-brassHi cursor-pointer bg-manor-bg2",
            ].join(" ")}
            aria-label="实时查询 SERP 特征"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          </button>
        )}
      </div>
      {errMsg && (
        <div className="text-[10px] text-manor-oxblood leading-tight">{errMsg}</div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-manor-inkDim uppercase tracking-wider leading-none">{label}</span>
      <div className="text-manor-ink text-sm font-medium leading-snug break-all">
        {value === null || value === undefined || value === "" ? <span className="text-manor-inkGhost font-normal">—</span> : value}
      </div>
    </div>
  );
}

// Latin sub-label for each drawer section — keeps the bookish/account-ledger
// feel and pairs with the Chinese title.
const SECTION_LATIN: Record<string, string> = {
  "基本信息": "CARTA · PRINCIPALIS",
  "量化指标": "METRICA · VERBI",
  "评分": "AESTIMATIO",
  "意图与分层": "INTENTIO · STRATUM",
  "12 月趋势": "ANNUS · TRENDORUM",
  "SERP 特征": "SIGNA · IN SERP",
  "来源链路": "ORIGO · NEXUS",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const latin = SECTION_LATIN[title] ?? "SECTIO";
  return (
    <div
      className="glass-panel overflow-hidden relative"
      style={{ borderRadius: 4 }}
    >
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
      </div>
      <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {children}
      </div>
    </div>
  );
}

function KdBar({ kd }: { kd: number | null }) {
  if (kd === null || kd === undefined) return <span className="text-manor-inkGhost">—</span>;
  const fillGradient =
    kd >= 70
      ? "linear-gradient(90deg, #A65B5B 0%, #C77676 55%, #D89191 100%)"
      : kd >= 40
        ? "linear-gradient(90deg, #A08850 0%, #D4B36F 55%, #F8E6B0 100%)"
        : "linear-gradient(90deg, #2A4233 0%, #5C8A6B 55%, #BDE6B1 100%)";
  const textCls =
    kd >= 70
      ? "text-manor-oxbloodHi"
      : kd >= 40
        ? "text-manor-brassHi"
        : "text-[#BDE6B1]";
  const diffLabel = kd >= 70 ? "高难" : kd >= 40 ? "中等" : "较易";
  const glowColor =
    kd >= 70
      ? "rgba(199,118,118,.55)"
      : kd >= 40
        ? "rgba(239,216,154,.55)"
        : "rgba(123,166,125,.55)";
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full h-2 relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, rgba(6,16,11,.95) 0%, rgba(12,26,18,.92) 100%)",
          border: "1px solid rgba(212,179,111,.28)",
          boxShadow: "inset 0 1px 0 rgba(0,0,0,.45), inset 0 -1px 0 rgba(239,216,154,.1)",
        }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(kd, 100)}%`,
            background: fillGradient,
            boxShadow: `0 0 6px ${glowColor}`,
          }}
        />
      </div>
      <span className={`text-xs font-semibold w-5 text-right tabnum ${textCls}`}>{kd}</span>
      <span
        className={`text-[10px] w-8 font-sc tracking-[0.16em] ${textCls}`}
        style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
      >
        {diffLabel}
      </span>
    </div>
  );
}

function ScorePills({
  value,
  kind,
  max = 3,
}: {
  value: number | null;
  kind: "bp" | "cs";
  max?: number;
}) {
  if (value === null || value === undefined) return <span className="text-manor-inkGhost">—</span>;
  const dotCls = ["bg-manor-bg4", "bg-manor-brassHi", "bg-manor-sage", "bg-manor-sage"][value] ?? "bg-manor-bg4";
  const label = kind === "bp" ? bpLabel(value) : csLabel(value);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className={`w-2 h-2 rounded-full ${i < value ? dotCls : "bg-manor-bg4"}`} />
        ))}
      </div>
      <span className="text-sm font-medium text-manor-ink">{value} / {max}</span>
      {label && <span className="text-xs text-manor-inkDim">{label}</span>}
    </div>
  );
}

function TrendsBig({ trends }: { trends: string | null }) {
  const data = parseTrends(trends);
  if (!data) return <span className="text-manor-inkGhost">—</span>;
  return (
    <div className="flex items-center gap-2">
      <Sparkline data={data} width={300} height={80} variant="bar" />
      <span className="text-[10px] text-manor-inkFaint">{data.length} 月</span>
    </div>
  );
}

function PipeList({ value }: { value: string | null }) {
  if (!value) return <span className="text-manor-inkGhost">—</span>;
  const parts = value.split("|").filter((s) => s.trim());
  if (parts.length === 0) return <span className="text-manor-inkGhost">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border bg-manor-bg text-manor-ink border-manor-line">
          {p}
        </span>
      ))}
    </div>
  );
}

function formatDate(date: Date | null) {
  if (!date) return "—";
  const d = new Date(date);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

const MARKET_LABELS: Record<string, string> = {
  uk: "🇬🇧 英国", gb: "🇬🇧 英国", us: "🇺🇸 美国", sa: "🇸🇦 沙特", ae: "🇦🇪 阿联酋",
  my: "🇲🇾 马来西亚", id: "🇮🇩 印尼", fr: "🇫🇷 法国", de: "🇩🇪 德国", es: "🇪🇸 西班牙",
  au: "🇦🇺 澳大利亚", tr: "🇹🇷 土耳其", eg: "🇪🇬 埃及", pk: "🇵🇰 巴基斯坦", bd: "🇧🇩 孟加拉",
  ng: "🇳🇬 尼日利亚", ma: "🇲🇦 摩洛哥", dz: "🇩🇿 阿尔及利亚", iq: "🇮🇶 伊拉克", jo: "🇯🇴 约旦",
  kw: "🇰🇼 科威特", qa: "🇶🇦 卡塔尔", om: "🇴🇲 阿曼", bh: "🇧🇭 巴林", lb: "🇱🇧 黎巴嫩",
  sy: "🇸🇾 叙利亚", ye: "🇾🇪 也门", tn: "🇹🇳 突尼斯", ly: "🇱🇾 利比亚", sd: "🇸🇩 苏丹",
  ca: "🇨🇦 加拿大", in: "🇮🇳 印度", ph: "🇵🇭 菲律宾", sg: "🇸🇬 新加坡", th: "🇹🇭 泰国",
  vn: "🇻🇳 越南", jp: "🇯🇵 日本", kr: "🇰🇷 韩国", cn: "🇨🇳 中国", tw: "🇹🇼 台湾",
  it: "🇮🇹 意大利", nl: "🇳🇱 荷兰", pl: "🇵🇱 波兰", ru: "🇷🇺 俄罗斯", br: "🇧🇷 巴西",
  mx: "🇲🇽 墨西哥", za: "🇿🇦 南非",
};

export function DetailDrawer({ keyword, onClose }: DetailDrawerProps) {
  if (!keyword) return null;

  return (
    <div className="flex flex-col min-w-[440px]">
      {/* 面板顶部 */}
      <div className="px-5 py-4 border-b border-manor-brass/25 sticky top-0 bg-manor-bg3 z-10 flex items-start justify-between">
        <div className="min-w-0">
          <div
            className="font-sc tracking-[0.28em] text-manor-brassHi/80 mb-1.5"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
          >
            ◆ INSPICIO · 词条详情
          </div>
          <h2
            className="text-brass-gradient font-serif font-semibold leading-tight break-all"
            style={{
              fontFamily: "var(--font-serif), 'EB Garamond', serif",
              fontSize: 20,
              letterSpacing: "0.02em",
            }}
          >
            {keyword.keyword}
          </h2>
          <p
            className="text-manor-brassDim text-[10px] mt-2 tabnum tracking-[0.18em]"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            卷号 № {String(keyword.id).padStart(4, "0")}
            <span className="mx-2 text-manor-inkGhost">·</span>
            行钥 {keyword.rowKey ?? "—"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-manor-brassDim hover:text-manor-brassHi transition-colors mt-0.5 shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* 区块1 - 基本信息 */}
        <Section title="基本信息">
          <Field label="市场" value={keyword.market ? (MARKET_LABELS[keyword.market.toLowerCase()] ?? keyword.market.toUpperCase()) : null} />
          <Field label="月份" value={keyword.month} />
          <Field label="问题类型" value={keyword.questionType} />
          <Field label="受保护" value={keyword.protected === true ? "是" : keyword.protected === false ? "否" : null} />
        </Section>

        {/* 区块2 - 量化指标 */}
        <Section title="量化指标">
          <Field label="搜索量" value={keyword.searchVolume != null ? keyword.searchVolume.toLocaleString() : null} />
          <Field label="CPC ($)" value={keyword.cpc != null ? `$${keyword.cpc.toFixed(2)}` : null} />
          <div className="col-span-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-manor-inkDim uppercase tracking-wider">竞争难度</span>
              <KdBar kd={keyword.keywordDifficulty} />
            </div>
          </div>
          <Field label="SERP 结果总数" value={keyword.numberOfResults != null ? keyword.numberOfResults.toLocaleString() : null} />
          <Field label="搜索意图" value={formatIntent(keyword.intent)} />
        </Section>

        {/* 区块3 - 评分 */}
        <Section title="评分">
          <Field label="BP 业务价值" value={<ScorePills value={keyword.bp} kind="bp" />} />
          <Field label="CS 商业信号" value={<ScorePills value={keyword.cs} kind="cs" />} />
        </Section>

        {/* 区块3b - 意图与分层（来源 keywords_pool 4 字段：behavior_intent / page_planning_intent / layer_level / cluster_id） */}
        <Section title="意图与分层">
          <Field label="行为意图" value={formatBehaviorIntent(keyword.behaviorIntent)} />
          <Field label="页面规划意图" value={formatPagePlanningIntent(keyword.pagePlanningIntent)} />
          <Field label="分层" value={formatLayerLevel(keyword.layerLevel)} />
          <Field label="词群编号" value={formatClusterId(keyword.clusterId)} />
        </Section>

        {/* 区块4 - 趋势 */}
        <Section title="12 月趋势">
          <div className="col-span-2">
            <TrendsBig trends={keyword.trends} />
          </div>
        </Section>

        {/* 区块5 - SERP 特征 */}
        <Section title="SERP 特征">
          <div className="col-span-2">
            <SerpFeaturesRow
              rowKey={keyword.rowKey ?? null}
              market={keyword.market ?? null}
              keywordText={keyword.keyword}
              initialCodes={keyword.serpFeaturesKeyword}
              initialLastManualW03At={keyword.lastManualW03At}
            />
          </div>
        </Section>

        {/* 区块6 - 来源链路 */}
        <Section title="来源链路">
          <div className="col-span-2">
            <Field label="上游 row_keys" value={<PipeList value={keyword.sourceRowKeys} />} />
          </div>
        </Section>

        {/* 时间信息 */}
        <div className="text-xs text-manor-inkGhost border-t border-manor-line/60 pt-3 flex gap-4">
          <span>创建：{formatDate(keyword.createdAt)}</span>
          <span>更新：{formatDate(keyword.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}
