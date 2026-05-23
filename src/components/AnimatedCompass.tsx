"use client";

import { useEffect, useState } from "react";

type Props = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Static needle bearing in degrees (clockwise from north). Lets two
   *  compasses on the same page point in different rest directions so
   *  they don't look like duplicates. Default 0 (points north). */
  bearing?: number;
};

/**
 * Animated compass medallion — same geometry as the static #orn-compass
 * symbol in ManorOrnaments, but rendered inline so the needle pair can spin.
 * Plays a single "compass calibrating" sweep on mount, then re-triggers
 * every 15 s. Pivot dot stays still; outer rim and graticule stay still.
 * Key change on the needle <g> re-mounts the element to replay the CSS
 * animation reliably.
 *
 * Two-layer transform on the needle:
 *   • outer <g> applies a static SVG rotate(bearing 20 20) — sets the rest
 *     direction without participating in the animation;
 *   • inner <g.compass-needle> runs the 0 → 720° spin via CSS, so it always
 *     lands back on its starting orientation (which is the outer bearing).
 */
export function AnimatedCompass({ size = 40, className, style, bearing = 0 }: Props) {
  const [spinKey, setSpinKey] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSpinKey((k) => k + 1);
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <g fill="none" stroke="#D4B36F">
        <circle cx="20" cy="20" r="18" strokeOpacity="0.3" strokeWidth="0.6" />
        <circle
          cx="20"
          cy="20"
          r="14"
          strokeOpacity="0.5"
          strokeWidth="0.5"
          strokeDasharray="1 2"
        />
        <g strokeOpacity="0.7">
          <line x1="20" y1="3" x2="20" y2="37" />
          <line x1="3" y1="20" x2="37" y2="20" />
          <line x1="8" y1="8" x2="32" y2="32" strokeOpacity="0.35" />
          <line x1="32" y1="8" x2="8" y2="32" strokeOpacity="0.35" />
        </g>
        <g transform={`rotate(${bearing} 20 20)`}>
          <g key={spinKey} className="compass-needle">
            <polygon
              points="20,3 22.5,20 20,18 17.5,20"
              fill="#D4B36F"
              stroke="none"
            />
            <polygon
              points="20,37 22.5,20 20,22 17.5,20"
              fill="#A08850"
              stroke="none"
            />
          </g>
        </g>
        <circle cx="20" cy="20" r="1.5" fill="#D4B36F" stroke="none" />
      </g>
    </svg>
  );
}
