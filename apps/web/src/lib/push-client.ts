import { readJsonResponse } from "./http-json";

/**
 * Web Push client. Everything that only inspects values is a pure
 * function of an explicit environment snapshot so it can be unit
 * tested; the browser-touching wrappers are thin.
 */

export interface PushEnvironment {
  userAgent: string;
  /** Running as an installed PWA (standalone display mode / iOS home screen). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function detectPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      userAgent: "",
      standalone: false,
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
    };
  }
  const standalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent ?? "",
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  };
}

export function isPushSupported(
  env: PushEnvironment = detectPushEnvironment(),
): boolean {
  return env.hasServiceWorker && env.hasPushManager && env.hasNotification;
}

/**
 * iOS only delivers Web Push to home-screen web apps. A regular Safari
 * tab on iPhone/iPad reports the push APIs as missing, so the useful
 * answer there is "install first", not "unsupported".
 */
export function isIosNeedsInstall(
  env: PushEnvironment = detectPushEnvironment(),
): boolean {
  const isIos = /iphone|ipad|ipod/i.test(env.userAgent);
  return isIos && !env.standalone;
}

export type PushSubscriptionState =
  | "unsupported"
  | "ios-needs-install"
  | "denied"
  | "subscribed"
  | "not-subscribed";

export function currentSubscriptionState(input: {
  env?: PushEnvironment;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}): PushSubscriptionState {
  const env = input.env ?? detectPushEnvironment();
  if (isIosNeedsInstall(env)) return "ios-needs-install";
  if (!isPushSupported(env)) return "unsupported";
  if (input.permission === "denied") return "denied";
  return input.subscribed ? "subscribed" : "not-subscribed";
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export async function fetchPushConfig(apiBaseUrl: string): Promise<PushConfig> {
  const response = await fetch(`${apiBaseUrl}/push/config`);
  return readJsonResponse<PushConfig>(response, "读取推送设置失败");
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(input: {
  apiBaseUrl: string;
  accountId: string;
}): Promise<PushSubscription> {
  const config = await fetchPushConfig(input.apiBaseUrl);
  if (!config.enabled || !config.publicKey) {
    throw new Error("服务端尚未启用推送");
  }
  const registration =
    (await registerServiceWorker()) ??
    (await navigator.serviceWorker.getRegistration());
  if (!registration) throw new Error("推送注册失败，请重试");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知权限未开启");
  }
  const ready = await navigator.serviceWorker.ready;
  const active = ready ?? registration;
  const existing = await active.pushManager.getSubscription();
  const subscription =
    existing ??
    (await active.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
    }));
  const response = await fetch(`${input.apiBaseUrl}/push/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: input.accountId,
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  });
  await readJsonResponse(response, "开启推送失败");
  return subscription;
}

export async function unsubscribeFromPush(input: {
  apiBaseUrl: string;
  accountId: string;
}): Promise<boolean> {
  const subscription = await currentPushSubscription();
  if (!subscription) return false;
  const response = await fetch(`${input.apiBaseUrl}/push/subscriptions`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: input.accountId,
      endpoint: subscription.endpoint,
    }),
  });
  await readJsonResponse(response, "关闭推送失败");
  return subscription.unsubscribe();
}
