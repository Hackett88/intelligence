import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// 会话绝对有效期（秒）：从登录那一刻起算，满此时长必须重新登录，与中途是否
// 活跃无关。注意 —— 仅靠 session.maxAge / updateAge 做不到"绝对过期"：next-auth
// 的 JWT 会在活跃时按 updateAge 周期性重签、把过期时间顺延（滑动有效期），
// 持续使用就永不掉线。真正的绝对过期靠下方 jwt 回调里锚定的 absoluteExpiry。
// 绝对 7 天：登录满 7 天必须重新登录，持续使用也不例外（已用 90s 窗口实测验证）。
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username as string;
        const password = credentials?.password as string;
        const envUser = process.env.ADMIN_USERNAME ?? "admin";
        // bcrypt hash of "weslamic2026" (cost=10, verified)
        const HASH = "$2b$10$/3uvv136nxQZOqFc./LZu.3t9IiuZBfZElxbA7zg/w1dlDM8WDInK";
        if (username !== envUser) return null;
        const valid = await bcrypt.compare(password, HASH);
        if (!valid) return null;
        return { id: "1", name: username, email: `${username}@weslamic.com` };
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    // cookie/token 的滚动有效期：与 absoluteExpiry 取同值即可，绝对上限由回调把关。
    maxAge: SESSION_MAX_AGE,
  },
  callbacks: {
    async jwt({ token, user }) {
      const now = Math.floor(Date.now() / 1000);
      // 仅在登录那一刻（带 user）锚定绝对过期点；后续的刷新调用不带 user，
      // 因此 absoluteExpiry 永不被顺延 —— 这正是"绝对过期、不随活跃续命"的关键。
      const t = token as typeof token & { absoluteExpiry?: number };
      if (user) {
        t.absoluteExpiry = now + SESSION_MAX_AGE;
      }
      // 超过绝对期 → 返回 null 作废会话，Auth.js 随即清掉 cookie，强制重新登录。
      if (typeof t.absoluteExpiry === "number" && now > t.absoluteExpiry) {
        return null;
      }
      return t;
    },
  },
});
