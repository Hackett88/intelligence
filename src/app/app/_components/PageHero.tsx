/**
 * Re-usable page-hero block in opera-house HUD style.
 * Drops at the top of any page to give it the same baroque framing as the
 * keyword-fetch hero — circular medallion + giant brass title + Latin sub + flourish.
 */
import { BaroqueCorners } from "@/components/ManorOrnaments";
import { AnimatedCompass } from "@/components/AnimatedCompass";

type Props = {
  /** ID of an <symbol> registered by <ManorOrnaments/>. Defaults to compass. */
  medallion?: string;
  /** Tiny chip rendered above the title, e.g. "◆ OFFICINA · 上架" */
  eyebrow?: string;
  /** Big Chinese title */
  title: string;
  /** Latin sub-title rendered between bracket chars */
  latin: string;
  /** Italic English tagline at right */
  tagline?: string;
  /** Right-side slot for HexBadge trio etc. */
  rightSlot?: React.ReactNode;
};

export function PageHero({
  medallion = "orn-compass",
  eyebrow,
  title,
  latin,
  tagline,
  rightSlot,
}: Props) {
  return (
    <div className="px-6 pt-3 pb-2 shrink-0">
      <div className="relative glass-panel px-5 py-3" style={{ borderRadius: 6 }}>
        <BaroqueCorners size={22} />

        {/* Crown strip — three small brass glyphs at top edge */}
        <div
          className="absolute -top-[7px] left-1/2 -translate-x-1/2 flex items-center gap-2 px-2"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,19,13,.95), rgba(8,19,13,.7))",
            borderRadius: 9999,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <polygon
              points="5,1 6,4 9,4 6.5,6 7.5,9 5,7.5 2.5,9 3.5,6 1,4 4,4"
              fill="rgba(224,197,122,.85)"
            />
          </svg>
          <span
            className="font-sc tracking-[0.4em] text-manor-brassDim leading-none"
            style={{
              fontFamily: "var(--font-sc), 'Cormorant SC', serif",
              fontSize: 8,
            }}
          >
            CORONA · 冠
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <polygon
              points="5,1 6,4 9,4 6.5,6 7.5,9 5,7.5 2.5,9 3.5,6 1,4 4,4"
              fill="rgba(224,197,122,.85)"
            />
          </svg>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="medallion-ring relative flex items-center justify-center shrink-0"
            style={{ width: 64, height: 64, borderRadius: 9999 }}
          >
            {medallion === "orn-compass" ? (
              <AnimatedCompass
                size={40}
                style={{
                  filter:
                    "drop-shadow(0 1px 0 rgba(0,0,0,.6)) drop-shadow(0 0 8px rgba(224,197,122,.5))",
                }}
              />
            ) : (
              <svg
                width="40"
                height="40"
                aria-hidden="true"
                style={{
                  filter:
                    "drop-shadow(0 1px 0 rgba(0,0,0,.6)) drop-shadow(0 0 8px rgba(224,197,122,.5))",
                }}
              >
                <use href={`#${medallion}`} />
              </svg>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {eyebrow && (
              <div
                className="font-sc tracking-[0.32em] text-manor-brassHi/80 mb-1"
                style={{
                  fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                  fontSize: 9.5,
                }}
              >
                {eyebrow}
              </div>
            )}
            <h1
              className="text-brass-gradient font-serif font-semibold leading-none"
              style={{
                fontFamily: "var(--font-serif), 'EB Garamond', serif",
                fontSize: 26,
                letterSpacing: "0.04em",
                filter:
                  "drop-shadow(0 0 5px rgba(239,216,154,.22)) drop-shadow(0 1px 0 rgba(0,0,0,.55))",
              }}
            >
              {title}
            </h1>
            <div className="mt-1.5 flex items-center gap-3">
              <span
                className="font-sc tracking-[0.28em] text-manor-brassHi whitespace-nowrap"
                style={{
                  fontFamily: "var(--font-sc), 'Cormorant SC', serif",
                  fontSize: 10,
                  textShadow:
                    "0 0 8px rgba(239,216,154,.5), 0 0 2px rgba(224,197,122,.7)",
                }}
              >
                〔{latin}〕
              </span>
              <span className="brass-divider flex-1 max-w-[160px] opacity-60" />
              {tagline && (
                <span
                  className="ital-italic text-manor-ink/65 inline-flex items-center gap-1.5"
                  style={{
                    fontFamily: "var(--font-serif), 'EB Garamond', serif",
                    fontSize: 13,
                    textShadow: "0 0 4px rgba(239,216,154,.18)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: 9999,
                      background:
                        "radial-gradient(circle at 30% 30%, #F8E6B0, #D4B36F 55%, #A08850)",
                      boxShadow: "0 0 4px rgba(239,216,154,.6)",
                    }}
                  />
                  {tagline}
                </span>
              )}
            </div>
          </div>

          {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        </div>
      </div>
    </div>
  );
}

/** Standard "coming soon" empty-state body for unbuilt sections. */
export function PageEmpty({
  message = "功能开发中",
  latin = "OPUS IN PROGRESSU",
}: {
  message?: string;
  latin?: string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 pb-6">
      <div
        className="relative glass-panel-brass px-14 py-16 text-center"
        style={{ borderRadius: 8, minWidth: 420 }}
      >
        <BaroqueCorners size={28} />

        {/* top brass diamond row */}
        <div className="flex items-center justify-center gap-2 mb-6 opacity-70">
          <span className="brass-divider w-12" />
          <span
            aria-hidden="true"
            style={{
              width: 5,
              height: 5,
              transform: "rotate(45deg)",
              background:
                "radial-gradient(circle at 30% 30%, #EFD89A, #9A7E46 60%, #3A2E12)",
              boxShadow: "0 0 6px rgba(224,197,122,.55)",
            }}
          />
          <span className="brass-divider w-12" />
        </div>

        <div className="brass-aura mx-auto mb-5 inline-flex items-center justify-center"
             style={{ width: 80, height: 80, borderRadius: 9999 }}>
          <AnimatedCompass
            size={72}
            bearing={37}
            className="opacity-80"
            style={{ filter: "drop-shadow(0 0 8px rgba(224,197,122,.5))" }}
          />
        </div>

        <p
          className="text-manor-ink mb-2 font-serif"
          style={{
            fontFamily: "var(--font-serif), 'EB Garamond', serif",
            fontSize: 17,
            letterSpacing: "0.04em",
          }}
        >
          {message}
        </p>
        <p
          className="font-sc tracking-[0.36em] text-manor-brassHi/85"
          style={{
            fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            fontSize: 10.5,
          }}
        >
          〔 {latin} 〕
        </p>

        {/* bottom brass diamond row */}
        <div className="flex items-center justify-center gap-2 mt-6 opacity-70">
          <span className="brass-divider w-12" />
          <span
            aria-hidden="true"
            style={{
              width: 5,
              height: 5,
              transform: "rotate(45deg)",
              background:
                "radial-gradient(circle at 30% 30%, #EFD89A, #9A7E46 60%, #3A2E12)",
              boxShadow: "0 0 6px rgba(224,197,122,.55)",
            }}
          />
          <span className="brass-divider w-12" />
        </div>
      </div>
    </div>
  );
}
