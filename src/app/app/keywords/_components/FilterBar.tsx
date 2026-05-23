"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FilterState {
  search: string;
  market: string[];
  intent: string[];
  questionType: string[];
  behaviorIntent: string[];
  pagePlanningIntent: string[];
  layerLevel: string[];
  protectedOnly: boolean;
}

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  marketOptions: Option[];
  intentOptions: Option[];
  questionTypeOptions: Option[];
  behaviorIntentOptions: Option[];
  pagePlanningIntentOptions: Option[];
  layerLevelOptions: Option[];
}

type Option = { value: string; label: string; flag?: string };

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

export function FilterBar({
  filters,
  onFilterChange,
  marketOptions,
  intentOptions,
  questionTypeOptions,
  behaviorIntentOptions,
  pagePlanningIntentOptions,
  layerLevelOptions,
}: FilterBarProps) {
  const update = (key: keyof FilterState, value: string[] | boolean) => {
    onFilterChange({ ...filters, [key]: value } as FilterState);
  };

  const reset = () => {
    onFilterChange({
      search: "",
      market: [],
      intent: [],
      questionType: [],
      behaviorIntent: [],
      pagePlanningIntent: [],
      layerLevel: [],
      protectedOnly: false,
    });
  };

  const hasFilters =
    filters.search !== "" ||
    filters.market.length > 0 ||
    filters.intent.length > 0 ||
    filters.questionType.length > 0 ||
    filters.behaviorIntent.length > 0 ||
    filters.pagePlanningIntent.length > 0 ||
    filters.layerLevel.length > 0 ||
    filters.protectedOnly;

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 min-w-0">
      {/* Latin section anchor — matches SummaryBar / DashboardKPI prefix pattern */}
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
        placeholder="搜索意图"
        values={filters.intent}
        options={intentOptions}
        onChange={(v) => update("intent", v)}
        width="w-36"
      />
      <MultiSelect
        placeholder="问题类型"
        values={filters.questionType}
        options={questionTypeOptions}
        onChange={(v) => update("questionType", v)}
        width="w-32"
      />
      <MultiSelect
        placeholder="行为意图"
        values={filters.behaviorIntent}
        options={behaviorIntentOptions}
        onChange={(v) => update("behaviorIntent", v)}
        width="w-32"
      />
      <MultiSelect
        placeholder="页面规划"
        values={filters.pagePlanningIntent}
        options={pagePlanningIntentOptions}
        onChange={(v) => update("pagePlanningIntent", v)}
        width="w-32"
      />
      <MultiSelect
        placeholder="分层"
        values={filters.layerLevel}
        options={layerLevelOptions}
        onChange={(v) => update("layerLevel", v)}
        width="w-28"
      />

      <label
        className="h-8 shrink-0 inline-flex items-center gap-1.5 px-2.5 border border-manor-brass/30 rounded-md text-xs text-manor-ink/85 cursor-pointer hover:border-manor-brass/65 select-none transition-colors"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,42,28,.95) 0%, rgba(8,20,13,.97) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(224,197,122,.18), inset 0 -1px 0 rgba(0,0,0,.45)",
        }}
      >
        <input
          type="checkbox"
          checked={filters.protectedOnly}
          onChange={(e) => update("protectedOnly", e.target.checked)}
          className="accent-manor-brass"
        />
        仅显示受保护
      </label>

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
