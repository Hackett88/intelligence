import { auth } from "@/lib/auth";

// Next.js 16 起 middleware.ts 已更名为 proxy.ts；且本项目用 src/ 目录，
// 文件必须置于 src/ 下（root 下的 middleware.ts 不会被识别 —— 那正是此前
// 登录拦截"看似配了却不生效"的根因）。运行时为 nodejs（proxy 不支持 edge）。
//
// 登录页是唯一主入口：
//   · 未登录访问根路径 / 任意 /app 页 → 打回 /login（集中防护，不再依赖各页自查）
//   · 已登录访问 /login → 自动送回应用首页（登录页不再回头可见）
const APP_HOME = "/app/keywords/fetch";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/login";

  // 已登录的人不该再看到登录页 —— 直接送回应用首页。
  if (isLoginPage && isLoggedIn) {
    return Response.redirect(new URL(APP_HOME, req.nextUrl));
  }

  // 受保护区域（应用全部页面 + 根路径），未登录一律打回登录页。
  const isAppRoute = pathname.startsWith("/app");
  const isRoot = pathname === "/";
  if ((isAppRoute || isRoot) && !isLoggedIn) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/", "/login", "/app/:path*"],
};
