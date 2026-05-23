"use client";

type Stats = {
  total: number;
  scored: number;
  unscored: number;
  protected: number;
  avgSv: number;
  avgCpc: number;
  lastSync: Date | null;
};

const cards = [
  { label: "总词数",     latin: "VOCABULA",   key: "total" as const,     fmt: (v: number) => v.toLocaleString(), bg: "/summary/vocabula.svg" },
  { label: "已打分",     latin: "AESTIMATA",  key: "scored" as const,    fmt: (v: number) => v.toLocaleString(), bg: "/summary/aestimata.svg" },
  { label: "未打分",     latin: "RUDES",      key: "unscored" as const,  fmt: (v: number) => v.toLocaleString(), bg: "/summary/rudes.svg" },
  { label: "受保护",     latin: "CUSTODITA",  key: "protected" as const, fmt: (v: number) => v.toLocaleString(), bg: "/summary/custodita.svg" },
  { label: "平均搜索量", latin: "MEDIA SV",   key: "avgSv" as const,     fmt: (v: number) => v.toLocaleString(), bg: "/summary/media-sv.svg" },
  { label: "平均 CPC",   latin: "MEDIA CPC",  key: "avgCpc" as const,    fmt: (v: number) => `$${v.toFixed(2)}`, bg: "/summary/media-cpc.svg" },
];

interface SummaryBarProps {
  stats: Stats;
  onCardClick?: (key: string) => void;
}

export function SummaryBar({ stats, onCardClick }: SummaryBarProps) {
  const syncTime = stats.lastSync
    ? (() => {
        const d = new Date(stats.lastSync!);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      })()
    : "--:--";

  const sc = "var(--font-sc), 'Cormorant SC', serif";
  const serif = "var(--font-serif), 'EB Garamond', serif";

  return (
    <div className="flex items-stretch gap-2.5">
      {cards.map((card) => (
        <div
          key={card.key}
          className="glass-panel-interactive flex-1 px-3 py-2.5 select-none relative overflow-hidden"
          style={{
            borderRadius: 4,
            background:
              "linear-gradient(180deg, rgba(28, 56, 38, .92) 0%, rgba(14, 32, 22, .96) 100%)",
            border: "1px solid rgba(201, 169, 97, .28)",
            boxShadow:
              "inset 0 1px 0 rgba(224, 197, 122, .18), inset 0 -1px 0 rgba(0, 0, 0, .5), 0 0 0 1px rgba(0, 0, 0, .35)",
          }}
          onClick={() => onCardClick?.(card.key)}
        >
          {/* themed decorative SVG positioned directly UNDER the brass divider line — same left start (≈64px after latin label) and same right end (12px matches the px-3 content padding) */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-[0]"
            style={{
              left: 64,
              right: 12,
              top: 22,
              bottom: 4,
              backgroundImage: `url(${card.bg})`,
              backgroundSize: "auto 100%",
              backgroundPosition: "right bottom",
              backgroundRepeat: "no-repeat",
              opacity: 0.32,
              mixBlendMode: "screen",
            }}
          />
          <div className="relative z-[1] flex items-center gap-1.5 mb-1">
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
            <p
              className="text-manor-brassHi/85 tracking-[0.26em]"
              style={{ fontFamily: sc, fontSize: 9 }}
            >
              {card.latin}
            </p>
            <span
              className="flex-1 h-px"
              style={{
                background:
                  "linear-gradient(90deg, rgba(212,179,111,.4), transparent)",
              }}
            />
          </div>
          <p
            className="relative z-[1] text-brass-gradient font-semibold tabnum leading-none num-breath"
            style={{ fontFamily: serif, fontSize: 22 }}
          >
            {card.fmt(stats[card.key])}
          </p>
          <p
            className="relative z-[1] text-manor-ink/70 mt-1.5"
            style={{ fontFamily: serif, fontSize: 10.5, letterSpacing: "0.04em" }}
          >
            {card.label}
          </p>
          {/* subtle top brass line */}
          <span
            aria-hidden="true"
            className="absolute top-0 left-3 right-3 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(224,197,122,.55), transparent)",
            }}
          />
        </div>
      ))}

      {/* 最近同步 */}
      <div
        className="flex-1 px-3 py-2.5 relative overflow-hidden"
        style={{
          borderRadius: 4,
          background:
            "linear-gradient(180deg, rgba(36, 28, 12, .92) 0%, rgba(18, 14, 6, .96) 100%)",
          border: "1px solid rgba(224, 197, 122, .45)",
          boxShadow:
            "inset 0 1px 0 rgba(240, 222, 160, .28), inset 0 -1px 0 rgba(0, 0, 0, .55), 0 0 16px -6px rgba(224, 197, 122, .4)",
        }}
      >
        {/* Pocket-watch backdrop — positioned directly UNDER the brass divider line (left start ≈82px after the longer "ULTIMA · SYNC" latin, right 12px matches the px-3 padding) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-[0]"
          style={{
            left: 82,
            right: 12,
            top: 22,
            bottom: 4,
            backgroundImage: "url(/summary/ultima-sync.svg)",
            backgroundSize: "auto 100%",
            backgroundPosition: "right bottom",
            backgroundRepeat: "no-repeat",
            opacity: 0.38,
            mixBlendMode: "screen",
          }}
        />
        <div className="relative z-[1] flex items-center gap-1.5 mb-1">
          <span
            aria-hidden="true"
            style={{
              width: 3,
              height: 3,
              transform: "rotate(45deg)",
              background:
                "linear-gradient(135deg, #F8E6B0 0%, #C46B5A 100%)",
              boxShadow: "0 0 5px rgba(248,230,176,.7)",
            }}
          />
          <p
            className="text-manor-brassHi tracking-[0.26em]"
            style={{ fontFamily: sc, fontSize: 9 }}
          >
            ULTIMA · SYNC
          </p>
          <span
            className="flex-1 h-px"
            style={{
              background:
                "linear-gradient(90deg, rgba(240,222,160,.65), transparent)",
            }}
          />
        </div>
        <p
          className="relative z-[1] text-brass-gradient font-semibold tabnum leading-none num-breath"
          style={{ fontFamily: serif, fontSize: 20 }}
        >
          {syncTime}
        </p>
        <p
          className="relative z-[1] text-manor-ink/70 mt-1.5"
          style={{ fontFamily: serif, fontSize: 10.5, letterSpacing: "0.04em" }}
        >
          最近同步
        </p>
        <span
          aria-hidden="true"
          className="absolute top-0 left-3 right-3 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(240,222,160,.8), transparent)",
          }}
        />
      </div>
    </div>
  );
}
