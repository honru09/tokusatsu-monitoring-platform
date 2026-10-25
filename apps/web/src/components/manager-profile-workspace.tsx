"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ManagerAccount } from "./manager-account-gate";
import { motionTokens, springs } from "../lib/motion-tokens";
import styles from "./editorial-communications.module.css";

export function ManagerProfileWorkspace({
  accounts,
  activeManagerId,
  onSwitchIdentity,
  onOpenChat,
  embedded = false,
}: {
  accounts: ManagerAccount[];
  activeManagerId: string;
  onSwitchIdentity: () => void;
  onOpenChat: () => void;
  /** Rendered inside the workbench account section instead of as a page. */
  embedded?: boolean;
}) {
  const [viewedId, setViewedId] = useState(activeManagerId);
  const reduceMotion = useReducedMotion();
  const [keyboardTabChange, setKeyboardTabChange] = useState(false);

  useEffect(() => {
    if (!accounts.some((account) => account.id === viewedId))
      setViewedId(activeManagerId || accounts[0]?.id || "");
  }, [accounts, activeManagerId, viewedId]);

  const manager =
    accounts.find((account) => account.id === viewedId) ??
    accounts.find((account) => account.id === activeManagerId) ??
    accounts[0];

  return (
    <section
      className={`${embedded ? "" : "portal-page manager-profile-page "}${styles.profile}`}
      aria-labelledby="profile-title"
    >
      {!embedded && (
        <header className={styles.profileHeading}><h1>管理者</h1><p>身份与协作记录</p></header>
      )}
      <div
        className="manager-profile-switcher"
        role="tablist"
        aria-label="查看管理者"
      >
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            role="tab"
            tabIndex={account.id === manager?.id ? 0 : -1}
            aria-selected={account.id === manager?.id}
            aria-controls="manager-profile-panel"
            id={`manager-profile-tab-${account.id}`}
            onClick={() => { setKeyboardTabChange(false); setViewedId(account.id); }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setKeyboardTabChange(true);
              const index = accounts.findIndex((entry) => entry.id === account.id);
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? accounts.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + accounts.length) % accounts.length;
              const next = accounts[nextIndex];
              if (!next) return;
              setViewedId(next.id);
              document.getElementById(`manager-profile-tab-${next.id}`)?.focus();
            }}
          >
            {account.id === manager?.id && <motion.span className={styles.profileTabIndicator} layoutId="manager-profile-tab-indicator" transition={reduceMotion || keyboardTabChange ? { duration: 0 } : springs.appleSelection} aria-hidden="true" />}
            {account.displayName}
          </button>
        ))}
      </div>

      {manager ? (
        <motion.article className="manager-profile-card" id="manager-profile-panel" role="tabpanel" aria-labelledby={`manager-profile-tab-${manager.id}`} initial={false} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.fast }}>
          <header>
            <span className="manager-profile-avatar" aria-hidden="true">
              {manager.avatarInitial}
            </span>
            <div>
              <span
                className={`manager-profile-presence ${manager.online ? "is-online" : ""}`}
              >
                {manager.online ? "在线" : "离线"}
              </span>
              <h2 id="profile-title">{manager.displayName}</h2>
              {manager.id === activeManagerId && <small>当前账号</small>}
            </div>
          </header>

          <dl className="manager-profile-stats">
            <div>
              <dt>分享</dt>
              <dd>{manager.stats?.shares ?? 0}</dd>
            </div>
            <div>
              <dt>收藏</dt>
              <dd>{manager.stats?.favorites ?? 0}</dd>
            </div>
            <div>
              <dt>不感兴趣</dt>
              <dd>{manager.stats?.dislikes ?? 0}</dd>
            </div>
          </dl>

          <footer>
            <button type="button" onClick={onOpenChat}>
              发消息
            </button>
            <button type="button" onClick={onSwitchIdentity}>
              切换账号
            </button>
          </footer>
        </motion.article>
      ) : (
        <div className="manager-profile-empty" id="profile-title">
          未选择账号
        </div>
      )}
    </section>
  );
}
