import { describe, expect, it } from "vitest";
import {
  currentSubscriptionState,
  isIosNeedsInstall,
  isPushSupported,
  type PushEnvironment,
} from "./push-client";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function env(overrides: Partial<PushEnvironment>): PushEnvironment {
  return {
    userAgent: DESKTOP,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    ...overrides,
  };
}

describe("push environment detection", () => {
  it("requires service worker, PushManager and Notification together", () => {
    expect(isPushSupported(env({}))).toBe(true);
    expect(isPushSupported(env({ hasPushManager: false }))).toBe(false);
    expect(isPushSupported(env({ hasServiceWorker: false }))).toBe(false);
    expect(isPushSupported(env({ hasNotification: false }))).toBe(false);
  });

  it("flags iOS browser tabs as needing installation, but not installed web apps", () => {
    expect(isIosNeedsInstall(env({ userAgent: IPHONE }))).toBe(true);
    expect(isIosNeedsInstall(env({ userAgent: IPAD }))).toBe(true);
    expect(
      isIosNeedsInstall(env({ userAgent: IPHONE, standalone: true })),
    ).toBe(false);
    expect(isIosNeedsInstall(env({ userAgent: ANDROID }))).toBe(false);
    expect(isIosNeedsInstall(env({ userAgent: DESKTOP }))).toBe(false);
  });
});

describe("currentSubscriptionState", () => {
  it("prefers the iOS install hint over generic unsupported", () => {
    // A plain Safari tab on iOS has no PushManager at all; the state
    // must still be the install hint so the UI can explain the fix.
    expect(
      currentSubscriptionState({
        env: env({
          userAgent: IPHONE,
          hasPushManager: false,
          hasNotification: false,
        }),
        permission: "default",
        subscribed: false,
      }),
    ).toBe("ios-needs-install");
    expect(
      currentSubscriptionState({
        env: env({ hasPushManager: false }),
        permission: "default",
        subscribed: false,
      }),
    ).toBe("unsupported");
  });

  it("reports denied, subscribed and not-subscribed", () => {
    expect(
      currentSubscriptionState({
        env: env({ userAgent: ANDROID }),
        permission: "denied",
        subscribed: false,
      }),
    ).toBe("denied");
    expect(
      currentSubscriptionState({
        env: env({ userAgent: ANDROID }),
        permission: "granted",
        subscribed: true,
      }),
    ).toBe("subscribed");
    expect(
      currentSubscriptionState({
        env: env({ userAgent: IPHONE, standalone: true }),
        permission: "default",
        subscribed: false,
      }),
    ).toBe("not-subscribed");
  });
});
