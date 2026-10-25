"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { storeSessionToken } from "../lib/session";
import { readJsonResponse } from "../lib/http-json";

export type ManagerAccount = {
  id: string;
  key: string;
  displayName: string;
  avatarInitial: string;
  position: number;
  active: boolean;
  online?: boolean;
  lastSeenAt?: string | null;
  stats?: { shares: number; favorites: number; dislikes: number };
};

function LockMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="10" width="14" height="10" rx="3" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

/**
 * Login gate: the app no longer lets you pick an identity freely.
 * One card - account code + password - verified by the API, which
 * returns a session token; every later request carries that token and
 * the API derives the account from it.
 */
export function ManagerAccountGate({
  apiBaseUrl,
  loading,
  error,
  onRetry,
  onAuthenticated,
  logo,
}: {
  apiBaseUrl: string;
  /** Boot session check still running (before any login attempt). */
  loading: boolean;
  /** Boot check failed at the network level (not a 401). */
  error: string;
  onRetry: () => void;
  onAuthenticated: (account: ManagerAccount) => void;
  logo?: ReactNode;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !code.trim() || !password) return;
    setSubmitting(true);
    setFailure("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), password }),
      });
      const payload = await readJsonResponse<{
        token: string;
        account: ManagerAccount;
      }>(response, "登录失败，请重试");
      storeSessionToken(payload.token);
      onAuthenticated(payload.account);
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : "登录失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="manager-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manager-gate-title"
    >
      <div className="manager-gate-aurora" aria-hidden="true" />
      <section className="manager-gate-panel">
        {!heroFailed ? (
          <div
            aria-hidden="true"
            className="mb-5 block aspect-[960/368] w-full overflow-hidden rounded-2xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/illustrations/login-hero.webp"
              alt=""
              width={960}
              height={368}
              onError={() => setHeroFailed(true)}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="manager-gate-brand" aria-hidden="true">
          {logo}
          <span>假面采购</span>
        </div>
        <h2 id="manager-gate-title">登录</h2>

        {loading ? (
          <div className="manager-gate-loading" role="status">
            <span />
            正在连接工作区
          </div>
        ) : error ? (
          <div className="manager-gate-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              重新连接
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-2.5">
            <label className="grid gap-1 text-left">
              <span className="text-[11px] font-bold text-ink/60">账号</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="username"
                aria-label="账号"
                className="h-12 rounded-xl border border-black/[0.12] bg-white px-3 font-mono text-base text-ink tabular-nums outline-none transition focus:border-ink/50"
              />
            </label>
            <label className="grid gap-1 text-left">
              <span className="text-[11px] font-bold text-ink/60">密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-label="密码"
                className="h-12 rounded-xl border border-black/[0.12] bg-white px-3 font-mono text-base text-ink tabular-nums outline-none transition focus:border-ink/50"
              />
            </label>
            {failure ? (
              <p role="alert" className="text-xs font-semibold text-[#c81e1e]">
                {failure}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !code.trim() || !password}
              className="mt-1 inline-flex min-h-12 items-center justify-center rounded-xl bg-ink text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              {submitting ? "登录中…" : "登录"}
            </button>
          </form>
        )}

        <div className="manager-gate-footnote">
          <LockMark />
          当前仅限两位管理者，不开放注册
        </div>
      </section>
    </div>
  );
}
