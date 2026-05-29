"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; latin: string; href: string; groupEnd?: boolean };

const navItems: NavItem[] = [
  { label: "总览", latin: "CONSPECTUS", href: "/app", groupEnd: true },
  { label: "关键词功能库", latin: "INSTRUMENTA", href: "/app/keywords/fetch" },
  { label: "关键词库", latin: "THESAURUS", href: "/app/keywords" },
  { label: "主题与页面规划", latin: "PLEXUS · PAGINAE", href: "/app/strategy", groupEnd: true },
  { label: "内容工坊", latin: "OFFICINA", href: "/app/content" },
  { label: "发布与审核", latin: "PROMULGATIO", href: "/app/publish", groupEnd: true },
  { label: "收录与索引", latin: "INDEX", href: "/app/indexing" },
  { label: "表现与迭代", latin: "FRUCTUS", href: "/app/analytics", groupEnd: true },
  { label: "自动化中心", latin: "AUTOMATIA", href: "/app/automation" },
  { label: "数据与接入", latin: "PORTUS", href: "/app/datasource" },
];

export function TopNav() {
  const pathname = usePathname();
  const activeHref = navItems
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
      {navItems.map((item, idx) => {
        const isActive = activeHref === item.href;
        const isLast = idx === navItems.length - 1;
        return (
          <div key={item.href} className="flex items-center">
            <Link
              href={item.href}
              data-active={isActive ? "true" : "false"}
              className={[
                "nav-link relative whitespace-nowrap flex flex-col items-center leading-tight transition-colors group",
                "px-2.5 py-1",
                isActive ? "" : "hover:text-manor-ink",
              ].join(" ")}
              style={
                isActive
                  ? {
                      background:
                        "radial-gradient(120% 100% at 50% 50%, rgba(40,80,55,.6) 0%, rgba(18,42,28,.4) 60%, transparent 100%)",
                      borderRadius: 9999,
                    }
                  : undefined
              }
            >
              {isActive && <span aria-hidden="true" className="nav-pill-pulse" />}

              {/* Active brass-dot marker — sits above the label like a sentinel */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="nav-sentinel absolute -top-[2px] left-1/2"
                  style={{
                    width: 4,
                    height: 4,
                    transform: "translateX(-50%) rotate(45deg)",
                    background:
                      "linear-gradient(135deg, #F8E6B0 0%, #D4B36F 55%, #A08850 100%)",
                    boxShadow: "0 0 8px rgba(239,216,154,.85)",
                  }}
                />
              )}
              <span
                className={[
                  "relative z-[1] text-[11.5px] font-serif transition-colors",
                  isActive ? "text-manor-brassHi" : "text-manor-ink",
                ].join(" ")}
                style={{
                  fontFamily: "var(--font-serif), 'EB Garamond', serif",
                  textShadow: isActive
                    ? "0 0 10px rgba(224,197,122,.55)"
                    : undefined,
                }}
              >
                {item.label}
              </span>
              <span
                className={[
                  "relative z-[1] text-[7.5px] tracking-[0.24em] mt-0.5 font-sc",
                  isActive ? "text-manor-brassHi/85" : "text-manor-inkDim",
                ].join(" ")}
                style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
              >
                {item.latin}
              </span>
              {isActive ? (
                <span aria-hidden="true" className="nav-active-underline" />
              ) : (
                <span aria-hidden="true" className="nav-underline" />
              )}
            </Link>
            {item.groupEnd && !isLast && (
              <span
                aria-hidden="true"
                className="mx-1.5 inline-block"
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 9999,
                  background:
                    "radial-gradient(circle at 30% 30%, #EFD89A, #9A7E46 60%, #3A2E12)",
                  boxShadow: "0 0 4px rgba(224,197,122,.45)",
                }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
