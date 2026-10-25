"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "../lib/push-client";

/**
 * Registers the push-only service worker on app start so a later
 * subscribe call from the settings block finds it already active.
 * Registration is a no-op on browsers without push support.
 */
export function PushServiceWorker() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
