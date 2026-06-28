"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { SwitchInline } from "../../keywords/fetch/_components/SwitchInline";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface LastRunSummary {
  inspected?: number;
  indexed?: number;
  notIndexed?: number;
  failed?: number;
  durationMs?: number;
  via?: string;
  code?: string;
  error?: string;
}

interface SchedulerConfig {
  ok: boolean;
  enabled: boolean;
  intervalMinutes: number;
  mode: "incremental" | "all";
  lastRunAt: string | null;
  lastRunSummary: LastRunSummary | null;
}

interface SchedulerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ── Presets & helpers ──────────────────────────────────────────────────── */

const INTERVAL_PRESETS = [
  { label: "每小时", value: 60 },
  { label: "每6小时", value: 360 },
  { label: "每天", value: 1440 },
  { label: "每周", value: 10080 },
] as const;

function humanInterval(min: number): string {
  if (min < 60) return `每 ${min} 分钟`;
  if (min < 1440) {
    const h = min / 60;
    return Number.isInteger(h)
      ? h === 1 ? "每小时" : `每 ${h} 小时`
      : `每 ${min} 分钟`;
  }
  if (min < 10080) {
    const d = min / 1440;
    return Number.isInteger(d)
      ? d === 1 ? "每天" : `每 ${d} 天`
      : `每 ${(min / 60).toFixed(1)} 小时`;
  }
  const w = min / 10080;
  return Number.isInteger(w)
    ? w === 1 ? "每周" : `每 ${w} 周`
    : `每 ${(min / 1440).toFixed(1)} 天`;
}

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
  lastRunAt: string | null,
  intervalMinutes: number,
  enabled: boolean,
): string {
  if (!enabled) return "未启用";
  if (!lastRunAt) return "即将执行";
  const next = new Date(lastRunAt).getTime() + intervalMinutes * 60000;
  const diff = next - Date.now();
  if (diff <= 0) return "即将执行";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `约 ${min} 分钟后`;
  const h = Math.floor(min / 60);
  if (h < 24) return `约 ${h} 小时后`;
  return `约 ${Math.floor(h / 24)} 天后`;
}

function summaryLine(s: LastRunSummary): string {
  const parts: string[] = [];
  if (typeof s.inspected === "number") parts.push(`${s.inspected} 查`);
  if (typeof s.indexed === "number") parts.push(`${s.indexed} 收录`);
  if (typeof s.notIndexed === "number") parts.push(`${s.notIndexed} 未收录`);
  if (typeof s.failed === "number" && s.failed > 0) parts.push(`${s.failed} 失败`);
  return parts.length > 0 ? parts.join(" / ") : "--";
}

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

  // Server-side config snapshot (for status display & dirty detection)
  const [config, setConfig] = useState<SchedulerConfig | null>(null);

  // Form state (editable)
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [intervalInput, setIntervalInput] = useState("1440");
  const [mode, setMode] = useState<"incremental" | "all">("incremental");

  /* ── Fetch current config on open ──────────────────────────────────── */

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/indexing/scheduler-config");
      const data = (await res.json()) as SchedulerConfig;
      if (data.ok) {
        setConfig(data);
        setEnabled(data.enabled);
        setIntervalMinutes(data.intervalMinutes);
        setIntervalInput(String(data.intervalMinutes));
        setMode(data.mode);
      } else {
        toast.error("无法加载定时配置");
      }
    } catch {
      toast.error("加载定时配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchConfig();
  }, [open, fetchConfig]);

  /* ── Interval input handlers ───────────────────────────────────────── */

  const handleIntervalChange = (raw: string) => {
    setIntervalInput(raw);
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 1) {
      setIntervalMinutes(n);
    }
  };

  const handleIntervalBlur = () => {
    const clamped = Math.max(5, Math.min(43200, intervalMinutes));
    setIntervalMinutes(clamped);
    setIntervalInput(String(clamped));
  };

  /* ── Save ───────────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (saving) return;
    const clamped = Math.max(5, Math.min(43200, intervalMinutes));
    setSaving(true);
    try {
      const res = await fetch("/api/indexing/scheduler-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, intervalMinutes: clamped, mode }),
      });
      const data = (await res.json()) as SchedulerConfig & { message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message || "保存失败");
        return;
      }
      // Update local state with server response
      setConfig(data);
      setEnabled(data.enabled);
      setIntervalMinutes(data.intervalMinutes);
      setIntervalInput(String(data.intervalMinutes));
      setMode(data.mode);
      toast.success("定时设置已保存");
    } catch {
      toast.error("保存请求失败");
    } finally {
      setSaving(false);
    }
  };

  /* ── Derived display values ────────────────────────────────────────── */

  const lastRunDisplay = config?.lastRunAt
    ? formatRelative(config.lastRunAt)
    : "尚未运行";
  const lastRunTooltip = config?.lastRunAt
    ? formatAbsolute(config.lastRunAt)
    : undefined;

  const hasSummaryError =
    config?.lastRunSummary?.code || config?.lastRunSummary?.error;
  const summaryDisplay = config?.lastRunSummary
    ? hasSummaryError
      ? null // rendered separately as error
      : summaryLine(config.lastRunSummary)
    : "--";

  const nextDisplay = nextRunText(
    config?.lastRunAt ?? null,
    intervalMinutes,
    enabled,
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
          className="fixed z-50 top-1/2 left-1/2 w-full max-w-[460px] transition-all duration-200 data-starting-style:opacity-0 data-starting-style:scale-95 data-ending-style:opacity-0 data-ending-style:scale-95 outline-none"
          style={{
            transform: "translate(-50%, -50%)",
            borderRadius: 6,
          }}
        >
          <div
            className="glass-panel-brass"
            style={{ borderRadius: 6 }}
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
                      配置定时收录检查的启用状态、检查频率和检查范围
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
                    定时收录检查
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

              {loading ? (
                <div
                  className="py-8 text-center text-manor-inkDim text-sm"
                  style={{ fontFamily: serif }}
                >
                  加载中...
                </div>
              ) : (
                <>
                  {/* ── 1. 启用开关 ──────────────────────────── */}
                  <div className="flex items-center gap-3">
                    <SwitchInline
                      checked={enabled}
                      onChange={setEnabled}
                      label="启用定时收录"
                    />
                    <span
                      className="text-sm text-manor-ink"
                      style={{ fontFamily: serif }}
                    >
                      {enabled ? "启用定时收录" : "定时收录已关闭"}
                    </span>
                  </div>

                  {/* ── 2. 检查频率 ──────────────────────────── */}
                  <div className="flex flex-col gap-2">
                    <label
                      className="font-sc tracking-[0.22em] text-manor-brass leading-none"
                      style={{ fontFamily: sc, fontSize: 10 }}
                    >
                      INTERVALLUM · 检查频率
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={5}
                        max={43200}
                        step={1}
                        value={intervalInput}
                        onChange={(e) => handleIntervalChange(e.target.value)}
                        onBlur={handleIntervalBlur}
                        className="w-24 bg-manor-void/60 border border-manor-brass/30 px-3 py-2 text-sm text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30 tabnum"
                        style={{ borderRadius: 3, fontFamily: serif }}
                      />
                      <span
                        className="text-xs text-manor-inkDim"
                        style={{ fontFamily: serif }}
                      >
                        分钟
                      </span>
                      <span className="text-manor-inkFaint text-xs mx-1">=</span>
                      <span
                        className="text-xs text-manor-brassHi"
                        style={{ fontFamily: serif }}
                      >
                        {humanInterval(intervalMinutes)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {INTERVAL_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => {
                            setIntervalMinutes(p.value);
                            setIntervalInput(String(p.value));
                          }}
                          className={[
                            "px-2.5 py-1 text-[11px] rounded border transition-colors whitespace-nowrap",
                            intervalMinutes === p.value
                              ? "border-manor-brassHi/60 text-manor-brassHi bg-manor-brassDim/15"
                              : "border-manor-brass/30 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brass/55",
                          ].join(" ")}
                          style={{ fontFamily: sc, letterSpacing: "0.06em" }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── 3. 检查范围 ──────────────────────────── */}
                  <div className="flex flex-col gap-2">
                    <label
                      className="font-sc tracking-[0.22em] text-manor-brass leading-none"
                      style={{ fontFamily: sc, fontSize: 10 }}
                    >
                      MODUS · 检查范围
                    </label>
                    <div
                      className="inline-flex items-center border border-manor-brass/30 rounded-md overflow-hidden self-start"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
                        boxShadow:
                          "inset 0 1px 0 rgba(224,197,122,.18), inset 0 -1px 0 rgba(0,0,0,.45)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setMode("all")}
                        className={[
                          "h-8 px-3 text-[11.5px] transition-colors border-r border-manor-brass/15 whitespace-nowrap",
                          mode === "all"
                            ? "text-manor-brassHi bg-manor-brassDim/15"
                            : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
                        ].join(" ")}
                        style={{ fontFamily: sc, letterSpacing: "0.06em" }}
                      >
                        全部重查
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("incremental")}
                        className={[
                          "h-8 px-3 text-[11.5px] transition-colors whitespace-nowrap",
                          mode === "incremental"
                            ? "text-manor-brassHi bg-manor-brassDim/15"
                            : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
                        ].join(" ")}
                        style={{ fontFamily: sc, letterSpacing: "0.06em" }}
                      >
                        只查未检查
                      </button>
                    </div>
                    <p
                      className="text-[10.5px] text-manor-inkFaint leading-snug"
                      style={{ fontFamily: serif }}
                    >
                      {mode === "all"
                        ? "全部重查：每次重新检查所有页面的收录状态，更全面但耗时更长。"
                        : "只查未检查：每次只检查尚未检查过的页面，速度更快，适合日常巡检。"}
                    </p>
                  </div>

                  {/* ── 4. 运行状态（只读） ──────────────────── */}
                  <div className="flex flex-col gap-2">
                    <label
                      className="font-sc tracking-[0.22em] text-manor-brass leading-none"
                      style={{ fontFamily: sc, fontSize: 10 }}
                    >
                      STATUS · 运行状态
                    </label>
                    <div
                      className="px-3 py-2.5 rounded flex flex-col gap-1.5 text-[11.5px]"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(20,42,28,.85) 0%, rgba(10,24,16,.92) 100%)",
                        border: "1px solid rgba(201,169,97,.2)",
                      }}
                    >
                      {/* Last run */}
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
                      {/* Last result */}
                      <div className="flex items-center justify-between">
                        <span className="text-manor-inkDim" style={{ fontFamily: serif }}>
                          上次结果
                        </span>
                        {hasSummaryError ? (
                          <span
                            className="text-manor-oxbloodHi text-[11px]"
                            style={{ fontFamily: serif }}
                            title={`code: ${config?.lastRunSummary?.code ?? "N/A"}`}
                          >
                            上次失败：{config?.lastRunSummary?.error || config?.lastRunSummary?.code || "未知错误"}
                          </span>
                        ) : (
                          <span
                            className="text-manor-ink tabnum"
                            style={{ fontFamily: serif }}
                          >
                            {summaryDisplay}
                          </span>
                        )}
                      </div>
                      {/* Next estimated */}
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
