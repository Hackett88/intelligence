"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IndexState } from "./_mock";

export type TimeWindow = "7d" | "28d" | "90d";

export type PositionBucketValue = "top3" | "top10" | "page2" | "deep";

export interface IndexingFilterState {
  search: string;
  market: string[];
  pageType: string[];
  position: PositionBucketValue[];
  indexState: IndexState[];
  timeWindow: TimeWindow;
}

export const DEFAULT_INDEXING_FILTERS: IndexingFilterState = {
  search: "",
  market: [],
  pageType: [],
  position: [],
  indexState: [],
  timeWindow: "90d",
};

type Option = { value: string; label: string; flag?: string };

interface FilterBarProps {
  filters: IndexingFilterState;
  onFilterChange: (filters: IndexingFilterState) => void;
  marketOptions: Option[];
  pageTypeOptions: Option[];
}

const POSITION_OPTIONS: { value: PositionBucketValue; label: string }[] = [
  { value: "top3",  label: "1-3 首位" },
  { value: "top10", label: "4-10 首页" },
  { value: "page2", label: "11-20 第二页" },
  { value: "deep",  label: "21+ 深页" },
];

const INDEX_STATE_OPTIONS: { value: IndexState; label: string }[] = [
  { value: "indexed",    label: "已收录" },
  { value: "discovered", label: "已发现" },
  { value: "excluded",   label: "已排除" },
  { value: "error",      label: "异常" },
];

interface MultiSelectProps {
  placeholder: string;
  values: string[];
  options: Option[];
  onChange: (values: string[]) => void;
  width?: string;
  showFlagOnTrigger?: boolean;
  showFlagInItem?: boolean;
}

function MultiSelect({
  placeholder,
  values,
  options,
  onChange,
  width = "w-32",
  showFlagOnTrigger = false,
  showFlagInItem = false,
}: MultiSelectProps) {
  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  const selected = options.filter((o) => values.includes(o.value));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={[
          width,
          "h-8 shrink-0 border border-manor-brass/30 rounded-md px-2.5",
          "flex items-center justify-between gap-1 text-xs text-left",
          "hover:border-manor-brass/65 transition-colors",
          "focus:outline-none",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-manor-brass focus-visible:border-manor-brass",
          "data-[popup-open]:ring-1 data-[popup-open]:ring-inset data-[popup-open]:ring-manor-brass data-[popup-open]:border-manor-brass",
        ].join(" ")}
        style={{
          background:
            "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(224,197,122,.18), inset 0 -1px 0 rgba(0,0,0,.45)",
        }}
      >
        <span className="truncate flex items-center gap-1.5 min-w-0">
          {selected.length === 0 ? (
            <span className="text-manor-ink/75">{placeholder}</span>
          ) : selected.length === 1 ? (
            showFlagOnTrigger && selected[0].flag ? (
              <>
                <span>{selected[0].flag}</span>
                <span className="text-manor-ink truncate">{selected[0].label}</span>
              </>
            ) : (
              <span className="text-manor-ink truncate">{selected[0].label}</span>
            )
          ) : (
            <span className="text-manor-ink">
              {placeholder} · {selected.length}
            </span>
          )}
        </span>
        <ChevronDown size={12} className="text-manor-inkFaint shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="bg-manor-bg2 border-manor-line text-manor-ink w-auto! min-w-(--anchor-width) py-1"
      >
        {options.map((opt) => {
          const checked = values.includes(opt.value);
          return (
            <MenuPrimitive.CheckboxItem
              key={opt.value}
              checked={checked}
              onCheckedChange={() => toggle(opt.value)}
              className={[
                "group relative flex cursor-default items-center gap-2",
                "rounded-md py-1 pl-2 pr-8 text-xs outline-hidden select-none whitespace-nowrap",
                "data-[highlighted]:bg-manor-bg3 data-[highlighted]:text-manor-ink",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              ].join(" ")}
            >
              <span className="flex-1">
                {showFlagInItem && opt.flag ? (
                  <span className="flex items-center gap-2">
                    <span>{opt.flag}</span>
                    <span>{opt.label}</span>
                  </span>
                ) : (
                  opt.label
                )}
              </span>
              <Check
                size={14}
                strokeWidth={2.5}
                className="absolute right-2 text-manor-inkGhost opacity-0 group-data-[highlighted]:opacity-100 group-data-[checked]:opacity-0"
              />
              <MenuPrimitive.CheckboxItemIndicator className="absolute right-2 flex items-center justify-center">
                <Check size={14} strokeWidth={2.5} className="text-manor-brassHi" />
              </MenuPrimitive.CheckboxItemIndicator>
            </MenuPrimitive.CheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 时间窗 segmented — 7d / 28d / 90d
function TimeWindowSelect({ value, onChange }: { value: TimeWindow; onChange: (v: TimeWindow) => void }) {
  const opts: { value: TimeWindow; label: string }[] = [
    { value: "7d",  label: "7 天" },
    { value: "28d", label: "28 天" },
    { value: "90d", label: "3 个月" },
  ];
  return (
    <div
      className="h-8 shrink-0 inline-flex items-center gap-0 border border-manor-brass/30 rounded-md overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(224,197,122,.18), inset 0 -1px 0 rgba(0,0,0,.45)",
      }}
    >
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "h-full px-2.5 text-xs font-medium transition-colors border-r border-manor-brass/15 last:border-r-0",
              active
                ? "text-manor-brassHi bg-manor-brassDim/15"
                : "text-manor-inkDim hover:text-manor-brassHi hover:bg-manor-brassDim/10",
            ].join(" ")}
            style={
              active
                ? { textShadow: "0 0 6px rgba(239,216,154,.45)" }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({
  filters,
  onFilterChange,
  marketOptions,
  pageTypeOptions,
}: FilterBarProps) {
  const update = <K extends keyof IndexingFilterState>(key: K, value: IndexingFilterState[K]) => {
    onFilterChange({ ...filters, [key]: value });
  };

  const reset = () => {
    onFilterChange({ ...DEFAULT_INDEXING_FILTERS });
  };

  const hasFilters =
    filters.search !== "" ||
    filters.market.length > 0 ||
    filters.pageType.length > 0 ||
    filters.position.length > 0 ||
    filters.indexState.length > 0 ||
    filters.timeWindow !== "90d";

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 min-w-0">
      {/* Latin section anchor */}
      <span className="flex items-center gap-1.5 shrink-0 pr-1">
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
          className="font-sc tracking-[0.26em] text-manor-brassHi/80 leading-none"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 9 }}
        >
          FILTRA
        </span>
        <span
          className="h-px w-6"
          style={{
            background:
              "linear-gradient(90deg, rgba(212,179,111,.4), transparent)",
          }}
        />
      </span>

      <TimeWindowSelect value={filters.timeWindow} onChange={(v) => update("timeWindow", v)} />

      <MultiSelect
        placeholder="市场"
        values={filters.market}
        options={marketOptions}
        onChange={(v) => update("market", v)}
        width="w-32"
        showFlagOnTrigger
        showFlagInItem
      />
      <MultiSelect
        placeholder="页面类型"
        values={filters.pageType}
        options={pageTypeOptions}
        onChange={(v) => update("pageType", v)}
        width="w-32"
      />
      <MultiSelect
        placeholder="排名段"
        values={filters.position}
        options={POSITION_OPTIONS}
        onChange={(v) => update("position", v as PositionBucketValue[])}
        width="w-32"
      />
      <MultiSelect
        placeholder="收录状态"
        values={filters.indexState}
        options={INDEX_STATE_OPTIONS}
        onChange={(v) => update("indexState", v as IndexState[])}
        width="w-32"
      />

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 shrink-0 text-manor-inkFaint hover:text-manor-ink hover:bg-manor-bg3"
          onClick={reset}
        >
          <X size={13} />
          <span className="text-xs ml-1">清空</span>
        </Button>
      )}
    </div>
  );
}
