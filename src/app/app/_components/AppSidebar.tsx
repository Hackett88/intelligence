"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Target,
  PenLine,
  CheckSquare,
  Search,
  BarChart2,
  Zap,
  Plug,
  Download,
} from "lucide-react";

const navItems = [
  { label: "总览", latin: "CONSPECTUS", href: "/app", icon: LayoutDashboard },
  { label: "关键词功能库", latin: "INSTRUMENTA", href: "/app/keywords/fetch", icon: Download },
  { label: "关键词库", latin: "THESAURUS", href: "/app/keywords", icon: Database },
  { label: "主题与页面规划", latin: "PLEXUS", href: "/app/strategy", icon: Target },
  { label: "内容工坊", latin: "OFFICINA", href: "/app/content", icon: PenLine },
  { label: "发布与审核", latin: "PROMULGATIO", href: "/app/publish", icon: CheckSquare },
  { label: "收录与索引", latin: "INDEX", href: "/app/indexing", icon: Search },
  { label: "表现与迭代", latin: "FRUCTUS", href: "/app/analytics", icon: BarChart2 },
  { label: "自动化中心", latin: "AUTOMATIA", href: "/app/automation", icon: Zap },
  { label: "数据与接入", latin: "PORTUS", href: "/app/datasource", icon: Plug },
];

export function AppSidebar() {
  const pathname = usePathname();

  // Pick the single nav item whose href is the longest prefix of the current
  // pathname (or an exact match). Prevents both "/app/keywords" and
  // "/app/keywords/fetch" from lighting up when on the latter.
  const activeHref = navItems
    .filter(
      (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="fixed left-0 top-12 h-[calc(100vh-3rem)] w-52 bg-manor-bg2 border-r border-manor-line overflow-y-auto z-40">
      {/* Section heading */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-manor-brass/40 to-manor-brass/20" />
        <span
          className="font-sc text-[9px] tracking-[0.32em] text-manor-brass"
          style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
        >
          FILUM · 链路
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-manor-brass/40 to-manor-brass/20" />
      </div>

      <nav className="py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group relative flex items-center gap-3 pl-4 pr-3 py-2.5 transition-colors",
                "border-l-2",
                isActive
                  ? "bg-manor-bg3 border-manor-brass text-manor-brassHi"
                  : "border-transparent text-manor-inkDim hover:bg-manor-bg3/60 hover:text-manor-ink",
              ].join(" ")}
            >
              <Icon
                size={15}
                className={isActive ? "text-manor-brass" : "text-manor-inkFaint group-hover:text-manor-brassDim"}
              />
              <div className="flex flex-col min-w-0">
                <span
                  className="text-[12px] leading-tight font-serif"
                  style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
                >
                  {item.label}
                </span>
                <span
                  className={[
                    "text-[8.5px] tracking-[0.22em] mt-0.5 leading-none",
                    isActive ? "text-manor-brass/80" : "text-manor-inkFaint",
                  ].join(" ")}
                  style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
                >
                  {item.latin}
                </span>
              </div>
              {isActive && (
                <span className="ml-auto diamond bg-manor-brass" aria-hidden="true" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom flourish */}
      <div className="px-4 pt-3 pb-6 flex items-center justify-center opacity-50">
        <svg width="60" height="6" aria-hidden="true">
          <use href="#orn-flourish" />
        </svg>
      </div>
    </aside>
  );
}
