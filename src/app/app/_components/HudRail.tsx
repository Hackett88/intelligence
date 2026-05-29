"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Left-side CABINET rail — vertical column of independent brass-edged cards.
 * Each card holds (big number, 2-char Chinese label, green status dot).
 * Mount: staggered roll-up. Hover: brass bloom.
 * Live-tick: every ~5s one random card's number changes by ±1 → ripple pulse.
 */

// real: true 表示此卡承载真实数据 —— 不参与每 5.5s 的随机跳动，避免真实数被篡改。
type Readout = { value: number; cn: string; status: "live" | "warn"; real?: boolean };

// 功能板块数：无数据源，由 Sean 手动指定。要改板块数直接改这个常量即可。当前 4。
const FUNCTIONAL_MODULES = 4;

// 收录页之后的 7 张仍为占位 mock（"其它日后再改"）。前两张接真实数据：
//   模块 ← FUNCTIONAL_MODULES 常量（功能模块数，与总览页 OFFICIA·模块 同义）
//   收录 ← GSC 快照 stats.totalPages（与「收录与索引」页的「收录页数」同源）
function buildReadouts(indexedPages: number): Readout[] {
  return [
    { value: FUNCTIONAL_MODULES, cn: "模块", status: "live", real: true },
    { value: indexedPages,       cn: "收录", status: "live", real: true },
    { value: 13,  cn: "待审", status: "warn" },
    { value: 141, cn: "已评", status: "live" },
    { value: 6,   cn: "加普", status: "live" },
    { value: 28,  cn: "圣语", status: "live" },
    { value: 12,  cn: "在产", status: "warn" },
    { value: 38,  cn: "上榜", status: "live" },
    { value: 154, cn: "总计", status: "live" },
  ];
}

const sc = "var(--font-sc), 'Cormorant SC', serif";
const serif = "var(--font-serif), 'EB Garamond', serif";

function StatusDot({ kind }: { kind: "live" | "warn" }) {
  return (
    <span
      className={kind === "live" ? "brass-dot" : ""}
      style={{
        display: "inline-block",
        width: 5,
        height: 5,
        borderRadius: 9999,
        background:
          kind === "live"
            ? "radial-gradient(circle at 30% 30%, #BDE6B1, #5C8A6B 55%, #2A4233)"
            : "radial-gradient(circle at 30% 30%, #EFD89A, #D4B36F 55%, #5A4320)",
        boxShadow:
          kind === "live"
            ? "0 0 6px rgba(123,166,125,.7)"
            : "0 0 6px rgba(224,197,122,.55)",
      }}
    />
  );
}

function usePulseOnChange(value: number): boolean {
  const [pulsing, setPulsing] = useState(false);
  const prevRef = useRef(value);
  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setPulsing(true);
      const t = window.setTimeout(() => setPulsing(false), 800);
      return () => window.clearTimeout(t);
    }
  }, [value]);
  return pulsing;
}

function HudCard({
  value,
  cn,
  status,
  index,
}: Readout & { index: number }) {
  const isPulsing = usePulseOnChange(value);
  return (
    <div
      className={[
        // flex-1 撑满 aside（9 cards 平分），保留紧凑视觉与所有动画基线。
        // min-h-[34px] 下限 —— flex 收缩时停在内容自然高度（32px），不被压扁；
        //                       总和超过 aside 时由 aside.overflow-y-auto 自滚。
        // 不加 overflow-hidden：会裁掉 ::after pulse ring（外扩 12px）与 :hover scale(1.03) 边缘动效。
        // 防溢出靠 min-h 单一手段足矣 —— card 高度始终 ≥ 内容需求。
        "hud-card glass-panel relative flex flex-col items-center justify-center py-1 flex-1 min-h-[34px]",
        isPulsing ? "is-pulsing" : "",
      ].join(" ")}
      style={{
        borderRadius: 3,
        ["--hud-i" as string]: String(index + 1),
      }}
    >
      <span
        className="hud-num text-brass-gradient font-serif font-semibold leading-none tabnum num-breath"
        style={{ fontFamily: serif, fontSize: 16 }}
      >
        {value}
      </span>
      <div className="flex items-center gap-1 mt-1 leading-none">
        <StatusDot kind={status} />
        <span
          className="text-manor-ink/85 whitespace-nowrap"
          style={{ fontFamily: serif, fontSize: 9.5, letterSpacing: "0.06em" }}
        >
          {cn}
        </span>
      </div>
    </div>
  );
}

export function HudRail({ indexedPages }: { indexedPages: number }) {
  const [readouts, setReadouts] = useState<Readout[]>(() => buildReadouts(indexedPages));

  // 真实「收录」卡随快照变化而更新（mock 卡的本地跳动状态不受影响）。
  useEffect(() => {
    setReadouts((prev) =>
      prev.map((r) => (r.cn === "收录" ? { ...r, value: indexedPages } : r)),
    );
  }, [indexedPages]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    const tick = window.setInterval(() => {
      setReadouts((prev) => {
        // 只在 mock 卡里随机挑一张跳动 —— 真实卡（real）保持稳定。
        const mutable = prev.flatMap((r, idx) => (r.real ? [] : [idx]));
        if (mutable.length === 0) return prev;
        const i = mutable[Math.floor(Math.random() * mutable.length)];
        const delta = Math.random() > 0.5 ? 1 : -1;
        return prev.map((r, idx) =>
          idx === i ? { ...r, value: Math.max(0, r.value + delta) } : r,
        );
      });
    }, 5500);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    (window as unknown as { __pulseHud?: (i: number, delta?: number) => void }).__pulseHud = (
      i: number,
      delta = 1,
    ) => {
      setReadouts((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, value: r.value + delta } : r)),
      );
    };
    return () => {
      delete (window as unknown as { __pulseHud?: unknown }).__pulseHud;
    };
  }, []);

  return (
    <aside
      className="fixed left-0 top-14 bottom-[88px] w-[78px] z-30 flex flex-col items-stretch px-1.5 pt-2 pb-2 gap-1 overflow-y-auto no-scrollbar"
    >
      {/* Header pill — 机柜概览 */}
      <div
        className="hud-header glass-panel-brass relative flex flex-col items-center justify-center py-1"
        style={{ borderRadius: 4 }}
      >
        <div className="flex items-center gap-1.5 leading-none">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <polygon
              points="5,1 9,3 9,7 5,9 1,7 1,3"
              fill="none"
              stroke="#EFD89A"
              strokeWidth="0.7"
            />
            <polygon
              points="5,1 9,3 5,5 1,3"
              fill="rgba(224,197,122,.35)"
              stroke="none"
            />
          </svg>
          <span
            className="font-sc text-manor-brassHi tracking-[0.22em]"
            style={{ fontFamily: sc, fontSize: 8 }}
          >
            CABINET
          </span>
        </div>
        <span
          className="font-sc text-manor-brassDim tracking-[0.32em] mt-0.5 leading-none"
          style={{ fontFamily: sc, fontSize: 7 }}
        >
          机柜概览
        </span>
      </div>

      {/* 9 independent number cards — staggered mount + live ripple */}
      {readouts.map((r, i) => (
        <HudCard
          key={i}
          index={i}
          value={r.value}
          cn={r.cn}
          status={r.status}
        />
      ))}
    </aside>
  );
}
