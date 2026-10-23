"use client";
import { useLayoutEffect, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import { motionTokens } from "./motion-tokens";

/** Finite presentation only: releasing the transform preserves fixed descendants. */
export function useTransactionPresentation(ref:RefObject<HTMLElement | null>) {
  const reduceMotion = useReducedMotion();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || reduceMotion || document.documentElement.dataset.appleInput !== "pointer" || typeof node.animate !== "function") return;
    const animation = node.animate([{opacity:.55,transform:"translateY(24px) scale(.97)"},{opacity:1,transform:"translateY(0px) scale(1)"}],{duration:motionTokens.duration.sheet*1000,easing:"cubic-bezier(.23,1,.32,1)",fill:"none"});
    return () => animation.cancel();
  },[ref,reduceMotion]);
}
