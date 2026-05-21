/**
 * Manor Hall ornaments — opera-house HUD edition.
 * One <ManorOrnaments/> in the root layout registers every <symbol/>,
 * any component can <use href="#orn-*"/> them.
 *
 * Naming:
 *   filigree / fleur / wax / flourish / compass — original manor set
 *   baroque-corner / hex-badge / medallion / hud-cap — new opera HUD set
 *   skill-* — circular skill medallions for SkillCard
 */
export function ManorOrnaments() {
  return (
    <svg
      width="0"
      height="0"
      className="absolute"
      style={{ position: "absolute" }}
      aria-hidden="true"
    >
      <defs>
        {/* Reusable brass gradients */}
        <linearGradient id="g-brass" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F0DEA0" />
          <stop offset="40%" stopColor="#D4B36F" />
          <stop offset="100%" stopColor="#7A5E2E" />
        </linearGradient>
        <linearGradient id="g-brass-h" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7A5E2E" />
          <stop offset="50%" stopColor="#EFD89A" />
          <stop offset="100%" stopColor="#7A5E2E" />
        </linearGradient>
        <radialGradient id="g-medallion" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#1F3328" />
          <stop offset="60%" stopColor="#0C1A12" />
          <stop offset="100%" stopColor="#030806" />
        </radialGradient>
        <radialGradient id="g-brass-radial" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#F0DEA0" />
          <stop offset="55%" stopColor="#D4B36F" />
          <stop offset="100%" stopColor="#5A4320" />
        </radialGradient>

        {/* Filigree corner bracket — original light variant */}
        <symbol id="orn-filigree" viewBox="0 0 24 24">
          <g fill="none" stroke="#D4B36F" strokeWidth="0.8" strokeLinecap="round">
            <path d="M2 14 L2 2 L14 2" />
            <path d="M2 8 Q 4 8, 5 6 T 8 2" strokeOpacity="0.7" />
            <path d="M8 5 Q 8 6.5, 10 6.5" strokeOpacity="0.5" />
            <circle cx="2" cy="2" r="0.9" fill="#D4B36F" stroke="none" />
            <circle cx="6" cy="6" r="0.5" fill="#D4B36F" stroke="none" />
          </g>
        </symbol>

        {/* Baroque corner — denser, sharper for hero panels */}
        <symbol id="orn-baroque-corner" viewBox="0 0 40 40">
          <g fill="none" stroke="url(#g-brass)" strokeWidth="1.1" strokeLinecap="round">
            <path d="M2 22 L2 2 L22 2" strokeWidth="1.4" />
            <path d="M2 12 Q 6 12, 8 9 T 12 2" strokeOpacity="0.85" />
            <path d="M12 6 Q 12 8.5, 16 8.5 Q 18 8.5, 18 6" strokeOpacity="0.7" />
            <path d="M6 14 Q 4 18, 8 22 Q 12 22, 12 18" strokeOpacity="0.55" />
            <circle cx="2" cy="2" r="1.4" fill="url(#g-brass-radial)" stroke="none" />
            <circle cx="8" cy="8" r="0.9" fill="#EFD89A" stroke="none" />
            <circle cx="14" cy="4" r="0.55" fill="#D4B36F" stroke="none" />
            <circle cx="4" cy="14" r="0.55" fill="#D4B36F" stroke="none" />
            {/* leaf curl */}
            <path d="M18 10 Q 22 10, 22 6 Q 22 4, 20 4" strokeOpacity="0.4" />
            <path d="M10 18 Q 10 22, 6 22 Q 4 22, 4 20" strokeOpacity="0.4" />
          </g>
        </symbol>

        {/* Fleur-de-lis */}
        <symbol id="orn-fleur" viewBox="0 0 16 16">
          <g fill="#D4B36F">
            <path d="M8 1 C 7 3, 6 4, 5 5 C 6 4.5, 7 4.5, 8 5 C 9 4.5, 10 4.5, 11 5 C 10 4, 9 3, 8 1 Z" />
            <path d="M8 5 L 8 12" stroke="#D4B36F" strokeWidth="0.6" />
            <ellipse cx="8" cy="6.5" rx="2.6" ry="0.5" fill="#D4B36F" />
            <path
              d="M5 7 C 4 9, 4 11, 6 12 C 6 10, 7 9, 8 9 C 9 9, 10 10, 10 12 C 12 11, 12 9, 11 7"
              fill="none"
              stroke="#D4B36F"
              strokeWidth="0.6"
            />
            <path d="M7 14 L 9 14" stroke="#D4B36F" strokeWidth="0.8" />
          </g>
        </symbol>

        {/* Wax seal — circle with monogram W */}
        <symbol id="orn-wax" viewBox="0 0 24 24">
          <defs>
            <radialGradient id="wax-grad" cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#B85040" />
              <stop offset="55%" stopColor="#C46B5A" />
              <stop offset="100%" stopColor="#7A4239" />
            </radialGradient>
          </defs>
          <circle cx="12" cy="12" r="11" fill="url(#wax-grad)" />
          <circle cx="12" cy="12" r="11" fill="none" stroke="#7A4239" strokeWidth="0.4" />
          <g fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4">
            <circle cx="12" cy="12" r="9.5" />
          </g>
          <text
            x="12"
            y="15.6"
            textAnchor="middle"
            fontFamily="Cormorant SC, serif"
            fontWeight="700"
            fontSize="9"
            fill="#E8E2D5"
            fillOpacity="0.92"
            letterSpacing="0.5"
          >
            W
          </text>
          <ellipse cx="8" cy="8" rx="3.2" ry="1.8" fill="rgba(255,255,255,0.18)" />
        </symbol>

        {/* Decorative flourish underline */}
        <symbol id="orn-flourish" viewBox="0 0 80 8">
          <g fill="none" stroke="#D4B36F" strokeWidth="0.6">
            <path d="M2 4 Q 10 1, 20 4 T 40 4 T 60 4 T 78 4" />
            <circle cx="40" cy="4" r="1.2" fill="#D4B36F" stroke="none" />
          </g>
        </symbol>

        {/* Compass rose ornate */}
        <symbol id="orn-compass" viewBox="0 0 40 40">
          <g fill="none" stroke="#D4B36F">
            <circle cx="20" cy="20" r="18" strokeOpacity="0.3" strokeWidth="0.6" />
            <circle cx="20" cy="20" r="14" strokeOpacity="0.5" strokeWidth="0.5" strokeDasharray="1 2" />
            <g strokeOpacity="0.7">
              <line x1="20" y1="3" x2="20" y2="37" />
              <line x1="3" y1="20" x2="37" y2="20" />
              <line x1="8" y1="8" x2="32" y2="32" strokeOpacity="0.35" />
              <line x1="32" y1="8" x2="8" y2="32" strokeOpacity="0.35" />
            </g>
            <polygon points="20,3 22.5,20 20,18 17.5,20" fill="#D4B36F" stroke="none" />
            <polygon points="20,37 22.5,20 20,22 17.5,20" fill="#A08850" stroke="none" />
            <circle cx="20" cy="20" r="1.5" fill="#D4B36F" stroke="none" />
          </g>
        </symbol>

        {/* Central monogram medallion — big hex shield with W */}
        <symbol id="orn-monogram" viewBox="0 0 60 60">
          <polygon
            points="30,2 56,16 56,44 30,58 4,44 4,16"
            fill="url(#g-medallion)"
            stroke="url(#g-brass)"
            strokeWidth="1.4"
          />
          <polygon
            points="30,6 52,18 52,42 30,54 8,42 8,18"
            fill="none"
            stroke="#D4B36F"
            strokeOpacity="0.45"
            strokeWidth="0.6"
          />
          <text
            x="30" y="38"
            textAnchor="middle"
            fontFamily="EB Garamond, Cormorant SC, serif"
            fontWeight="700"
            fontSize="26"
            fill="url(#g-brass)"
          >
            W
          </text>
          {/* tiny stars */}
          <circle cx="30" cy="14" r="0.9" fill="#D4B36F" />
          <circle cx="30" cy="48" r="0.9" fill="#D4B36F" />
        </symbol>

        {/* Eight-pointed star — Islamic Rub-el-hizb-like brand crest */}
        <symbol id="orn-octogram" viewBox="0 0 40 40">
          <g transform="translate(20 20)">
            {/* outer brass ring */}
            <circle r="18" fill="none" stroke="url(#g-brass)" strokeWidth="0.9" strokeOpacity="0.55" />
            {/* two interlocking squares — classic 8-point star */}
            <rect x="-13" y="-13" width="26" height="26" fill="none" stroke="url(#g-brass)" strokeWidth="1.1" transform="rotate(0)" />
            <rect x="-13" y="-13" width="26" height="26" fill="none" stroke="url(#g-brass)" strokeWidth="1.1" transform="rotate(45)" />
            {/* center dot */}
            <circle r="2.2" fill="url(#g-brass-radial)" />
            {/* point dots */}
            <g fill="#EFD89A">
              <circle cx="0" cy="-18" r="0.9" />
              <circle cx="0" cy="18" r="0.9" />
              <circle cx="-18" cy="0" r="0.9" />
              <circle cx="18" cy="0" r="0.9" />
              <circle cx="12.7" cy="-12.7" r="0.7" />
              <circle cx="12.7" cy="12.7" r="0.7" />
              <circle cx="-12.7" cy="-12.7" r="0.7" />
              <circle cx="-12.7" cy="12.7" r="0.7" />
            </g>
          </g>
        </symbol>

        {/* Zikr ring — round-top signet ring viewed 3/4. Brass band + emerald
            stone face engraved with a Q-letter, matches reference image hero. */}
        <symbol id="orn-zikr-ring" viewBox="0 0 80 80">
          <defs>
            <radialGradient id="zikr-stone" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#1F3B28" />
              <stop offset="55%" stopColor="#0A1A12" />
              <stop offset="100%" stopColor="#040A07" />
            </radialGradient>
            <linearGradient id="zikr-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F0DEA0" />
              <stop offset="45%" stopColor="#D4B36F" />
              <stop offset="100%" stopColor="#5A4320" />
            </linearGradient>
          </defs>
          {/* lower band (back of ring) */}
          <ellipse cx="40" cy="58" rx="22" ry="9" fill="none" stroke="url(#zikr-band)" strokeWidth="3" strokeOpacity="0.55" />
          {/* signet head */}
          <g transform="translate(40 32)">
            {/* outer brass bezel */}
            <ellipse cx="0" cy="0" rx="22" ry="18" fill="url(#zikr-band)" />
            <ellipse cx="0" cy="0" rx="19" ry="15" fill="url(#zikr-stone)" />
            {/* emerald specular highlight */}
            <ellipse cx="-6" cy="-7" rx="8" ry="4" fill="rgba(255,255,255,0.18)" />
            {/* engraved Q glyph */}
            <text
              x="0" y="5"
              textAnchor="middle"
              fontFamily="EB Garamond, Cormorant SC, serif"
              fontWeight="700"
              fontSize="16"
              fill="url(#g-brass)"
              fillOpacity="0.85"
            >
              ⵉ
            </text>
            {/* tiny rivets on the bezel */}
            <circle cx="-19" cy="0" r="1.1" fill="#EFD89A" />
            <circle cx="19" cy="0" r="1.1" fill="#EFD89A" />
            <circle cx="0" cy="-15" r="0.9" fill="#EFD89A" />
            <circle cx="0" cy="15" r="0.9" fill="#EFD89A" />
          </g>
          {/* front band */}
          <path
            d="M18 55 Q40 75 62 55"
            fill="none"
            stroke="url(#zikr-band)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </symbol>

        {/* Status-bar centerpiece — outer ring of emerald-glow segments
            wrapping a hex shield. Used in StatusBar. */}
        <symbol id="orn-medallion-glow" viewBox="0 0 80 80">
          <g transform="translate(40 40)">
            {/* 12 emerald segments around the rim */}
            <g>
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i * 30 - 90) * Math.PI / 180;
                const x1 = Math.cos(a) * 30;
                const y1 = Math.sin(a) * 30;
                const x2 = Math.cos(a) * 36;
                const y2 = Math.sin(a) * 36;
                return (
                  <line
                    key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="#7BA67D"
                    strokeWidth="2.4"
                    strokeOpacity={0.55 + (i % 3) * 0.15}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
            {/* outer brass ring */}
            <circle r="28" fill="none" stroke="url(#g-brass)" strokeWidth="1.2" />
            <circle r="26" fill="url(#g-medallion)" stroke="#D4B36F" strokeOpacity="0.45" strokeWidth="0.6" />
            {/* inner hex shield */}
            <polygon
              points="0,-12 10.4,-6 10.4,6 0,12 -10.4,6 -10.4,-6"
              fill="url(#g-medallion)"
              stroke="url(#g-brass)"
              strokeWidth="1.1"
            />
            {/* tiny brass cube glyph centered */}
            <g transform="translate(0 0)">
              <polygon points="0,-5 5,-2.5 5,2.5 0,5 -5,2.5 -5,-2.5" fill="none" stroke="#EFD89A" strokeWidth="0.8" />
              <polygon points="0,-5 5,-2.5 0,0 -5,-2.5" fill="rgba(224,197,122,.4)" />
            </g>
          </g>
        </symbol>

        {/* HUD cap — top/bottom finial for vertical tubes */}
        <symbol id="orn-hud-cap" viewBox="0 0 30 12">
          <rect x="1" y="2" width="28" height="3" fill="url(#g-brass-h)" />
          <rect x="3" y="5" width="24" height="2" fill="#5A4320" />
          <rect x="2" y="7" width="26" height="2" fill="url(#g-brass-h)" />
          <circle cx="6" cy="3.5" r="0.8" fill="#1B2E20" />
          <circle cx="24" cy="3.5" r="0.8" fill="#1B2E20" />
        </symbol>

        {/* Skill medallions — 6 distinct themed badges for SkillCard */}
        {/* bar-chart bars (W01 census) */}
        <symbol id="skill-bars" viewBox="0 0 40 40">
          <rect x="8" y="22" width="4" height="12" fill="url(#g-brass)" rx="0.5"/>
          <rect x="15" y="14" width="4" height="20" fill="url(#g-brass)" rx="0.5"/>
          <rect x="22" y="8" width="4" height="26" fill="url(#g-brass)" rx="0.5"/>
          <rect x="29" y="18" width="4" height="16" fill="url(#g-brass)" rx="0.5"/>
        </symbol>
        {/* question mark */}
        <symbol id="skill-question" viewBox="0 0 40 40">
          <text x="20" y="29" textAnchor="middle" fontFamily="EB Garamond, serif" fontWeight="600" fontSize="26" fill="url(#g-brass)">?</text>
        </symbol>
        {/* globe / map */}
        <symbol id="skill-globe" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="13" fill="none" stroke="url(#g-brass)" strokeWidth="1.2"/>
          <ellipse cx="20" cy="20" rx="13" ry="6" fill="none" stroke="url(#g-brass)" strokeWidth="0.8"/>
          <ellipse cx="20" cy="20" rx="6" ry="13" fill="none" stroke="url(#g-brass)" strokeWidth="0.8"/>
          <line x1="7" y1="20" x2="33" y2="20" stroke="url(#g-brass)" strokeWidth="0.6"/>
        </symbol>
        {/* metric ring */}
        <symbol id="skill-metric" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="12" fill="none" stroke="url(#g-brass)" strokeWidth="1.5"/>
          <path d="M20 8 A 12 12 0 0 1 32 20" fill="none" stroke="#EFD89A" strokeWidth="2.5"/>
          <circle cx="20" cy="20" r="3" fill="url(#g-brass)"/>
        </symbol>
        {/* domain compare (two overlapping rings) */}
        <symbol id="skill-compare" viewBox="0 0 40 40">
          <circle cx="15" cy="20" r="9" fill="none" stroke="url(#g-brass)" strokeWidth="1.2"/>
          <circle cx="25" cy="20" r="9" fill="none" stroke="url(#g-brass)" strokeWidth="1.2"/>
        </symbol>
        {/* magnifier */}
        <symbol id="skill-search" viewBox="0 0 40 40">
          <circle cx="17" cy="17" r="9" fill="none" stroke="url(#g-brass)" strokeWidth="1.6"/>
          <line x1="24" y1="24" x2="32" y2="32" stroke="url(#g-brass)" strokeWidth="2" strokeLinecap="round"/>
        </symbol>
        {/* sitemap / hierarchy */}
        <symbol id="skill-tree" viewBox="0 0 40 40">
          <circle cx="20" cy="8" r="3" fill="url(#g-brass)"/>
          <circle cx="10" cy="28" r="3" fill="url(#g-brass)"/>
          <circle cx="20" cy="28" r="3" fill="url(#g-brass)"/>
          <circle cx="30" cy="28" r="3" fill="url(#g-brass)"/>
          <line x1="20" y1="11" x2="10" y2="25" stroke="url(#g-brass)" strokeWidth="1"/>
          <line x1="20" y1="11" x2="20" y2="25" stroke="url(#g-brass)" strokeWidth="1"/>
          <line x1="20" y1="11" x2="30" y2="25" stroke="url(#g-brass)" strokeWidth="1"/>
        </symbol>
        {/* megaphone / ad */}
        <symbol id="skill-ad" viewBox="0 0 40 40">
          <path d="M8 16 L8 24 L18 24 L28 32 L28 8 L18 16 Z" fill="url(#g-brass)"/>
          <path d="M30 14 Q 34 20 30 26" fill="none" stroke="url(#g-brass)" strokeWidth="1.2"/>
        </symbol>
        {/* clock / history */}
        <symbol id="skill-clock" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="12" fill="none" stroke="url(#g-brass)" strokeWidth="1.5"/>
          <line x1="20" y1="20" x2="20" y2="11" stroke="url(#g-brass)" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="20" y1="20" x2="27" y2="22" stroke="url(#g-brass)" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="20" cy="20" r="1.5" fill="url(#g-brass)"/>
        </symbol>
      </defs>
    </svg>
  );
}

/** Four baroque corner ornaments for hero panels */
export function BaroqueCorners({ size = 30 }: { size?: number }) {
  const s = `${size}px`;
  return (
    <>
      <svg className="absolute pointer-events-none" style={{ top: 6, left: 6, width: s, height: s }}>
        <use href="#orn-baroque-corner" />
      </svg>
      <svg className="absolute pointer-events-none" style={{ top: 6, right: 6, width: s, height: s, transform: "scaleX(-1)" }}>
        <use href="#orn-baroque-corner" />
      </svg>
      <svg className="absolute pointer-events-none" style={{ bottom: 6, left: 6, width: s, height: s, transform: "scaleY(-1)" }}>
        <use href="#orn-baroque-corner" />
      </svg>
      <svg className="absolute pointer-events-none" style={{ bottom: 6, right: 6, width: s, height: s, transform: "scale(-1,-1)" }}>
        <use href="#orn-baroque-corner" />
      </svg>
    </>
  );
}

/** Lighter four filigree corners (smaller, less aggressive) */
export function FiligreeCorners({ size = 18 }: { size?: number }) {
  const s = `${size}px`;
  return (
    <>
      <svg className="filigree-corner" style={{ top: 4, left: 4, width: s, height: s }}>
        <use href="#orn-filigree" />
      </svg>
      <svg className="filigree-corner" style={{ top: 4, right: 4, width: s, height: s, transform: "scaleX(-1)" }}>
        <use href="#orn-filigree" />
      </svg>
      <svg className="filigree-corner" style={{ bottom: 4, left: 4, width: s, height: s, transform: "scaleY(-1)" }}>
        <use href="#orn-filigree" />
      </svg>
      <svg className="filigree-corner" style={{ bottom: 4, right: 4, width: s, height: s, transform: "scale(-1,-1)" }}>
        <use href="#orn-filigree" />
      </svg>
    </>
  );
}

export function WaxSeal({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size}><use href="#orn-wax" /></svg>;
}
export function Flourish({ width = 80, height = 8 }: { width?: number; height?: number }) {
  return <svg width={width} height={height} aria-hidden="true"><use href="#orn-flourish" /></svg>;
}
export function Fleur({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#orn-fleur" /></svg>;
}
export function Compass({ size = 40 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#orn-compass" /></svg>;
}
export function Monogram({ size = 60 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#orn-monogram" /></svg>;
}
export function HudCap({ width = 30, height = 12 }: { width?: number; height?: number }) {
  return <svg width={width} height={height} aria-hidden="true"><use href="#orn-hud-cap" /></svg>;
}

/** Animated emerald-segment medallion — the centerpiece of StatusBar.
 * Same structure as the static #orn-medallion-glow symbol, but rendered
 * inline so the outer 12-segment ring can rotate as a group and each
 * segment can pulse its own brightness on an offset cycle, chasing
 * light around the rim. The hex shield and center cube stay still. */
export function AnimatedMedallion({ size = 62 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      aria-hidden="true"
      overflow="visible"
      style={{
        overflow: "visible",
        filter:
          "drop-shadow(0 0 18px rgba(80,220,120,.85)) drop-shadow(0 0 8px rgba(160,255,180,.6)) drop-shadow(0 0 4px rgba(239,216,154,.3)) drop-shadow(0 2px 4px rgba(0,0,0,.8))",
      }}
    >
      <g transform="translate(40 40)">
        {/* Soft emerald halo that breathes — sits behind everything */}
        <circle
          className="medallion-halo"
          r="32"
          fill="rgba(110, 230, 140, 0.32)"
        />

        {/* 12 emerald segments — rotates as a group, each segment pulses */}
        <g className="medallion-segments">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            const x1 = Math.cos(a) * 30;
            const y1 = Math.sin(a) * 30;
            const x2 = Math.cos(a) * 36;
            const y2 = Math.sin(a) * 36;
            return (
              <line
                key={i}
                className="medallion-seg"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#7BA67D"
                strokeWidth="2.4"
                strokeLinecap="round"
                style={{ ["--seg-i" as string]: String(i) }}
              />
            );
          })}
        </g>

        {/* Static brass ring + recessed well */}
        <circle r="28" fill="none" stroke="url(#g-brass)" strokeWidth="1.2" />
        <circle
          r="26"
          fill="url(#g-medallion)"
          stroke="#D4B36F"
          strokeOpacity="0.45"
          strokeWidth="0.6"
        />

        {/* Brand logo at the center — wrapped in a "gold-core" group that
            flashes with a pulsing gold drop-shadow. The PNG is an alpha
            cutout so the gold mark drops onto the emerald well naturally. */}
        <g className="medallion-gold-core">
          <foreignObject x={-13} y={-13} width={26} height={26} style={{ overflow: "visible" }}>
            <img
              {...({ xmlns: "http://www.w3.org/1999/xhtml" } as any)}
              src="/brand-logo.png"
              alt=""
              width={26}
              height={26}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
              }}
            />
          </foreignObject>
        </g>
      </g>
    </svg>
  );
}

/** Themed circular medallion for SkillCard — heavy brass-rim, recessed center.
 * Three-layer build:
 *   1. Outer brass collar (gradient + bevel)
 *   2. Recessed emerald well (inset shadow)
 *   3. Brass icon with glow
 * The slow conic-spin halo from .medallion-ring fires automatically.
 */
export function SkillMedallion({
  symbol,
  size = 64,
}: {
  symbol:
    | "bars" | "question" | "globe" | "metric"
    | "compare" | "search" | "tree" | "ad" | "clock";
  size?: number;
}) {
  const collar = Math.round(size * 0.13); // brass collar thickness
  const wellSize = size - collar * 2;
  return (
    <div
      className="medallion-ring relative flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        // Heavy brass collar via conic gradient + bevel rings
        background:
          "conic-gradient(from 215deg, #5A4320 0deg, #EFD89A 90deg, #D4B36F 180deg, #A08850 270deg, #5A4320 360deg)",
        boxShadow:
          "inset 0 1px 0 rgba(255,240,190,.55), 0 0 0 1px rgba(0,0,0,.55), 0 6px 14px -4px rgba(0,0,0,.75), 0 0 18px -2px rgba(224,197,122,.45)",
      }}
    >
      {/* Recessed emerald well */}
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: wellSize,
          height: wellSize,
          background:
            "radial-gradient(circle at 35% 30%, rgba(40,80,55,.95) 0%, rgba(14,30,21,.98) 60%, rgba(4,12,9,1) 100%)",
          boxShadow:
            "inset 0 2px 4px rgba(0,0,0,.85), inset 0 -1px 2px rgba(224,197,122,.18), inset 0 0 14px rgba(0,0,0,.55)",
          border: "1px solid rgba(201,169,97,.45)",
        }}
      >
        {/* Icon with brass glow */}
        <svg
          width={Math.round(wellSize * 0.62)}
          height={Math.round(wellSize * 0.62)}
          aria-hidden="true"
          style={{
            filter:
              "drop-shadow(0 0 6px rgba(224,197,122,.55)) drop-shadow(0 1px 0 rgba(0,0,0,.6))",
          }}
        >
          <use href={`#skill-${symbol}`} />
        </svg>
        {/* Top specular highlight on the glass */}
        <span
          className="absolute pointer-events-none"
          style={{
            top: "8%",
            left: "18%",
            right: "18%",
            height: "30%",
            borderRadius: "9999px",
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,.18), transparent 70%)",
          }}
        />
      </div>
    </div>
  );
}

/** Hex stat badge — SVG-drawn so the hex shape is rock-solid across renders.
 * `tone` picks the value colour:
 *   "ink"   — bright cream (default, for primary counts)
 *   "brass" — gold (secondary)
 *   "ember" — red (alarm / vectis)
 */
export function HexBadge({
  value,
  label,
  sub,
  width = 96,
  height = 88,
  tone = "ink",
  index = 0,
  valueSize,
  labelSize,
  labelTrack,
  subSize,
}: {
  value: string | number;
  label: string;
  /** Optional second-line label (small Chinese under the Latin). */
  sub?: string;
  width?: number;
  height?: number;
  tone?: "ink" | "brass" | "ember";
  /** Stagger index for mount animation when rendered in a trio (0-based). */
  index?: number;
  /** Override the auto-computed value/label/sub font sizes. Useful for
   *  compact hero-row badges where the default height-derived sizes are
   *  too large or the label tracking pushes text outside the hex shape. */
  valueSize?: number;
  labelSize?: number;
  labelTrack?: string;
  subSize?: number;
}) {
  // Hex corners (pointy-top), normalised to width=100, height=92
  const w = 100, h = 92;
  const pts = `50,2 96,25 96,67 50,90 4,67 4,25`;
  const valueColorCls =
    tone === "ember"
      ? "text-manor-oxbloodHi"
      : tone === "brass"
        ? "text-brass-gradient"
        : "text-manor-ink";
  const valueShadow =
    tone === "ember"
      ? "0 0 12px rgba(216,136,118,.55)"
      : tone === "brass"
        ? "0 0 12px rgba(224,197,122,.45)"
        : "0 0 10px rgba(232,226,213,.35)";
  return (
    <div
      className="hex-badge-anim relative inline-flex items-center justify-center select-none brass-aura"
      style={{
        width,
        height,
        ["--badge-i" as string]: String(index),
      }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={width}
        height={height}
        className="absolute inset-0"
        aria-hidden="true"
      >
        <polygon points={pts} fill="url(#g-medallion)" />
        <polygon
          points={pts}
          fill="none"
          stroke="url(#g-brass)"
          strokeWidth="1.6"
        />
        <polygon
          points="50,7 91,28 91,64 50,85 9,64 9,28"
          fill="none"
          stroke="#D4B36F"
          strokeOpacity="0.35"
          strokeWidth="0.6"
        />
        <path
          d="M50 4 L 92 26"
          stroke="#F0DEA0"
          strokeOpacity="0.7"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M50 4 L 8 26"
          stroke="#F0DEA0"
          strokeOpacity="0.5"
          strokeWidth="0.8"
          fill="none"
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center leading-none">
        <span
          className={`hex-badge-value ${valueColorCls} font-serif font-semibold tabnum num-breath`}
          style={{
            fontSize: valueSize ?? Math.round(height * 0.4),
            fontFamily: "var(--font-serif), 'EB Garamond', serif",
            textShadow: valueShadow,
          }}
        >
          {value}
        </span>
        {label && (
          <span
            className="mt-1 font-sc text-manor-brassHi/85"
            style={{
              fontSize: labelSize ?? Math.max(8, Math.round(height * 0.09)),
              letterSpacing: labelTrack ?? "0.22em",
              fontFamily: "var(--font-sc), 'Cormorant SC', serif",
            }}
          >
            {label}
          </span>
        )}
        {sub && (
          <span
            className="mt-0.5 text-manor-inkDim"
            style={{
              fontSize: subSize ?? Math.max(7.5, Math.round(height * 0.075)),
              fontFamily: "var(--font-serif), 'EB Garamond', serif",
              letterSpacing: "0.05em",
            }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
