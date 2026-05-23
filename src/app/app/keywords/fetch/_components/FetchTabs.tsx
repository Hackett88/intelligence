"use client";

import { useState } from "react";
import { DataQueryGrid } from "./DataQueryGrid";
import { ScenarioGrid } from "./ScenarioGrid";
import { SeedKeywordsTab } from "./SeedKeywordsTab";

type TabKey = "query" | "scenario" | "data";

const TABS: { key: TabKey; label: string; latin: string }[] = [
  { key: "query",    label: "功能",     latin: "INSTRUMENTA" },
  { key: "scenario", label: "场景",     latin: "SCENARIA" },
  { key: "data",     label: "种子词库", latin: "SEMINARIUM" },
];

const sc = "var(--font-sc), 'Cormorant SC', serif";
const serif = "var(--font-serif), 'EB Garamond', serif";

export function FetchTabs() {
  const [active, setActive] = useState<TabKey>("query");

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="flex gap-2 px-6 pt-1 shrink-0 items-end relative"
        style={{ borderBottom: "1px solid rgba(212,179,111,.28)" }}
      >
        {/* Latin section anchor — bottom-left edge */}
        <span
          className="absolute -top-px left-6 h-px w-20"
          style={{
            background:
              "linear-gradient(90deg, rgba(239,216,154,.8), transparent)",
          }}
        />
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={[
                "tab-press relative px-3.5 py-1.5 leading-none flex flex-col items-center gap-0.5 transition-all -mb-px group",
              ].join(" ")}
              style={
                isActive
                  ? {
                      background:
                        "linear-gradient(180deg, rgba(40,80,55,.55) 0%, rgba(18,42,28,.5) 60%, rgba(8,19,13,.6) 100%)",
                      borderRadius: "8px 8px 0 0",
                      border: "1px solid rgba(212,179,111,.45)",
                      borderBottom: "none",
                      boxShadow:
                        "inset 0 1px 0 rgba(239,216,154,.25), 0 -4px 14px -6px rgba(212,179,111,.5)",
                    }
                  : {
                      borderRadius: "8px 8px 0 0",
                      border: "1px solid transparent",
                      borderBottom: "none",
                    }
              }
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 left-2"
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: 9999,
                    background:
                      "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
                    boxShadow: "0 0 5px rgba(239,216,154,.7)",
                  }}
                />
              )}
              <span
                className="font-serif transition-colors"
                style={{
                  fontFamily: serif,
                  fontSize: 12.5,
                  color: isActive ? "#F8E6B0" : "#9B9384",
                  textShadow: isActive ? "0 0 10px rgba(239,216,154,.55)" : undefined,
                  letterSpacing: "0.03em",
                }}
              >
                {t.label}
              </span>
              <span
                className="font-sc tracking-[0.26em] transition-colors"
                style={{
                  fontFamily: sc,
                  fontSize: 8,
                  color: isActive ? "rgba(239,216,154,.85)" : "#5D5A4F",
                }}
              >
                {t.latin}
              </span>
              {isActive && (
                <span
                  className="absolute -bottom-px left-3 right-3 h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(248,230,176,.95), transparent)",
                    boxShadow: "0 0 10px rgba(239,216,154,.75)",
                  }}
                />
              )}
              {!isActive && (
                <span
                  className="absolute inset-x-3 -bottom-px h-px opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(212,179,111,.5), transparent)",
                  }}
                />
              )}
            </button>
          );
        })}
        {/* Right rail filler — extends Latin sub-anchor */}
        <span className="flex-1" />
        <span
          className="font-sc tracking-[0.32em] text-manor-brassDim self-center pb-2"
          style={{ fontFamily: sc, fontSize: 8.5 }}
        >
          〔 OFFICINA · 词工坊 〕
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2 flex flex-col">
        {/* keyed wrapper triggers fresh fade-up animation on every tab switch */}
        <div key={active} className="tab-fade-up flex-1 min-h-0 flex flex-col">
          {active === "query" && <DataQueryGrid />}
          {active === "scenario" && <ScenarioGrid />}
          {active === "data" && <SeedKeywordsTab />}
        </div>
      </div>

      {/* Budget / data-source row — sits above the global StatusBar */}
      <div
        className="shrink-0 px-6 py-2 flex items-center gap-4"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,19,13,.6) 0%, rgba(4,12,9,.85) 100%)",
          borderTop: "1px solid rgba(201,169,97,.15)",
        }}
      >
        <span className="brass-dot shrink-0" />
        <span
          className="ital-italic text-manor-inkDim min-w-0 truncate"
          style={{ fontFamily: serif, fontSize: 11 }}
          title="所有器具均接入 semrush_kmt_staging 数据源 · 结果写入 THESAURUS 敛述词池"
        >
          所有器具均接入 <span className="text-manor-brassHi">semrush_kmt_staging</span> 数据源 · 结果写入 <span className="text-manor-brassHi">THESAURUS</span> 敛述词池
        </span>
        <span className="flex-1" />
        <span
          className="font-sc text-manor-brassDim tracking-[0.22em] leading-none"
          style={{ fontFamily: sc, fontSize: 10 }}
        >
          预算余额
        </span>
        <span
          className="count-up text-brass-gradient font-serif font-semibold leading-none tabnum num-breath"
          style={{ fontFamily: serif, fontSize: 16, ["--countup-delay" as string]: "200ms" }}
        >
          12,840u
        </span>
        <span
          className="font-sc text-manor-inkDim tracking-[0.22em] leading-none"
          style={{ fontFamily: sc, fontSize: 10 }}
        >
          本月已用
        </span>
        <span
          className="count-up text-manor-brassHi font-serif font-semibold leading-none tabnum"
          style={{ fontFamily: serif, fontSize: 16, ["--countup-delay" as string]: "320ms" }}
        >
          3,160u
        </span>
      </div>
    </div>
  );
}
