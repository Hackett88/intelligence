"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import type { Keyword } from "@/db/schema";
import { formatBP, formatCS, formatIntent, parseTrends, Sparkline } from "./_utils";

function kdCell(kd: number | null) {
  if (kd === null || kd === undefined) return <span className="text-manor-inkGhost">—</span>;
  const cls = kd >= 70 ? "text-manor-oxbloodHi" : kd >= 40 ? "text-manor-brassDim" : "text-manor-brassHi";
  return <span className={`text-xs font-medium ${cls}`}>{kd}</span>;
}

function formatDate(date: Date | null) {
  if (!date) return "—";
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}/${mm}/${dd}`;
}

interface KeywordTableProps {
  data: Keyword[];
  onRowClick: (keyword: Keyword) => void;
}

export function KeywordTable({ data, onRowClick }: KeywordTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "searchVolume", desc: true },
  ]);

  const columns: ColumnDef<Keyword>[] = [
    {
      accessorKey: "keyword",
      header: "关键词",
      size: 240,
      cell: ({ getValue }) => (
        <span className="font-medium text-manor-ink text-sm">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "market",
      header: "市场",
      size: 64,
      cell: ({ getValue }) => (
        <span className="text-xs text-manor-inkDim uppercase">
          {(getValue() as string) ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "searchVolume",
      header: "搜索量",
      size: 96,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return (
          <span className="text-xs text-manor-ink tabular-nums">
            {v != null ? v.toLocaleString() : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "keywordDifficulty",
      header: "KD",
      size: 64,
      cell: ({ getValue }) => kdCell(getValue() as number | null),
    },
    {
      accessorKey: "cpc",
      header: "CPC",
      size: 80,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return (
          <span className="text-xs text-manor-ink tabular-nums">
            {v != null ? `$${v.toFixed(2)}` : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "bp",
      header: "BP 业务价值",
      size: 144,
      cell: ({ getValue }) => formatBP(getValue() as number | null),
    },
    {
      accessorKey: "cs",
      header: "CS 商业信号",
      size: 144,
      cell: ({ getValue }) => formatCS(getValue() as number | null),
    },
    {
      accessorKey: "intent",
      header: "意图",
      size: 96,
      cell: ({ getValue }) => formatIntent(getValue() as string | null),
    },
    {
      accessorKey: "trends",
      header: "12 月趋势",
      size: 132,
      enableSorting: false,
      cell: ({ getValue }) => {
        const data = parseTrends(getValue() as string | null);
        if (!data) return <span className="text-manor-inkGhost text-xs">—</span>;
        return <Sparkline data={data} width={100} height={24} variant="bar" />;
      },
    },
    {
      accessorKey: "protected",
      header: "保护",
      size: 56,
      cell: ({ getValue }) => {
        const v = getValue() as boolean | null;
        if (v === true) {
          return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border bg-manor-bg3 text-manor-brassHi border-manor-line2">
              是
            </span>
          );
        }
        return <span className="text-manor-inkGhost text-xs">—</span>;
      },
    },
    {
      accessorKey: "updatedAt",
      header: "更新时间",
      size: 96,
      cell: ({ getValue }) => (
        <span className="text-manor-inkFaint text-xs">
          {formatDate(getValue() as Date | null)}
        </span>
      ),
    },
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <table className="min-w-max w-full border-collapse">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr
              key={headerGroup.id}
              className="h-11"
            >
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className="px-3 text-left text-[10.5px] font-semibold text-manor-brassHi uppercase tracking-[0.24em] whitespace-nowrap cursor-pointer select-none transition-all font-sc hover:text-[#F0DEA0]"
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      width: header.getSize(),
                      fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                      background:
                        "linear-gradient(180deg, rgba(26,52,36,.97) 0%, rgba(10,24,16,.98) 100%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(224,197,122,.55), inset 0 -1px 0 rgba(224,197,122,.4), 0 1px 0 rgba(224,197,122,.4), 0 -1px 0 rgba(224,197,122,.55)",
                      textShadow: sorted ? "0 0 8px rgba(224,197,122,.55)" : undefined,
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="flex items-center gap-1.5">
                      {sorted && (
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 4,
                            height: 4,
                            transform: "rotate(45deg)",
                            background:
                              "linear-gradient(135deg, #F8E6B0 0%, #D4B36F 55%, #A08850 100%)",
                            boxShadow: "0 0 6px rgba(239,216,154,.85)",
                          }}
                        />
                      )}
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      {sorted === "asc" && (
                        <span className="text-manor-brassHi" style={{ fontSize: 9 }}>▲</span>
                      )}
                      {sorted === "desc" && (
                        <span className="text-manor-brassHi" style={{ fontSize: 9 }}>▼</span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-12 text-manor-inkFaint"
                style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 13 }}
              >
                〔 ARCHIVUM · VACUUM 〕<br />
                <span className="text-manor-inkGhost text-xs">候选词池暂无记录</span>
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row, idx) => (
              <tr
                key={row.id}
                className="glass-row h-9 cursor-pointer transition-colors hover:bg-[rgba(224,197,122,.08)]"
                style={{
                  borderBottom: "1px solid rgba(201,169,97,.1)",
                  background:
                    idx % 2 === 0
                      ? "rgba(16,32,22,.35)"
                      : "rgba(6,16,11,.55)",
                }}
                onClick={() => onRowClick(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
  );
}
