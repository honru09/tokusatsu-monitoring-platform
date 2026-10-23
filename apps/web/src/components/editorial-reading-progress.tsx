"use client";

import { useEffect, useRef, type RefObject } from "react";

/** A single transform follows the real scroll owner, including restored scroll. */
export function EditorialReadingProgress({ scrollTarget, workspace }: {
  scrollTarget: RefObject<HTMLElement | null>;
  workspace: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (["assistant", "collaboration", "operations"].includes(workspace)) return;
    const target = scrollTarget.current;
    let frame = 0;
    const update = () => {
      frame = 0;
      const innerScroll = target && target.scrollHeight > target.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(target).overflowY);
      const owner = innerScroll ? target : document.scrollingElement;
      const length = owner ? owner.scrollHeight - owner.clientHeight : 0;
      if (bar.current) {
        bar.current.style.visibility = length > 1 ? "visible" : "hidden";
        bar.current.style.transform = `scaleX(${length > 1 ? Math.min(1, Math.max(0, owner!.scrollTop / length)) : 0})`;
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    target?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (target) resize?.observe(target);
    schedule();
    return () => {
      target?.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resize?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollTarget, workspace]);
  return <div key={workspace} ref={bar} className="editorial-reading-progress" style={{ transform: "scaleX(0)", visibility: "hidden" }} aria-hidden="true" />;
}
