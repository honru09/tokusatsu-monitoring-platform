"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ManagerAccount } from "./manager-account-gate";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./editorial-communications.module.css";

/**
 * The workbench account block. Identity is fixed by the login session:
 * this shows the logged-in account only - no switching and no viewing
 * as the other manager. The partner's presence and stats stay visible
 * inside the collaboration workspace.
 */
export function ManagerProfileWorkspace({
  accounts,
  activeManagerId,
  onLogout,
  onOpenChat,
  embedded = false,
}: {
  accounts: ManagerAccount[];
  activeManagerId: string;
  onLogout: () => void;
  onOpenChat: () => void;
  /** Rendered inside the workbench account section instead of as a page. */
  embedded?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const manager =
    accounts.find((account) => account.id === activeManagerId) ?? accounts[0];

  return (
    <section
      className={`${embedded ? "" : "portal-page manager-profile-page "}${styles.profile}`}
      aria-labelledby="profile-title"
    >
      {!embedded && (
        <header className={styles.profileHeading}><h1>管理者</h1><p>当前登录账号</p></header>
      )}

      {manager ? (
        <motion.article className="manager-profile-card" initial={false} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.fast }}>
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
              <small>当前账号</small>
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
            <button type="button" onClick={onLogout}>
              退出登录
            </button>
          </footer>
        </motion.article>
      ) : (
        <div className="manager-profile-empty" id="profile-title">
          未登录
        </div>
      )}
    </section>
  );
}
