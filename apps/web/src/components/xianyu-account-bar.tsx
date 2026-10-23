"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "../lib/motion-tokens";
import type { ResaleRequest } from "./resale-workspace";
import styles from "./resale-workspace.module.css";
type Session = {
  state: string;
  label: string;
  authenticated: boolean;
  loginAvailable: boolean;
  accountLabel: string | null;
  checkedAt: string;
  message: string;
  capabilities: {
    search: boolean;
    publish: boolean;
    edit: boolean;
    metrics: boolean;
  };
};
export function XianyuAccountBar({
  request,
  accountId,
  active,
  onDisconnect,
}: {
  request: ResaleRequest;
  accountId: string | null;
  active: boolean;
  onDisconnect: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const motionPreference = useReducedMotion();
  const [motionMounted, setMotionMounted] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => setMotionMounted(true), []);
  const reduced = !motionMounted || Boolean(motionPreference) || keyboard;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++generation.current;
      try {
        const data = await request<Session>(
          "/account",
          "GET",
          undefined,
          signal,
        );
        if (current === generation.current) {
          setSession(data);
          setError("");
        }
      } catch (reason) {
        if (!signal?.aborted && current === generation.current)
          setError(
            reason instanceof Error ? reason.message : "无法获取登录状态",
          );
      }
    },
    [request],
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible" && !pending)
          void load(controller.signal);
      },
      session?.state === "waiting_browser" ? 5000 : 30000,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
      generation.current++;
    };
  }, [active, load, pending, session?.state]);
  async function action(path: string) {
    if (pending || !accountId) return;
    setPending(true);
    setError("");
    generation.current++;
    try {
      setSession(await request<Session>(path, "POST", {}));
      if (path.endsWith("disconnect")) onDisconnect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录操作失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      onPointerDownCapture={() => setKeyboard(false)}
      onKeyDownCapture={() => setKeyboard(true)}
      className={styles.accountBar}
      aria-label="闲鱼账号连接"
      aria-busy={pending}
      data-session-state={session?.state || "loading"}
    >
      <div className={styles.accountIdentity}>
        <strong>账号连接</strong>
        <span className={styles.sessionStatus} role="status" aria-live="polite">
          <motion.span
            tabIndex={-1}
            key={`${session?.state ?? "loading"}:${pending}`}
            className={styles.sessionDot}
            aria-hidden="true"
            initial={reduced ? false : { scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={reduced ? { duration: 0 } : springs.appleSelection}
          />
          <motion.span
            tabIndex={-1}
            key={`${pending ? "pending" : (session?.state ?? "loading")}:${session?.label ?? ""}`}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : springs.appleSelection}
          >
            {pending
              ? "正在连接…"
              : session?.label || (error ? "连接暂不可用" : "检查登录中…")}
          </motion.span>
        </span>
        {session?.authenticated && (
          <span>{session.accountLabel || "闲鱼账号"}</span>
        )}
      </div>
      {!session?.authenticated && (
        <div className={styles.actions}>
          <motion.button
            data-apple-motion-owned
            type="button"
            tabIndex={0}
            className={`${styles.publishAction} ${styles.springAction}`}
            whileTap={
              reduced ? undefined : { scale: motionTokens.scale.subtle }
            }
            transition={reduced ? { duration: 0 } : springs.applePress}
            disabled={
              pending || !accountId || session?.loginAvailable === false
            }
            onClick={() => void action("/account/login")}
          >
            {session?.state === "waiting_browser" ? "继续登录" : "一键登录"}
          </motion.button>
        </div>
      )}
      {error && (
        <motion.p
          className={`${styles.error} ${styles.errorFeedback}`}
          role="alert"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduced ? 0 : motionTokens.duration.feedback,
          }}
        >
          {error}
        </motion.p>
      )}
      {!session?.authenticated && session?.state === "waiting_browser" && (
        <p className={styles.accountMessage}>{session.message}</p>
      )}
      <details className={styles.connectionDetails}>
        <summary>连接详情</summary>
        {session && (
          <>
            <p>{session.message}</p>
            <dl>
              <div>
                <dt>商品监测</dt>
                <dd>{session.capabilities.search ? "可运行" : "待登录"}</dd>
              </div>
              <div>
                <dt>发布</dt>
                <dd>
                  {session.capabilities.publish ? "已连接" : "官方页面确认"}
                </dd>
              </div>
              <div>
                <dt>最近检查</dt>
                <dd>
                  {new Date(session.checkedAt).toLocaleTimeString("zh-CN")}
                </dd>
              </div>
            </dl>
          </>
        )}
        <div className={styles.actions}>
          {session?.authenticated && (
            <button
              type="button"
              disabled={pending || !accountId}
              onClick={() => void action("/account/login")}
            >
              打开闲鱼
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => void load()}>
            检查状态
          </button>
          {session?.authenticated && (
            <button
              type="button"
              disabled={pending || !accountId}
              onClick={() => void action("/account/disconnect")}
            >
              断开登录
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
