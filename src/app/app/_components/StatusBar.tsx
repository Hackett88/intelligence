/**
 * Bottom STATUS bar — opera-house HUD edition.
 * Each cartridge stacks: big value + Latin label + small Chinese sub.
 * Center holds an emerald-glow segment medallion; far right shows a
 * "powered by TangXiaoYu" credit with the brand logo.
 *
 * Round 04: cartridges mount with stagger, value digits pop in,
 * hover lights the well and drifts a brass sheen across.
 */

import { AnimatedMedallion } from "@/components/ManorOrnaments";

type Cart = { value: string; latin: string; sub: string };

const sc = "var(--font-sc), 'Cormorant SC', serif";
const serif = "var(--font-serif), 'EB Garamond', serif";

function Cartridge({
  value,
  latin,
  sub,
  align = "left",
  idx,
}: Cart & { align?: "left" | "right"; idx: number }) {
  return (
    <div
      className={[
        "status-cart glass-well px-3 py-1 flex items-center gap-2.5 min-w-[120px]",
        align === "right" ? "justify-end" : "justify-start",
      ].join(" ")}
      style={{
        borderRadius: 3,
        ["--cart-i" as string]: String(idx),
      }}
    >
      <span
        className="status-value text-brass-gradient font-serif font-semibold leading-none tabnum num-breath"
        style={{ fontSize: 17, fontFamily: serif }}
      >
        {value}
      </span>
      <div className="flex flex-col leading-none gap-0.5">
        <span
          className="font-sc tracking-[0.22em] text-manor-brassHi/85"
          style={{ fontFamily: sc, fontSize: 9 }}
        >
          {latin}
        </span>
        <span
          className="text-manor-inkDim"
          style={{ fontFamily: serif, fontSize: 9, letterSpacing: "0.05em" }}
        >
          {sub}
        </span>
      </div>
    </div>
  );
}

export function StatusBar() {
  const left: Cart[] = [
    { value: "154",     latin: "SUMMA",   sub: "总条目" },
    { value: "141/154", latin: "CENSITA", sub: "已评" },
    { value: "6",       latin: "WARDED",  sub: "加普" },
  ];
  const right: Cart[] = [
    { value: "$8,420", latin: "PRETIUM",  sub: "预算储备" },
    { value: "03:15",  latin: "ULT·SYNC", sub: "最近同步 UTC" },
  ];

  return (
    <footer
      className="fixed bottom-8 left-0 right-0 h-14 z-40 px-4 flex items-center gap-3 glass-panel-brass"
      style={{
        borderRadius: 0,
        borderLeft: 0,
        borderRight: 0,
        borderBottom: 0,
      }}
    >
      {/* Status label */}
      <div className="flex flex-col leading-none shrink-0 pr-2 gap-0.5">
        <span
          className="font-sc tracking-[0.32em] text-manor-brassHi"
          style={{ fontFamily: sc, fontSize: 10 }}
        >
          STATUS
        </span>
        <span
          className="text-manor-inkDim"
          style={{ fontFamily: serif, fontSize: 9, letterSpacing: "0.05em" }}
        >
          系统状态
        </span>
      </div>
      <span className="brass-divider-v h-9" />

      {/* Left cartridges */}
      <div className="flex items-center gap-1.5">
        {left.map((c, i) => <Cartridge key={c.latin} {...c} idx={i + 1} />)}
      </div>

      {/* Central glow medallion — emerald segment ring around a brass shield */}
      <div className="flex-1 flex justify-center">
        <div className="relative flex flex-col items-center gap-0.5">
          <span
            className="font-sc tracking-[0.34em] text-manor-brassHi leading-none whitespace-nowrap"
            style={{ fontFamily: sc, fontSize: 8 }}
          >
            ◆ AUDI · VIDE · TACE ◆
          </span>
          <div className="relative brass-aura" style={{ width: 62, height: 62 }}>
            <AnimatedMedallion size={62} />
            <span
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 font-sc tracking-[0.32em] text-manor-brassDim leading-none whitespace-nowrap"
              style={{ fontFamily: sc, fontSize: 8 }}
            >
              DIARIUM
            </span>
          </div>
        </div>
      </div>

      {/* Right cartridges */}
      <div className="flex items-center gap-1.5">
        {right.map((c, i) => <Cartridge key={c.latin} {...c} align="right" idx={left.length + i + 1} />)}
      </div>

      <span className="brass-divider-v h-9" />

      {/* Powered-by credit */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-col items-end leading-none gap-0.5">
          <span
            className="ital-italic text-manor-inkDim"
            style={{ fontFamily: serif, fontSize: 10 }}
          >
            powered by
          </span>
          <span
            className="font-sc text-manor-brassHi tracking-[0.22em]"
            style={{ fontFamily: sc, fontSize: 9 }}
          >
            TangXiaoYu
          </span>
        </div>
        <span className="brass-aura inline-flex items-center justify-center" style={{ width: 22, height: 22 }}>
          {/* Brand logo — alpha-cutout PNG, gold drops directly with no
              blend-mode trickery. */}
          <img
            src="/brand-logo.png"
            alt=""
            width={20}
            height={20}
            style={{
              display: "block",
              filter: "drop-shadow(0 0 4px rgba(239,216,154,0.45))",
            }}
          />
        </span>
      </div>
    </footer>
  );
}
