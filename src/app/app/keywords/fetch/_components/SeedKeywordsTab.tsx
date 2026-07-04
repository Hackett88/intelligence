"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { SeedKeyword } from "@/contracts/seed-keyword";
import { SwitchInline } from "./SwitchInline";
import { SeedKeywordEditDialog } from "./SeedKeywordEditDialog";
import { SecondaryAuthDialog } from "./SecondaryAuthDialog";
import { BaroqueCorners } from "@/components/ManorOrnaments";

const sc = "var(--font-sc), 'Cormorant SC', serif";
const serif = "var(--font-serif), 'EB Garamond', serif";

// 表头：原始字段名 → 中文 + Latin 副标
const COLS: { key: string; cn: string; la: string; align?: "left" | "right" }[] = [
  { key: "keyword",         cn: "种子词",   la: "SEMEN" },
  { key: "language",        cn: "语言",     la: "LINGUA" },
  { key: "layer_main",      cn: "主层级",   la: "STRATUM" },
  { key: "enabled",         cn: "启用",     la: "ACTIVUM" },
  { key: "fetch_count",     cn: "抓取次数", la: "VICES", align: "right" },
  { key: "fetch_history",   cn: "抓取轨迹", la: "ANNALES" },
  { key: "anchor",          cn: "锚点",     la: "ANCORA" },
  { key: "disabled_reason", cn: "备注",     la: "NOTA" },
  { key: "seed_id",         cn: "卷号",     la: "SEED · №" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnabledFilter = "all" | "enabled" | "disabled";

interface Filters {
  search: string;
  enabledFilter: EnabledFilter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQueryString(
  filters: Filters,
  limit: number,
  cursor: string | undefined
): string {
  const p = new URLSearchParams();
  if (filters.search) p.set("search", filters.search);
  if (filters.enabledFilter === "enabled") p.set("enabled", "true");
  if (filters.enabledFilter === "disabled") p.set("enabled", "false");
  p.set("limit", String(limit));
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeedKeywordsTab() {
  const [rows, setRows] = useState<SeedKeyword[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isMock, setIsMock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // Cursor-based pagination
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    enabledFilter: "all",
  });
  const [searchInput, setSearchInput] = useState("");

  // Dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<SeedKeyword | undefined>();

  // Switch-triggered secondary auth
  const [switchAuthOpen, setSwitchAuthOpen] = useState(false);
  const pendingSwitchRef = useRef<{ row: SeedKeyword; newVal: boolean } | null>(null);

  // Delete confirmation + secondary auth
  const [deleteTarget, setDeleteTarget] = useState<SeedKeyword | null>(null);
  const [deleteAuthOpen, setDeleteAuthOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Debounce search — reset pagination on change
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
      setCursorStack([]);
      setCurrentCursor(undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch rows
  const fetchRows = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setFetchError("");
      try {
        const qs = buildQueryString(filters, PAGE_SIZE, currentCursor);
        const res = await fetch(`/api/seed-keywords?${qs}`, { signal });
        if (signal?.aborted) return;
        if (!res.ok) {
          const d = (await res.json()) as { message?: string };
          setFetchError(d.message ?? "加载失败");
          return;
        }
        const data = (await res.json()) as {
          rows: SeedKeyword[];
          total?: number;
          nextCursor?: string;
          is_mock?: boolean;
        };
        setRows(data.rows);
        setTotal(data.total);
        setNextCursor(data.nextCursor);
        if (data.is_mock !== undefined) setIsMock(data.is_mock);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setFetchError("网络错误");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, currentCursor]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(controller.signal);
    return () => controller.abort();
  }, [fetchRows]);

  // Pagination handlers
  function handleNextPage() {
    if (!nextCursor) return;
    setCursorStack((s) => [...s, currentCursor ?? ""]);
    setCurrentCursor(nextCursor);
  }

  function handlePrevPage() {
    const stack = [...cursorStack];
    const prev = stack.pop();
    setCursorStack(stack);
    setCurrentCursor(prev === "" ? undefined : prev);
  }

  const currentPage = cursorStack.length + 1;
  const hasPrev = cursorStack.length > 0 || currentCursor !== undefined;
  const hasNext = !!nextCursor;

  // Inline switch handler
  function handleSwitchClick(row: SeedKeyword, newVal: boolean) {
    pendingSwitchRef.current = { row, newVal };
    setSwitchAuthOpen(true);
  }

  async function doSwitchUpdate() {
    const pending = pendingSwitchRef.current;
    if (!pending) return;
    try {
      const res = await fetch(`/api/seed-keywords/${pending.row.seed_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: pending.newVal }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as SeedKeyword;
      setRows((prev) =>
        prev.map((r) => (r.seed_id === updated.seed_id ? updated : r))
      );
    } catch {
      /* silent; re-fetch will reconcile */
    }
    pendingSwitchRef.current = null;
  }

  // Delete handler — open custom centered confirmation dialog
  function handleDelete(row: SeedKeyword) {
    setDeleteTarget(row);
    setDeleteError("");
  }

  // 删除是破坏性操作 — 每次都强制弹密码门，不复用 cookie
  function doDelete() {
    if (!deleteTarget) return;
    setDeleteError("");
    setDeleteAuthOpen(true);
  }

  async function executeDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/seed-keywords/${target.seed_id}`, {
        method: "DELETE",
      });

      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        if (
          data.code === "SECONDARY_AUTH_EXPIRED" ||
          data.code === "SECONDARY_AUTH_REQUIRED"
        ) {
          setDeleteAuthOpen(true);
          return;
        }
        setDeleteError("登录已过期，请刷新页面");
        return;
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setDeleteError(data.message ?? "删除失败");
        return;
      }

      setRows((prev) => prev.filter((r) => r.seed_id !== target.seed_id));
      if (total !== undefined) setTotal((t) => (t !== undefined ? t - 1 : undefined));
      setDeleteTarget(null);
    } catch {
      setDeleteError("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  }

  function openCreate() {
    setEditMode("create");
    setEditTarget(undefined);
    setEditOpen(true);
  }

  function openEdit(row: SeedKeyword) {
    setEditMode("edit");
    setEditTarget(row);
    setEditOpen(true);
  }

  function handleSaved(saved: SeedKeyword) {
    if (editMode === "create") {
      setRows((prev) => [saved, ...prev]);
      if (total !== undefined) setTotal((t) => (t !== undefined ? t + 1 : undefined));
    } else {
      setRows((prev) => prev.map((r) => (r.seed_id === saved.seed_id ? saved : r)));
    }
  }

  // Reset pagination when filters change (except search — handled by debounce)
  function handleFilterChange(update: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...update }));
    setCursorStack([]);
    setCurrentCursor(undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Mock banner */}
      {isMock && (
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-manor-brass/8 border border-manor-brass/40 text-manor-brassHi text-xs w-fit"
          style={{ borderRadius: 3, fontFamily: serif }}
        >
          <span className="diamond bg-manor-brassHi shrink-0" />
          <span className="font-sc tracking-[0.22em]" style={{ fontFamily: sc, fontSize: 10 }}>
            DATA · SIMULATA
          </span>
          <span className="text-manor-inkDim">当前为 Mock 数据，待切换至真实 N8N 链路</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索种子词…"
            className="bg-manor-void/60 border border-manor-brass/30 px-3 py-1.5 text-xs text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30 w-48"
            style={{ borderRadius: 3, fontFamily: serif }}
          />

          <select
            value={filters.enabledFilter}
            onChange={(e) =>
              handleFilterChange({ enabledFilter: e.target.value as EnabledFilter })
            }
            className="bg-manor-void/60 border border-manor-brass/30 px-2 py-1.5 text-xs text-manor-ink focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30"
            style={{ borderRadius: 3, fontFamily: serif }}
          >
            <option value="all">全部状态</option>
            <option value="enabled">启用</option>
            <option value="disabled">封存</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            title="后续版本支持批量 CSV 导入"
            className="px-3 py-1.5 text-[11px] font-sc tracking-[0.22em] border border-manor-line text-manor-inkFaint cursor-not-allowed"
            style={{ borderRadius: 3, fontFamily: sc }}
          >
            INFERRE · 批量导入
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-1.5 text-[11px] font-sc tracking-[0.22em] text-manor-bg bg-gradient-to-b from-manor-brassHi to-manor-brassDim hover:from-manor-brass hover:to-manor-brass shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_8px_rgba(201,169,97,0.35)] transition-colors"
            style={{ borderRadius: 3, fontFamily: sc }}
          >
            ADSCRIBO · 新增
          </button>
        </div>
      </div>

      {/* Error */}
      {fetchError && (
        <div
          className="border border-manor-oxblood/30 bg-manor-oxblood/10 px-3 py-2 text-xs text-manor-oxbloodHi flex items-center gap-2"
          style={{ borderRadius: 3 }}
        >
          <span className="diamond bg-manor-oxblood shrink-0" />
          {fetchError}
        </div>
      )}

      {/* Table */}
      <div className="glass-panel overflow-auto max-h-[calc(100vh-320px)] min-h-[320px]" style={{ borderRadius: 4 }}>
        <table className="w-full text-sm">
          <thead
            className="sticky top-0 z-10"
            style={{
              background: "linear-gradient(180deg, rgba(26,52,36,.97) 0%, rgba(10,24,16,.98) 100%)",
              boxShadow: "inset 0 1px 0 rgba(239,216,154,.22), inset 0 -1px 0 rgba(0,0,0,.5), 0 1px 0 rgba(239,216,154,.55)",
            }}
          >
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={[
                    "px-4 py-2.5 whitespace-nowrap",
                    c.align === "right" ? "text-right" : "text-left",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-0.5 leading-tight">
                    <span
                      className="font-serif text-manor-brassHi font-semibold"
                      style={{ fontFamily: serif, fontSize: 11.5, letterSpacing: "0.03em" }}
                    >
                      {c.cn}
                    </span>
                    <span
                      className="font-sc tracking-[0.24em] text-manor-brassHi/70"
                      style={{ fontFamily: sc, fontSize: 9 }}
                    >
                      {c.la}
                    </span>
                  </div>
                </th>
              ))}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-manor-bg4 w-full" style={{ borderRadius: 2 }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-manor-inkFaint"
                  style={{ fontFamily: serif, fontSize: 13 }}
                >
                  〔 SEMINA · VACUA 〕
                  <br />
                  <span className="text-manor-inkDim text-xs">
                    种子词库暂无符合条件的记录，点击「ADSCRIBO · 新增」开始添加
                  </span>
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, idx) => (
                <tr
                  key={row.seed_id}
                  className="transition-colors hover:bg-[rgba(239,216,154,.08)]"
                  style={{
                    borderBottom: "1px solid rgba(212,179,111,.1)",
                    background:
                      idx % 2 === 0
                        ? "rgba(16,32,22,.35)"
                        : "rgba(6,16,11,.55)",
                  }}
                >
                  <td className="px-4 py-3 font-medium text-manor-ink" style={{ fontFamily: serif }}>
                    {row.keyword}
                  </td>
                  <td className="px-4 py-3 text-manor-inkDim text-xs">{row.language || "—"}</td>
                  <td className="px-4 py-3 text-manor-inkDim text-xs">{row.layer_main || "—"}</td>
                  <td className="px-4 py-3">
                    <SwitchInline
                      checked={row.enabled}
                      onChange={(v) => handleSwitchClick(row, v)}
                      label={`${row.keyword} 启用状态`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-manor-brassHi tabnum">
                    {row.fetch_count}
                  </td>
                  <td className="px-4 py-3 text-manor-inkDim text-xs max-w-[160px] truncate">
                    <span title={row.fetch_history}>{row.fetch_history || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-manor-inkDim text-xs max-w-[140px] truncate">
                    <span title={row.anchor}>{row.anchor || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-manor-inkDim text-xs max-w-[160px] truncate">
                    <span title={row.disabled_reason}>{row.disabled_reason || "—"}</span>
                  </td>
                  <td
                    className="px-4 py-3 text-manor-inkFaint text-xs tabnum"
                    style={{ fontFamily: sc, letterSpacing: "0.05em" }}
                  >
                    {row.seed_id}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        title="编辑"
                        className="p-1.5 text-manor-inkFaint hover:text-manor-brassHi hover:bg-manor-brass/10 transition-colors"
                        style={{ borderRadius: 2 }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        title="删除"
                        className="p-1.5 text-manor-inkFaint hover:text-manor-oxbloodHi hover:bg-manor-oxblood/15 transition-colors"
                        style={{ borderRadius: 2 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="flex items-center justify-between text-xs text-manor-inkDim"
        style={{ fontFamily: serif }}
      >
        <span>
          本页 <span className="text-manor-brassHi tabnum">{rows.length}</span> 条
          {total !== undefined && (
            <>
              <span className="mx-1 text-manor-inkGhost">·</span>
              共 <span className="text-manor-brassHi tabnum">{total}</span> 条
            </>
          )}
          <span className="mx-1 text-manor-inkGhost">·</span>
          第 <span className="text-manor-brassHi tabnum">{currentPage}</span> 页
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={!hasPrev || loading}
            className="px-3 py-1 text-[11px] font-sc tracking-[0.22em] border border-manor-line2 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brass/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ borderRadius: 3, fontFamily: sc }}
          >
            ‹ ANTE
          </button>
          <span className="px-2 tabnum">{currentPage}</span>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={!hasNext || loading}
            className="px-3 py-1 text-[11px] font-sc tracking-[0.22em] border border-manor-line2 text-manor-inkDim hover:text-manor-brassHi hover:border-manor-brass/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ borderRadius: 3, fontFamily: sc }}
          >
            POST ›
          </button>
        </div>
      </div>

      {/* Edit / Create dialog */}
      <SeedKeywordEditDialog
        open={editOpen}
        mode={editMode}
        initial={editTarget}
        onClose={() => setEditOpen(false)}
        onSaved={handleSaved}
      />

      {/* Switch secondary auth */}
      <SecondaryAuthDialog
        open={switchAuthOpen}
        onSuccess={() => {
          setSwitchAuthOpen(false);
          doSwitchUpdate();
        }}
        onCancel={() => {
          setSwitchAuthOpen(false);
          pendingSwitchRef.current = null;
        }}
      />

      {/* Delete confirmation (centered) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center drawer-mask p-4"
          onClick={() => !deleteLoading && setDeleteTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm glass-panel-brass"
            style={{ borderRadius: 6 }}
          >
            <BaroqueCorners size={20} />
            <div className="p-6 flex flex-col gap-4">
              <div>
                <div
                  className="font-sc tracking-[0.32em] text-manor-oxbloodHi mb-1.5"
                  style={{ fontFamily: sc, fontSize: 10 }}
                >
                  ◆ DELERE · 删除确认
                </div>
                <h2
                  className="text-brass-gradient font-serif font-semibold leading-tight"
                  style={{ fontFamily: serif, fontSize: 20, letterSpacing: "0.02em" }}
                >
                  即将从种子库中除名
                </h2>
                <p
                  className="text-manor-inkDim mt-2"
                  style={{ fontFamily: serif, fontSize: 13 }}
                >
                  词条「
                  <span className="font-medium text-manor-brassHi">
                    {deleteTarget.keyword}
                  </span>
                  」即将永久删除
                </p>
                <p className="text-xs text-manor-oxblood italic mt-1">
                  此举不可撤销
                </p>
                <span className="brass-divider mt-3 opacity-60 block" />
              </div>

              {deleteError && (
                <p
                  className="text-xs text-manor-oxbloodHi border border-manor-oxblood/30 bg-manor-oxblood/10 px-3 py-2 flex items-center gap-2"
                  style={{ borderRadius: 3 }}
                >
                  <span className="diamond bg-manor-oxblood shrink-0" />
                  {deleteError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteLoading}
                  className="px-4 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-inkDim border border-manor-line2 hover:text-manor-ink hover:border-manor-brass/40 disabled:opacity-40 transition-colors"
                  style={{ borderRadius: 3, fontFamily: sc }}
                >
                  ABROGARE · 取消
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={deleteLoading}
                  className="px-5 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-ink bg-gradient-to-b from-manor-oxblood to-manor-oxbloodDim hover:from-manor-oxbloodHi hover:to-manor-oxblood disabled:opacity-40 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_8px_rgba(196,107,90,0.35)] transition-colors"
                  style={{ borderRadius: 3, fontFamily: sc }}
                >
                  {deleteLoading ? "执行中..." : "DELERE · 确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete secondary auth */}
      <SecondaryAuthDialog
        open={deleteAuthOpen}
        onSuccess={() => {
          setDeleteAuthOpen(false);
          executeDelete();
        }}
        onCancel={() => {
          setDeleteAuthOpen(false);
        }}
      />
    </div>
  );
}
