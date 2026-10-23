"use client";

import type { ReactNode } from "react";

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

function ChevronRightMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ManagerAccountGate({
  accounts,
  loading,
  error,
  onRetry,
  onSelect,
  logo,
}: {
  accounts: ManagerAccount[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSelect: (account: ManagerAccount) => void;
  logo?: ReactNode;
}) {
  return (
    <div
      className="manager-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manager-gate-title"
    >
      <div className="manager-gate-aurora" aria-hidden="true" />
      <section className="manager-gate-panel">
        <div className="manager-gate-brand" aria-hidden="true">
          {logo}
          <span>假面采购</span>
        </div>
        <h2 id="manager-gate-title">选择你的管理者账号</h2>

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
          <div className="manager-account-grid">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className="manager-account-choice"
                onClick={() => onSelect(account)}
              >
                <span className="manager-account-avatar">
                  {account.position}
                </span>
                <span className="manager-account-copy">
                  <strong>{account.displayName}</strong>
                </span>
                <span className="manager-account-arrow" aria-hidden="true">
                  <ChevronRightMark />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="manager-gate-footnote">
          <LockMark />
          当前仅限两位管理者，不开放注册
        </div>
      </section>
    </div>
  );
}
