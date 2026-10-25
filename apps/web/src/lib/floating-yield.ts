"use client";
import { useEffect, type RefObject } from "react";

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
 *
 * Sticky section headers rank as surfaces too: a header pinned over
 * the scrolling content needs its full width for its title, and a
 * dragged float parked at the top of the viewport would sit on that
 * title. `useStickyHeaderYield` below lets a sticky header claim the
 * same yield while it is stuck, so the dock clears the header's band
 * entirely instead of being repositioned around it - repositioning
 * would have to fight the floats' persisted drag positions, while
 * the yield is the one mechanism every float already honors.
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

/**
 * Whether a sticky header has left its in-flow position. The caller
 * renders a zero-height sentinel immediately before the header: while
 * the header is in flow the two sit exactly `naturalGap` apart (the
 * header's own margin), and once the header sticks its rect stays
 * pinned while the sentinel scrolls on, so the gap grows. Comparing
 * rects against the layout gap keeps the check independent of the
 * stick offset, which differs per breakpoint (8px on desktop,
 * header height + 8px on phones).
 */
export function isStickyHeaderStuck(
  sentinelBottom: number,
  headerTop: number,
  naturalGap: number,
): boolean {
  return headerTop - sentinelBottom > naturalGap + 1;
}

/**
 * Claim the floating-control yield while the header referenced by
 * `headerRef` is stuck. `sentinelRef` must point at a zero-height
 * element rendered immediately before the header in the same flow.
 * The check runs on mount, on every render (the header mounts and
 * unmounts with its workspace view), and rAF-throttled on scroll and
 * resize; the claim is released when the header unsticks or unmounts.
 */
export function useStickyHeaderYield<
  S extends HTMLElement,
  H extends HTMLElement,
>(
  sentinelRef: RefObject<S | null>,
  headerRef: RefObject<H | null>,
  owner = "catalog-sticky-header",
): void {
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const header = headerRef.current;
    if (!sentinel || !header) return;
    let frame = 0;
    let claimed = false;
    const check = () => {
      frame = 0;
      // offsetTop reports the in-flow position even while the header
      // is stuck, so the gap between the two layout boxes never moves.
      const naturalGap =
        header.offsetTop - sentinel.offsetTop - sentinel.offsetHeight;
      const stuck = isStickyHeaderStuck(
        sentinel.getBoundingClientRect().bottom,
        header.getBoundingClientRect().top,
        naturalGap,
      );
      if (stuck === claimed) return;
      claimed = stuck;
      if (stuck) claimFloatingYield(owner);
      else releaseFloatingYield(owner);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      if (claimed) releaseFloatingYield(owner);
    };
  });
}
