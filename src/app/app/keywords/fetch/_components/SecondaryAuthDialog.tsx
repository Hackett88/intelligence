"use client";

import { useEffect, useRef, useState } from "react";
import { BaroqueCorners } from "@/components/ManorOrnaments";

interface SecondaryAuthDialogProps {
  open: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  /** 顶部小标签（默认：◆ SIGILLUM · 二次验证） */
  eyebrow?: string;
  /** 主标题（默认：请加盖操作印玺） */
  title?: string;
  /** 副说明（默认：写入与高耗动作需重新验印） */
  description?: string;
}

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

export function SecondaryAuthDialog({
  open,
  onSuccess,
  onCancel,
  eyebrow = "◆ SIGILLUM · 二次验证",
  title = "请加盖操作印玺",
  description = "写入与高耗动作需重新验印",
}: SecondaryAuthDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setCountdown(0);
        setAttempts(0);
        setError("");
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const isLocked = !!lockedUntil && Date.now() < lockedUntil;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked || loading) return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/n8n/secondary-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; code?: string; message?: string };
      if (res.ok && data.ok) {
        setPassword("");
        setAttempts(0);
        setLockedUntil(null);
        onSuccess();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
          setError(`连续错误 ${MAX_ATTEMPTS} 次，锁定 ${LOCK_SECONDS} 秒`);
        } else {
          const code = data.code ?? "INVALID_PASSWORD";
          if (code === "INVALID_PASSWORD") {
            setError(`密码错误（剩余 ${MAX_ATTEMPTS - newAttempts} 次机会）`);
          } else if (code === "TOO_MANY_ATTEMPTS") {
            setError("尝试次数过多，请稍后再试");
          } else {
            setError(data.message ?? "验证失败");
          }
        }
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center drawer-mask p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm glass-panel-brass"
        style={{ borderRadius: 6 }}
      >
        <BaroqueCorners size={20} />
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <div
              className="font-sc tracking-[0.32em] text-manor-brassHi/80 mb-1.5"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 10 }}
            >
              {eyebrow}
            </div>
            <h2
              className="text-brass-gradient font-serif font-semibold leading-tight"
              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 20, letterSpacing: "0.02em" }}
            >
              {title}
            </h2>
            <p
              className="text-manor-inkDim mt-1.5 italic"
              style={{ fontFamily: "var(--font-serif), 'EB Garamond', serif", fontSize: 12 }}
            >
              {description}
            </p>
            <span className="brass-divider mt-3 opacity-60 block" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="sec-pwd"
              className="font-sc tracking-[0.22em] text-manor-brass"
              style={{ fontFamily: "var(--font-sc), 'Cormorant SC', serif", fontSize: 10 }}
            >
              SIGILLUM · 操作密码
            </label>
            <input
              id="sec-pwd"
              ref={inputRef}
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLocked || loading}
              placeholder="八位密码"
              className="block w-full bg-manor-void/60 border border-manor-brass/30 px-3 py-2 text-sm text-manor-ink placeholder:text-manor-inkFaint focus:outline-none focus:border-manor-brass focus:ring-1 focus:ring-manor-brass/30 disabled:opacity-50"
              style={{ borderRadius: 4, fontFamily: "var(--font-serif), 'EB Garamond', serif" }}
            />
          </div>

          {error && (
            <p
              className="text-xs text-manor-oxbloodHi border border-manor-oxblood/30 bg-manor-oxblood/10 px-3 py-2 flex items-center gap-2"
              style={{ borderRadius: 3 }}
            >
              <span className="diamond bg-manor-oxblood shrink-0" />
              {isLocked ? `印玺已封 · 请等候 ${countdown} 秒` : error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-inkDim border border-manor-line2 hover:text-manor-ink hover:border-manor-brass/40 transition-colors"
              style={{ borderRadius: 3, fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              ABROGARE · 取消
            </button>
            <button
              type="submit"
              disabled={isLocked || loading || !password}
              className="px-5 py-1.5 text-xs font-sc tracking-[0.22em] text-manor-bg bg-gradient-to-b from-manor-brassHi to-manor-brassDim hover:from-manor-brass hover:to-manor-brass disabled:opacity-40 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_8px_rgba(201,169,97,0.35)] transition-colors"
              style={{ borderRadius: 3, fontFamily: "var(--font-sc), 'Cormorant SC', serif" }}
            >
              {loading ? "验印中..." : "SIGNARE · 确认"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
