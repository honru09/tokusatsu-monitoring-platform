"use client";
import { useEffect } from "react";
import { mobileViewportMetrics } from "../lib/mobile-viewport";

export function MobileViewportState() {
  useEffect(() => {
    const html = document.documentElement;
    let baseline = html.clientHeight;
    let frame = 0;
    let embeddedEditing = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const editing = (embeddedEditing && document.activeElement instanceof HTMLIFrameElement && document.activeElement.dataset.operationsFrame === "true") || (
          document.activeElement instanceof HTMLElement &&
          document.activeElement.matches(
            "textarea,input:not([type=button]):not([type=checkbox]):not([type=radio]),[contenteditable=true]",
          ));
        if (!editing) baseline = html.clientHeight;
        const metrics = mobileViewportMetrics({
          layoutHeight: html.clientHeight,
          visualHeight: viewport?.height ?? window.innerHeight,
          visualTop: viewport?.offsetTop ?? 0,
          scale: viewport?.scale ?? 1,
          editing,
          baselineHeight: baseline,
        });
        html.dataset.keyboardOpen = String(metrics.keyboardOpen);
        html.style.setProperty("--visible-height", `${metrics.height}px`);
        html.style.setProperty("--visible-top", `${metrics.top}px`);
      });
    };
    update();
    const onEmbeddedEditing = (event: Event) => {
      embeddedEditing = (event as CustomEvent<{ editing: boolean }>).detail?.editing === true;
      update();
    };
    window.addEventListener("kamen:embedded-editing", onEmbeddedEditing);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("kamen:embedded-editing", onEmbeddedEditing);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      delete html.dataset.keyboardOpen;
      html.style.removeProperty("--visible-height");
      html.style.removeProperty("--visible-top");
    };
  }, []);
  return null;
}
