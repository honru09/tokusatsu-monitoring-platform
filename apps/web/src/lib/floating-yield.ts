"use client";
import { useEffect } from "react";

/**
 * Floating-control yield contract.
 *
 * The two `.floating-control` elements (the recent-pages orb and the
 * collaboration negotiation button) are position:fixed at z-index 80/90
 * and know nothing about the workspace content underneath them. Every
 * other kind of bottom chrome outranks them: a modal sheet, a selection
 * bar, a bundle/cart bottom bar, or the on-screen keyboard. Those
 * surfaces already own their open state in their own components, so
 * instead of lifting that state into one more store, an owner simply
 * claims the yield while its surface is up and releases it on close:
 *
 *   useFloatingYield("collaboration-selection", selectionMode);
 *
 * The claim is a counter on `<html data-floating-yield="true">` - the
 * same shell-level signal pattern as `data-keyboard-open` - and the
 * CSS in styles/mobile-chrome.css hides every `.floating-control`
 * while it is set. Claims are owner-keyed so overlapping surfaces
 * (a sheet over a selection bar, say) never clear each other early:
 * the floats come back only when the last claim is released.
 */
const owners = new Set<string>();

function syncFloatingYield() {
  if (typeof document === "undefined") return;
  if (owners.size > 0) {
    document.documentElement.dataset.floatingYield = "true";
  } else {
    delete document.documentElement.dataset.floatingYield;
  }
}

export function claimFloatingYield(owner: string): void {
  owners.add(owner);
  syncFloatingYield();
}

export function releaseFloatingYield(owner: string): void {
  owners.delete(owner);
  syncFloatingYield();
}

/** Claim the floating-control yield while `active` is true. */
export function useFloatingYield(owner: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    claimFloatingYield(owner);
    return () => releaseFloatingYield(owner);
  }, [owner, active]);
}
