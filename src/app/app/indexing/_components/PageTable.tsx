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
import { Sparkline } from "../../keywords/_components/_utils";
import type { PageRow } from "./_mock";
import {
  IndexStateDot,
  PageTypeChip,
  MarketCell,
  formatPosition,
  formatCtr,
  formatLargeNumber,
} from "./_utils";

interface PageTableProps {
  data: PageRow[];
  onRowClick: (page: PageRow) => void;
}

export function PageTable({ data, onRowClick }: PageTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "clicks", desc: true },
  ]);

  // R109 列宽改为可拖拽（Excel 体验）：表头右边 6px 热区拖动；行高固定，内容超出 truncate。
  // R110 默认宽度按"标题 + 排序图标 + 单元格最常见内容 + 左右 24px padding"重估，
  // 总和 1336 ≤ 默认视口 1447（抽屉关），默认不出横向滚动条。
  const columns: ColumnDef<PageRow>[] = [
    {
      accessorKey: "indexState",
      header: "状态",
      size: 70,
      cell: ({ row }) => <IndexStateDot state={row.original.indexState} />,
    },
    {
      accessorKey: "url",
      header: "URL",
      size: 360,
      cell: ({ row }) => (
        <span className="flex flex-col leading-tight min-w-0">
          <span
            className="font-medium text-manor-ink text-sm truncate"
            title={row.original.fullUrl}
          >
            {row.original.url}
          </span>
          <span className="text-[10px] text-manor-inkFaint truncate">
            weslamic.com{row.original.url}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "market",
      header: "市场",
      size: 90,
      cell: ({ getValue }) => <MarketCell market={getValue() as string} />,
    },
    {
      accessorKey: "pageType",
      header: "页面类型",
      size: 120,
      cell: ({ getValue }) => <PageTypeChip value={getValue() as string} />,
    },
    {
      accessorKey: "topQuery",
      header: "主关键词",
      size: 200,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        if (v === "—") return <span className="text-manor-inkGhost">—</span>;
        return (
          <span className="text-manor-ink text-xs truncate inline-block w-full" title={v}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "clicks",
      header: "总点击",
      size: 100,
      cell: ({ row, getValue }) => {
        // "—" 占位只用于 excluded / error 这种"页面没进 GSC 数据"的状态；
        // indexed / discovered 的页即使 clicks=0 也是真实的"暂无点击"，要显示数字。
        const v = getValue() as number;
        const hasData = row.original.indexState === "indexed" || row.original.indexState === "discovered";
        return (
          <span className="text-xs text-manor-ink tabular-nums">
            {hasData ? v.toLocaleString() : <span className="text-manor-inkGhost">—</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "impressions",
      header: "总曝光",
      size: 100,
      cell: ({ row, getValue }) => {
        const v = getValue() as number;
        const hasData = row.original.indexState === "indexed" || row.original.indexState === "discovered";
        return (
          <span className="text-xs text-manor-ink tabular-nums">
            {hasData ? formatLargeNumber(v) : <span className="text-manor-inkGhost">—</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "ctr",
      header: "CTR",
      size: 76,
      cell: ({ row, getValue }) => formatCtr(getValue() as number, row.original.indexState),
    },
    {
      accessorKey: "position",
      header: "平均排名",
      size: 96,
      cell: ({ row, getValue }) => formatPosition(getValue() as number, row.original.indexState),
    },
    {
      accessorKey: "trend12m",
      header: "12 月趋势",
      size: 124,
      enableSorting: false,
      cell: ({ getValue }) => {
        const data = getValue() as number[];
        if (!data || data.every((v) => v === 0)) return <span className="text-manor-inkGhost text-xs">—</span>;
        return <Sparkline data={data} width={96} height={22} variant="bar" />;
      },
    },
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 48, maxSize: 800 },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <table
      className="border-collapse"
      style={{ tableLayout: "fixed", width: table.getTotalSize() }}
    >
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="h-11">
            {headerGroup.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              return (
                <th
                  key={header.id}
                  className={[
                    "px-3 text-left text-[10.5px] font-semibold text-manor-brassHi uppercase tracking-[0.24em] whitespace-nowrap select-none transition-all font-sc hover:text-[#F0DEA0]",
                    canSort ? "cursor-pointer" : "",
                  ].join(" ")}
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
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                >
                  <span className="flex items-center gap-1.5 overflow-hidden">
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
                    <span className="truncate">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    {sorted === "asc" && (
                      <span className="text-manor-brassHi shrink-0" style={{ fontSize: 9 }}>▲</span>
                    )}
                    {sorted === "desc" && (
                      <span className="text-manor-brassHi shrink-0" style={{ fontSize: 9 }}>▼</span>
                    )}
                  </span>
                  {/* R109 列宽拖拽手柄：右边 4px 热区，鼠标按下拖动调宽。
                      onClick 阻断冒泡防止触发排序；onMouseDown 用 react-table 提供的 handler。 */}
                  {header.column.getCanResize() && (
                    <span
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        header.column.resetSize();
                      }}
                      title="拖动调整列宽，双击复位"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        height: "100%",
                        width: 6,
                        cursor: "col-resize",
                        userSelect: "none",
                        touchAction: "none",
                        background: "transparent",
                      }}
                      aria-hidden="true"
                    />
                  )}
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
              〔 INDEX · VACUUM 〕<br />
              <span className="text-manor-inkGhost text-xs">暂无收录页面记录</span>
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
                <td
                  key={cell.id}
                  className="px-3 whitespace-nowrap overflow-hidden"
                  style={{ width: cell.column.getSize() }}
                >
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
