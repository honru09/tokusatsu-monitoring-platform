"use client";

import { useCallback, useEffect, useState } from "react";
import {
  currentPushSubscription,
  currentSubscriptionState,
  detectPushEnvironment,
  fetchPushConfig,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSubscriptionState,
} from "../lib/push-client";
import { TERMS } from "../lib/terms";
import styles from "./workbench-workspace.module.css";

type PushBlockState =
  | { kind: "loading" }
  | { kind: "no-account" }
  | { kind: "disabled" }
  | { kind: PushSubscriptionState };

const STATE_HINTS: Record<string, string> = {
  unsupported: "当前浏览器不支持推送",
  "ios-needs-install": "用 Safari 打开并添加到主屏幕后可用",
  denied: "通知权限已被关闭，请在浏览器设置中允许",
  subscribed: "已开启 · 搭档分享新货或做决定时会通知你",
  "not-subscribed": "搭档分享新货或做决定时通知你",
};

/**
 * The one push control for the whole app: a single on/off, no
 * per-event preferences. Lives in the workbench settings group.
 */
export function PushSettings({
  apiBaseUrl,
  accountId,
}: {
  apiBaseUrl: string;
  accountId: string | null;
}) {
  const [state, setState] = useState<PushBlockState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!accountId) {
      setState({ kind: "no-account" });
      return;
    }
    try {
      const config = await fetchPushConfig(apiBaseUrl);
      if (!config.enabled) {
        setState({ kind: "disabled" });
        return;
      }
      const env = detectPushEnvironment();
      const permission: NotificationPermission | "unsupported" =
        isPushSupported(env) ? Notification.permission : "unsupported";
      const subscription = await currentPushSubscription();
      setState({
        kind: currentSubscriptionState({
          env,
          permission,
          subscribed: Boolean(subscription),
        }),
      });
    } catch {
      setState({ kind: "unsupported" });
    }
  }, [apiBaseUrl, accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (enable: boolean) => {
    if (!accountId || busy) return;
    setBusy(true);
    setError("");
    try {
      if (enable) {
        await subscribeToPush({ apiBaseUrl, accountId });
      } else {
        await unsubscribeFromPush({ apiBaseUrl, accountId });
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "推送设置失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const hint =
    state.kind === "loading"
      ? "正在读取推送状态…"
      : state.kind === "no-account"
        ? "先选择账号后可开启"
        : state.kind === "disabled"
          ? "未启用"
          : (STATE_HINTS[state.kind] ?? "");

  return (
    <div className={styles.entry}>
      <span>
        <strong>{TERMS.push}</strong>
        <small>{error || hint}</small>
      </span>
      {state.kind === "not-subscribed" && (
        <button
          type="button"
          className={styles.entryAction}
          disabled={busy}
          onClick={() => void toggle(true)}
        >
          开启推送
        </button>
      )}
      {state.kind === "subscribed" && (
        <button
          type="button"
          className={styles.entryAction}
          disabled={busy}
          onClick={() => void toggle(false)}
        >
          关闭推送
        </button>
      )}
    </div>
  );
}
