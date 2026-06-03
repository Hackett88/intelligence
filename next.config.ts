import type { NextConfig } from "next";

// 安全响应头：集中在此声明，覆盖全站所有路由（页面 + API + 静态资源）。
// 背景见 执行日志/安全修复-20260603-*.md（外部安全体检 P1 待修项）。
//
// CSP 先以 Report-Only 模式上线：浏览器只在控制台上报"本会被拦"的资源、并不真拦，
// 因此绝不会弄坏页面。观察数日确认无误伤自身资源后，再把响应头名改为
// "Content-Security-Policy" 即可强制生效。点击劫持已由 X-Frame-Options: DENY
// 当场堵死（强制生效，不依赖 CSP 的 frame-ancestors）。
//
// 本站外域极少：字体走 next/font 自托管（本站 origin），无第三方业务脚本；
// 唯一可能的外部脚本是 Cloudflare Web Analytics 信标（static.cloudflareinsights.com）。
// 若日后接入新的第三方（统计/字体/CDN），需把对应域名补进下方白名单再转正。
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next.js App Router 注水需要内联 bootstrap 脚本；当前无 nonce 方案，保留 'unsafe-inline'。
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  // Tailwind 产物为本站样式表；登录页等存在 style 属性内联样式，保留 'unsafe-inline'。
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 前端 fetch 仅打本站 /api；Cloudflare 信标回传 cloudflareinsights.com。
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  // 点击劫持：禁止任何站点用 iframe 嵌套本后台（强制生效）。
  { key: "X-Frame-Options", value: "DENY" },
  // 禁止浏览器对响应做 MIME 嗅探。
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 跨站跳转时只带 origin，不泄露完整 URL（含查询串）。
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 强制 HTTPS 两年、含子域；preload 声明可被纳入浏览器预加载名单。
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // 默认关闭摄像头/麦克风/定位等强权限。
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // XSS 兜底白名单：先观察、不拦截。确认无误伤后改名为 Content-Security-Policy 转正。
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // 去掉 X-Powered-By: Next.js，少暴露一处技术栈指纹。
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
