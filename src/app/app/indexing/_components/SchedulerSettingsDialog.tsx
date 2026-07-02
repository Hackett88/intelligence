"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { SwitchInline } from "../../keywords/fetch/_components/SwitchInline";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface CoverageLastRunSummary {
  inspected?: number;
  indexed?: number;
  notIndexed?: number;
  failed?: number;
  durationMs?: number;
  via?: string;
  code?: string;
  error?: string;
}

interface CoverageSchedulerConfig {
  ok: boolean;
  enabled: boolean;
  intervalMinutes: number;
  runHour: number;
  runMinute: number;
  mode: string;
  lastRunAt: string | null;
  lastRunSummary: CoverageLastRunSummary | null;
}

interface TrafficLastRunSummary {
  pages?: number;
  totalClicks?: number;
  totalImpressions?: number;
  retiredThisRun?: number;
  retiredTotal?: number;
  durationMs?: number;
  via?: string;
  code?: string;
  error?: string;
}

interface TrafficSchedulerConfig {
  ok: boolean;
  enabled: boolean;
  intervalMinutes: number;
  runHour: number;
  runMinute: number;
  lastRunAt: string | null;
  lastRunSummary: TrafficLastRunSummary | null;
}

interface SchedulerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return iso;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextRunText(
  runHour: number,
  runMinute: number,
  enabled: boolean,
): string {
  if (!enabled) return "未启用";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const laHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const laMinute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  const nowMin = laHour * 60 + laMinute;
  const targetMin = runHour * 60 + runMinute;
  let diffMin = targetMin - nowMin;
  if (diffMin <= 0) diffMin += 1440; // next day
  if (diffMin < 60) return `约 ${diffMin} 分钟后`;
  const h = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  return rem > 0 ? `约 ${h} 小时 ${rem} 分钟后` : `约 ${h} 小时后`;
}

function coverageSummaryLine(s: CoverageLastRunSummary): string {
  const parts: string[] = [];
  if (typeof s.inspected === "number") parts.push(`${s.inspected} 查`);
  if (typeof s.indexed === "number") parts.push(`${s.indexed} 收录`);
  if (typeof s.notIndexed === "number") parts.push(`${s.notIndexed} 未收录`);
  if (typeof s.failed === "number" && s.failed > 0) parts.push(`${s.failed} 失败`);
  return parts.length > 0 ? parts.join(" / ") : "--";
}

function trafficSummaryLine(s: TrafficLastRunSummary): string {
  const parts: string[] = [];
  if (typeof s.pages === "number") parts.push(`${s.pages} 页`);
  if (typeof s.totalClicks === "number") parts.push(`${s.totalClicks} 点击`);
  if (typeof s.retiredTotal === "number" && s.retiredTotal > 0) parts.push(`退休 ${s.retiredTotal}`);
  return parts.length > 0 ? parts.join(" / ") : "--";
}

/* ── Minute options (step 5) ──────────────────────────────────────────── */

const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);

/* ── Fonts (project convention) ────────────────────────────────────────── */

const sc = "var(--font-sc), 'Cormorant SC', serif";
const serif = "var(--font-serif), 'EB Garamond', serif";

/* ── Component ─────────────────────────────────────────────────────────── */

export function SchedulerSettingsDialog({
  open,
  onOpenChange,
}: SchedulerSettingsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Coverage scheduler state ──
  const [covConfig, setCovConfig] = useState<CoverageSchedulerConfig | null>(null);
  const [covEnabled, setCovEnabled] = useState(false);
  const [covRunHour, setCovRunHour] = useState(6);
  const [covRunMinute, setCovRunMinute] = useState(0);

  // ── Traffic scheduler state ──
  const [trafConfig, setTrafConfig] = useState<TrafficSchedulerConfig | null>(null);
  const [trafEnabled, setTrafEnabled] = useState(false);
  const [trafRunHour, setTrafRunHour] = useState(0);
  const [trafRunMinute, setTrafRunMinute] = useState(30);

  /* ── Fetch both configs on open ──────────────────────────────────── */

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const [covRes, trafRes] = await Promise.all([
        fetch("/api/indexing/scheduler-config"),
        fetch("/api/indexing/traffic-scheduler-config"),
      ]);
      const covData = (await covRes.json()) as CoverageSchedulerConfig;
      const trafData = (await trafRes.json()) as TrafficSchedulerConfig;

      if (covData.ok) {
        setCovConfig(covData);
        setCovEnabled(covData.enabled);
        if (typeof covData.runHour === "number") setCovRunHour(covData.runHour);
        if (typeof covData.runMinute === "number") setCovRunMinute(covData.runMinute);
      }
      if (trafData.ok) {
        setTrafConfig(trafData);
        setTrafEnabled(trafData.enabled);
        if (typeof trafData.runHour === "number") setTrafRunHour(trafData.runHour);
        if (typeof trafData.runMinute === "number") setTrafRunMinute(trafData.runMinute);
      }
      if (!covData.ok && !trafData.ok) {
        toast.error("无法加载定时配置");
      }
    } catch {
      toast.error("加载定时配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchConfigs();
  }, [open, fetchConfigs]);

  /* ── Save both ─────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const [covRes, trafRes] = await Promise.all([
        fetch("/api/indexing/scheduler-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: covEnabled, runHour: covRunHour, runMinute: covRunMinute }),
        }),
        fetch("/api/indexing/traffic-scheduler-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: trafEnabled, runHour: trafRunHour, runMinute: trafRunMinute }),
        }),
      ]);
      const covData = (await covRes.json()) as CoverageSchedulerConfig & { message?: string };
      const trafData = (await trafRes.json()) as TrafficSchedulerConfig & { message?: string };

      if ((!covRes.ok || !covData.ok) && (!trafRes.ok || !trafData.ok)) {
        toast.error(covData.message || trafData.message || "保存失败");
        return;
      }
      if (!covRes.ok || !covData.ok) {
        toast.error(covData.message || "收录定时保存失败");
      } else {
        setCovConfig(covData);
        setCovEnabled(covData.enabled);
        if (typeof covData.runHour === "number") setCovRunHour(covData.runHour);
        if (typeof covData.runMinute === "number") setCovRunMinute(covData.runMinute);
      }
      if (!trafRes.ok || !trafData.ok) {
        toast.error(trafData.message || "流量定时保存失败");
      } else {
        setTrafConfig(trafData);
        setTrafEnabled(trafData.enabled);
        if (typeof trafData.runHour === "number") setTrafRunHour(trafData.runHour);
        if (typeof trafData.runMinute === "number") setTrafRunMinute(trafData.runMinute);
      }
      if ((covRes.ok && covData.ok) && (trafRes.ok && trafData.ok)) {
        toast.success("定时设置已保存");
      }
    } catch {
      toast.error("保存请求失败");
    } finally {
      setSaving(false);
    }
  };

  /* ── Derived display values (Coverage) ─────────────────────────────── */

  const covLastRunDisplay = covConfig?.lastRunAt
    ? formatRelative(covConfig.lastRunAt)
    : "尚未运行";
  const covLastRunTooltip = covConfig?.lastRunAt
    ? formatAbsolute(covConfig.lastRunAt)
    : undefined;
  const covHasSummaryError =
    covConfig?.lastRunSummary?.code || covConfig?.lastRunSummary?.error;
  const covSummaryDisplay = covConfig?.lastRunSummary
    ? covHasSummaryError
      ? null
      : coverageSummaryLine(covConfig.lastRunSummary)
    : "--";
  const covNextDisplay = nextRunText(covRunHour, covRunMinute, covEnabled);

  /* ── Derived display values (Traffic) ──────────────────────────────── */

  const trafLastRunDisplay = trafConfig?.lastRunAt
    ? formatRelative(trafConfig.lastRunAt)
    : "尚未运行";
  const trafLastRunTooltip = trafConfig?.lastRunAt
    ? formatAbsolute(trafConfig.lastRunAt)
    : undefined;
  const trafHasSummaryError =
    trafConfig?.lastRunSummary?.code || trafConfig?.lastRunSummary?.error;
  const trafSummaryDisplay = trafConfig?.lastRunSummary
    ? trafHasSummaryError
      ? null
      : trafficSummaryLine(trafConfig.lastRunSummary)
    : "--";
  const trafNextDisplay = nextRunText(trafRunHour, trafRunMinute, trafEnabled);

  /* ── Shared sub-components ─────────────────────────────────────────── */

  const selectCls =
    "bg-manor-void/60 border border-manor-brass/30 px-2 py-2 text-sm text-manor-ink focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30 tabnum cursor-pointer";

  const renderTimePicker = (
    hour: number,
    minute: number,
    onHourChange: (h: number) => void,
    onMinuteChange: (m: number) => void,
    tip?: string,
  ) => (
    <div className="flex flex-col gap-2">
      <label
        className="font-sc tracking-[0.22em] text-manor-brass leading-none"
        style={{ fontFamily: sc, fontSize: 10 }}
      >
        HORA QUOTIDIANA
      </label>
      <div className="flex items-center gap-2">
        <select
          value={hour}
          onChange={(e) => onHourChange(Number(e.target.value))}
          className={`w-[4.5rem] ${selectCls}`}
          style={{ borderRadius: 3, fontFamily: serif }}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>
              {String(i).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span
          className="text-manor-brassHi text-sm select-none"
          style={{ fontFamily: serif }}
        >
          :
        </span>
        <select
          value={minute}
          onChange={(e) => onMinuteChange(Number(e.target.value))}
          className={`w-[4.5rem] ${selectCls}`}
          style={{ borderRadius: 3, fontFamily: serif }}
        >
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span
          className="text-xs text-manor-inkDim ml-1"
          style={{ fontFamily: serif }}
        >
          洛杉矶时间
        </span>
      </div>
      {tip && (
        <p
          className="text-[10px] text-manor-inkDim leading-snug"
          style={{ fontFamily: serif }}
        >
          {tip}
        </p>
      )}
    </div>
  );

  const renderStatus = (
    lastRunDisplay: string,
    lastRunTooltip: string | undefined,
    hasSummaryError: string | undefined | false | null,
    summaryDisplay: string | null,
    summaryErrorText: string | undefined,
    nextDisplay: string,
    enabled: boolean,
  ) => (
    <div className="flex flex-col gap-2">
      <label
        className="font-sc tracking-[0.22em] text-manor-brass leading-none"
        style={{ fontFamily: sc, fontSize: 10 }}
      >
        STATUS
      </label>
      <div
        className="px-3 py-2.5 rounded flex flex-col gap-1.5 text-[11.5px]"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,42,28,.85) 0%, rgba(10,24,16,.92) 100%)",
          border: "1px solid rgba(201,169,97,.2)",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-manor-inkDim" style={{ fontFamily: serif }}>
            上次运行
          </span>
          <span
            className="text-manor-brassHi tabnum"
            style={{ fontFamily: serif }}
            title={lastRunTooltip}
          >
            {lastRunDisplay}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-manor-inkDim" style={{ fontFamily: serif }}>
            上次结果
          </span>
          {hasSummaryError ? (
            <span
              className="text-manor-oxbloodHi text-[11px]"
              style={{ fontFamily: serif }}
            >
              上次失败：{summaryErrorText || "未知错误"}
            </span>
          ) : (
            <span className="text-manor-ink tabnum" style={{ fontFamily: serif }}>
              {summaryDisplay}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-manor-inkDim" style={{ fontFamily: serif }}>
            下次预计
          </span>
          <span
            className={[
              "tabnum",
              enabled ? "text-manor-brassHi" : "text-manor-inkFaint",
            ].join(" ")}
            style={{ fontFamily: serif }}
          >
            {nextDisplay}
          </span>
        </div>
      </div>
    </div>
  );

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
          style={{
            background: "rgba(8, 18, 13, .62)",
            backdropFilter: "blur(4px)",
          }}
        />
        <Dialog.Popup
          className="fixed z-50 top-1/2 left-1/2 w-full max-w-[500px] max-h-[85vh] transition-all duration-200 data-starting-style:opacity-0 data-starting-style:scale-95 data-ending-style:opacity-0 data-ending-style:scale-95 outline-none"
          style={{
            transform: "translate(-50%, -50%)",
            borderRadius: 6,
          }}
        >
          <div
            className="glass-panel-brass overflow-y-auto"
            style={{ borderRadius: 6, maxHeight: "85vh" }}
          >
            <div className="p-5 flex flex-col gap-4">
              {/* ── Header ───────────────────────────────────── */}
              <div className="flex items-start justify-between">
                <div>
                  <div
                    className="font-sc tracking-[0.32em] text-manor-brassHi/80 mb-1.5"
                    style={{ fontFamily: sc, fontSize: 10 }}
                  >
                    <Dialog.Description className="sr-only">
                      配置定时收录检查和定时流量更新的启用状态与每日运行时刻
                    </Dialog.Description>
                  </div>
                  <Dialog.Title
                    className="text-brass-gradient font-serif font-semibold leading-tight"
                    style={{ fontFamily: serif, fontSize: 20, letterSpacing: "0.02em" }}
                  >
                    <span
                      className="font-sc tracking-[0.32em] text-manor-brassHi/80 block mb-1.5"
                      style={{ fontFamily: sc, fontSize: 10 }}
                    >
                      ◆ HOROLOGIUM · 定时设置
                    </span>
                    自动调度
                  </Dialog.Title>
                </div>
                <Dialog.Close
                  className="text-manor-brassDim hover:text-manor-brassHi transition-colors text-xl leading-none mt-1 shrink-0"
                  aria-label="关闭"
                >
                  <X size={18} />
                </Dialog.Close>
              </div>

              <span className="brass-divider opacity-60 -mt-1" />

              {/* 总说明 */}
              <p
                className="text-[10.5px] text-manor-inkDim leading-snug -mt-1"
                style={{ fontFamily: serif }}
              >
                每个定时按洛杉矶时间的设定时刻，每天自动运行一次（服务器在线时）
              </p>

              {loading ? (
                <div
                  className="py-8 text-center text-manor-inkDim text-sm"
                  style={{ fontFamily: serif }}
                >
                  加载中...
                </div>
              ) : (
                <>
                  {/* ══════════════════════════════════════════════ */}
                  {/* ── 区块 A：定时收录 ─────────────────────────── */}
                  {/* ══════════════════════════════════════════════ */}
                  <div className="flex flex-col gap-3">
                    <label
                      className="font-sc tracking-[0.22em] text-manor-brassHi leading-none"
                      style={{ fontFamily: sc, fontSize: 11 }}
                    >
                      I · 定时收录
                    </label>

                    {/* 启用开关 */}
                    <div className="flex items-center gap-3">
                      <SwitchInline
                        checked={covEnabled}
                        onChange={setCovEnabled}
                        label="启用定时收录"
                      />
                      <span
                        className="text-sm text-manor-ink"
                        style={{ fontFamily: serif }}
                      >
                        {covEnabled ? "启用定时收录" : "定时收录已关闭"}
                      </span>
                    </div>

                    {/* 每日运行时刻 */}
                    {renderTimePicker(
                      covRunHour,
                      covRunMinute,
                      setCovRunHour,
                      setCovRunMinute,
                    )}

                    {/* 按需分级说明（替换原 MODUS 切换） */}
                    <p
                      className="text-[10.5px] text-manor-inkDim leading-snug px-3 py-2 rounded"
                      style={{
                        fontFamily: serif,
                        background:
                          "linear-gradient(180deg, rgba(20,42,28,.6) 0%, rgba(10,24,16,.7) 100%)",
                        border: "1px solid rgba(201,169,97,.15)",
                      }}
                    >
                      按需分级：没查过的立即查 · 未收录的每 24 小时复查 · 已收录的每 7 天兜底复查（防掉出索引）
                    </p>

                    {/* 运行状态 */}
                    {renderStatus(
                      covLastRunDisplay,
                      covLastRunTooltip,
                      covHasSummaryError,
                      covSummaryDisplay,
                      covConfig?.lastRunSummary?.error || covConfig?.lastRunSummary?.code,
                      covNextDisplay,
                      covEnabled,
                    )}
                  </div>

                  <span className="brass-divider opacity-40" />

                  {/* ══════════════════════════════════════════════ */}
                  {/* ── 区块 B：定时更新（流量） ──────────────────── */}
                  {/* ══════════════════════════════════════════════ */}
                  <div className="flex flex-col gap-3">
                    <label
                      className="font-sc tracking-[0.22em] text-manor-brassHi leading-none"
                      style={{ fontFamily: sc, fontSize: 11 }}
                    >
                      II · 定时更新
                    </label>

                    {/* 启用开关 */}
                    <div className="flex items-center gap-3">
                      <SwitchInline
                        checked={trafEnabled}
                        onChange={setTrafEnabled}
                        label="启用定时更新"
                      />
                      <span
                        className="text-sm text-manor-ink"
                        style={{ fontFamily: serif }}
                      >
                        {trafEnabled ? "启用定时更新" : "定时更新已关闭"}
                      </span>
                    </div>

                    {/* 每日运行时刻 */}
                    {renderTimePicker(
                      trafRunHour,
                      trafRunMinute,
                      setTrafRunHour,
                      setTrafRunMinute,
                      "建议设在洛杉矶 00:00–06:00（美国凌晨，Google 刚放出最新数据）",
                    )}

                    {/* 运行状态 */}
                    {renderStatus(
                      trafLastRunDisplay,
                      trafLastRunTooltip,
                      trafHasSummaryError,
                      trafSummaryDisplay,
                      trafConfig?.lastRunSummary?.error || trafConfig?.lastRunSummary?.code,
                      trafNextDisplay,
                      trafEnabled,
                    )}
                  </div>

                  {/* ── Footer buttons ───────────────────────── */}
                  <div className="flex justify-end gap-2 pt-1">
                    <Dialog.Close
                      className="px-4 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-inkDim border border-manor-line2 hover:text-manor-ink hover:border-manor-brass/40 transition-colors"
                      style={{ borderRadius: 3, fontFamily: sc }}
                    >
                      取消
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="px-5 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-bg bg-gradient-to-b from-manor-brassHi to-manor-brassDim hover:from-manor-brass hover:to-manor-brass disabled:opacity-40 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_8px_rgba(201,169,97,0.35)] transition-colors"
                      style={{ borderRadius: 3, fontFamily: sc }}
                    >
                      {saving ? "保存中..." : "SERVARE · 保存"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
