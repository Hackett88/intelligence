"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BaroqueCorners, Monogram } from "@/components/ManorOrnaments";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("用户名或密码错误");
    } else {
      router.push("/app/keywords/fetch");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-manor-void paper-grain">
      <div
        className="relative w-full max-w-sm glass-panel-brass p-10"
        style={{ borderRadius: 6 }}
      >
        <BaroqueCorners size={22} />

        {/* Monogram crest */}
        <div className="flex justify-center mb-5">
          <Monogram size={70} />
        </div>

        <div className="text-center">
          <h1
            className="text-brass-gradient text-2xl font-semibold tracking-[0.18em] font-sc"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            WESLAMIC HALL
          </h1>
          <div className="flex justify-center my-3 opacity-70">
            <svg width="100" height="8" aria-hidden="true">
              <use href="#orn-flourish" />
            </svg>
          </div>
          <p
            className="text-xs text-manor-inkDim italic tracking-wider"
            style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
          >
            SEO Intelligence · Anno MMXXVI
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label
              className="block text-[10px] tracking-[0.28em] text-manor-brass mb-1.5 font-sc"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              NOMEN · 用户名
            </label>
            <Input
              name="username"
              type="text"
              placeholder="username"
              required
              className="bg-manor-void/60 border-manor-brass/30 text-manor-ink placeholder:text-manor-inkFaint focus-visible:border-manor-brass focus-visible:ring-manor-brass/30"
            />
          </div>
          <div>
            <label
              className="block text-[10px] tracking-[0.28em] text-manor-brass mb-1.5 font-sc"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              SIGILLUM · 密码
            </label>
            <Input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              className="bg-manor-void/60 border-manor-brass/30 text-manor-ink placeholder:text-manor-inkFaint focus-visible:border-manor-brass focus-visible:ring-manor-brass/30"
            />
          </div>

          {error && (
            <p className="text-xs text-manor-oxbloodHi italic flex items-center gap-2">
              <span className="diamond bg-manor-oxblood" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-b from-manor-brassHi to-manor-brassDim hover:from-manor-brass hover:to-manor-brass text-manor-bg font-semibold tracking-[0.22em] font-sc disabled:opacity-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_12px_rgba(201,169,97,0.4)]"
            style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
          >
            {loading ? "正在加盖印玺..." : "INTRARE · 进入庄园"}
          </Button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-2 text-[9px] tracking-[0.32em] text-manor-brassDim"
             style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}>
          <span>PER STUDIA</span>
          <span className="diamond bg-manor-brass opacity-70" />
          <span>ARVUM CRESCIT</span>
        </div>
      </div>
    </div>
  );
}
