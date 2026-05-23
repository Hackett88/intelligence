"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SkillMedallion, FiligreeCorners } from "@/components/ManorOrnaments";

type MedallionSym =
  | "bars" | "question" | "globe" | "metric"
  | "compare" | "search" | "tree" | "ad" | "clock";

// Endpoint → medallion symbol map (extend as new skills land)
const ENDPOINT_MEDAL: Record<string, MedallionSym> = {
  W01: "bars",
  W02: "metric",
  W03: "search",
  W04: "question",
  W05: "tree",
  W06: "globe",
  W07: "globe",
  W08: "ad",
  W09: "clock",
  W10: "compare",
};

// Endpoint → real Latin sub-label (shown beneath the title).
// Falls back to a generic INSTRUMENTUM if unknown — keeps the page from
// shouting "CENSUS · QUESTION" for every unrelated card.
const ENDPOINT_LATIN: Record<string, string> = {
  W01: "CENSUS · VERBORUM",
  W02: "METRICA · VERBI",
  W03: "ADVERSARII · IN SERP",
  W04: "QUAESTIO · INTERROGATIO",
  W05: "COGNATA · THEMATIS",
  W06: "EXTENSIO · PLENA",
  W07: "TRANS · MERCATUM",
  W08: "INIMICUS · IN ADVERSO",
  W09: "ANNALES · ADVERSARII",
  W10: "LACUNA · DOMINII",
  // Scenario cards
  checkup: "DIAGNOSIS · VERBI",
  "competitor-gap": "VACUUM · ADVERSARII",
  "blog-topics": "SEMINA · SCRIBENDI",
  "sem-opportunity": "OCCASIO · MERCATI",
  "multi-market": "EXPANSIO · TERRARUM",
  "content-form": "FORMA · TEXTUS",
};

// Default unit-price hint per endpoint — shown bottom-left.
// Reference image places this on every card as a tiny brass tag.
const ENDPOINT_PRICE: Record<string, string> = {
  W01: "40u/行 · 每行 1 词，最多 100 行",
  W02: "8u/词",
  W03: "12u/词",
  W04: "30u/行",
  W05: "25u/簇",
  W06: "20u/行",
  W07: "15u/词",
  W08: "1u/行",
  W09: "100u/行 · 单次 ≤ 12 月",
  W10: "120u/对比",
};

type Props = {
  title: string;
  description: string;
  endpoint: string;
  available: boolean;
  tags?: string[];
  featured?: boolean;
  /** Bottom-left unit-price hint. Optional — falls back to ENDPOINT_PRICE. */
  priceLabel?: string;
  /** Legacy support — ignored if `medallion` resolves from endpoint */
  icon?: LucideIcon;
  medallion?: MedallionSym;
  /** Optional decorative SVG/PNG painted as a low-opacity backdrop, anchored bottom. */
  backgroundImage?: string;
};

export function SkillCard({
  title,
  description,
  endpoint,
  available,
  tags,
  featured,
  medallion,
  priceLabel,
  backgroundImage,
}: Props) {
  const slug = endpoint.toLowerCase();
  const epUpper = endpoint.toUpperCase();
  const sym = medallion ?? ENDPOINT_MEDAL[epUpper] ?? "bars";
  const latinSub = ENDPOINT_LATIN[epUpper] ?? ENDPOINT_LATIN[endpoint] ?? "INSTRUMENTUM · VERBI";
  const price = priceLabel ?? ENDPOINT_PRICE[epUpper] ?? null;

  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";

  const cardClass = [
    "group relative h-full flex flex-col glass-panel-interactive overflow-hidden p-2 no-underline",
    featured ? "glass-panel-brass" : "glass-panel",
    !available && "opacity-60 cursor-not-allowed",
  ].filter(Boolean).join(" ");

  // Inner JSX shared between Link variant (available) and div variant (coming soon)
  const inner = (
    <>
      {/* sweep overlay — animates a brass shine across the card on hover */}
      <span aria-hidden="true" className="sheen-overlay" />

      {/* optional decorative SVG backdrop — sits below content, anchored bottom but inset above the action bar so it never crosses the brass hairline divider */}
      {backgroundImage && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-[1]"
          style={{
            top: 0,
            bottom: 36,
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: "100% auto",
            backgroundPosition: "center bottom",
            backgroundRepeat: "no-repeat",
            opacity: 0.45,
            mixBlendMode: "screen",
          }}
        />
      )}

      <FiligreeCorners size={10} />

      {/* Endpoint pill — top-right corner */}
      <span
        className="endpoint-pill absolute top-1.5 right-1.5 px-1.5 py-0.5 font-sc tracking-[0.22em] text-manor-brassHi leading-none z-[3]"
        style={{
          fontFamily: sc,
          fontSize: 8.5,
          background:
            "linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(8,19,13,.85) 100%)",
          border: "1px solid rgba(201,169,97,.45)",
          borderRadius: 6,
          boxShadow: "inset 0 1px 0 rgba(224,197,122,.25)",
        }}
      >
        {epUpper}
      </span>

      <div className="relative z-[3] flex items-start gap-2.5 pr-9 min-h-0 flex-1">
        <span className="skill-medallion-wrap">
          <SkillMedallion symbol={sym} size={46} />
        </span>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <h3
            className="font-serif leading-tight text-[14px] font-semibold text-manor-ink"
            style={{
              fontFamily: serif,
              textShadow: "0 1px 0 rgba(0,0,0,.6)",
            }}
          >
            {title}
          </h3>

          {/* endpoint Latin sub-label — diamond + brass divider prefix */}
          <div className="flex items-center gap-1.5 mt-0.5 mb-0.5">
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
              className="font-sc tracking-[0.26em] text-manor-brassHi/85 leading-none"
              style={{ fontFamily: sc, fontSize: 8.5 }}
            >
              {latinSub}
            </span>
            <span
              className="flex-1 h-px"
              style={{
                background:
                  "linear-gradient(90deg, rgba(212,179,111,.4), transparent)",
              }}
            />
          </div>

          <p
            className="leading-snug text-manor-inkDim line-clamp-4 text-[11px]"
            style={{ fontFamily: serif }}
          >
            {description}
          </p>

          {tags && tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center px-1.5 py-0.5 text-[9.5px] text-manor-brassHi border border-manor-brass/30 bg-manor-bg/40"
                  style={{ borderRadius: 2 }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom action row — brass-dot + price on left, sage DISPATCH pill on right */}
      <div className="relative z-[3] mt-1 pt-1 flex items-center gap-2 border-t border-manor-brass/15 shrink-0">
        {price ? (
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="brass-dot shrink-0" />
            <span
              className="text-manor-brassDim truncate min-w-0"
              style={{ fontFamily: serif, fontSize: 10.5 }}
              title={price}
            >
              {price}
            </span>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {available ? (
          <span
            className="dispatch-pill inline-flex items-center gap-1.5 px-3 py-0.5 font-sc tracking-[0.22em] text-manor-ink leading-none shrink-0 whitespace-nowrap"
            style={{
              fontFamily: sc,
              fontSize: 10,
              borderRadius: 9999,
              background:
                "linear-gradient(180deg, rgba(40,80,55,.95) 0%, rgba(18,42,28,.95) 100%)",
              border: "1px solid rgba(123,166,125,.7)",
              boxShadow:
                "inset 0 1px 0 rgba(189,230,177,.4), 0 0 12px rgba(92,138,107,.45)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 4,
                height: 4,
                borderRadius: 9999,
                background:
                  "radial-gradient(circle at 30% 30%, #BDE6B1, #7BA67D 55%, #3D5C46)",
                boxShadow: "0 0 6px rgba(189,230,177,.85)",
              }}
            />
            发送 · DISPATCH
          </span>
        ) : (
          <span
            className="inline-flex items-center px-3 py-0.5 text-[10px] tracking-[0.22em] text-manor-inkFaint border border-manor-line shrink-0 whitespace-nowrap"
            style={{ borderRadius: 9999, fontFamily: sc }}
          >
            COMING · 即将上线
          </span>
        )}
      </div>
    </>
  );

  if (available) {
    return (
      <Link
        href={`/app/keywords/fetch/${slug}`}
        aria-label={`打开 ${title}`}
        className={cardClass}
        style={{ borderRadius: 6 }}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={cardClass}
      style={{ borderRadius: 6 }}
      aria-disabled="true"
    >
      {inner}
    </div>
  );
}
