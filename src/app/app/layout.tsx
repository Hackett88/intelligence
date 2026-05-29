import { auth } from "@/lib/auth";
import { loadLatestSnapshot } from "@/lib/gsc/loader";
import { TopNav } from "./_components/TopNav";
import { UserMenu } from "./_components/UserMenu";
import { CurrentTime } from "./_components/CurrentTime";
import { HudRail } from "./_components/HudRail";
import { StatusBar } from "./_components/StatusBar";
import { DiariumTicker } from "./_components/DiariumTicker";
import { RouteFader } from "./_components/RouteFader";
import { BellMenu } from "./_components/BellMenu";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // auth 与快照互不依赖 —— 并行。快照走 loader 的 60s 缓存，与「收录与索引」页同源；
  // 拿不到数据时（PG/JSON 皆空）收录页诚实显示 0。
  const [session, snapshot] = await Promise.all([auth(), loadLatestSnapshot()]);
  const indexedPages = snapshot?.stats.totalPages ?? 0;

  return (
    <div className="min-h-screen paper-grain">
      {/* Drifting atmosphere — slow vignette spotlight behind everything */}
      <div className="atmosphere" aria-hidden="true" />
      {/* Top brand-bar + horizontal nav (h-14) */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 glass-panel-brass flex items-center gap-5 px-5"
              style={{ borderRadius: 0, borderTop: 0, borderLeft: 0, borderRight: 0 }}>
        {/* Brand block — eight-point star crest + Anno year */}
        <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
          <span className="brand-crest brass-aura" style={{ width: 32, height: 32 }}>
            {/* Brand logo — alpha-cutout PNG, gold drops directly into the
                header without needing a blend mode. */}
            <img
              src="/brand-logo.png"
              alt=""
              width={30}
              height={30}
              style={{
                display: "block",
                filter:
                  "drop-shadow(0 0 6px rgba(239,216,154,0.6)) drop-shadow(0 0 12px rgba(239,216,154,0.25))",
              }}
            />
          </span>
          <div className="flex flex-col leading-none">
            <span
              className="brand-title text-brass-gradient font-sc text-[18px] tracking-[0.22em] font-semibold"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              WESLAMIC
            </span>
          </div>
        </div>

        <span className="brass-divider-v h-9" />

        {/* Center: horizontal nav */}
        <div className="flex-1 flex justify-center">
          <TopNav />
        </div>

        <span className="brass-divider-v h-9" />

        {/* Right: tools */}
        <div className="flex items-center gap-4 shrink-0">
          <CurrentTime />
          <BellMenu />
          <UserMenu name={session?.user?.name} email={session?.user?.email} />
        </div>

        {/* Brass underline */}
        <div className="absolute -bottom-px left-0 right-0 brass-divider opacity-15" />
      </header>

      {/* Left HUD rail */}
      <HudRail indexedPages={indexedPages} />

      {/* Main content area — pulled in by HUD on left (w-[78px]),
          StatusBar (h-14) and DiariumTicker (h-8) on bottom.
          外层永不滚动；如有滚动应在页面内部自管理。 */}
      <main className="pl-[78px] pt-14 pb-[88px] h-screen overflow-hidden flex flex-col relative">
        <div className="hairline-grid" aria-hidden="true" />
        <div className="flex-1 min-h-0 overflow-hidden relative z-[1] flex flex-col">
          <RouteFader>{children}</RouteFader>
        </div>
      </main>

      <StatusBar />
      <DiariumTicker />
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
