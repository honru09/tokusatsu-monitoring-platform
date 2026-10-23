"use client";
import { useEffect } from "react";

/** Visibility and input modality are shared by CSS feedback, never business state. */
export function AmbientMotionState() {
  useEffect(() => {
    const root = document.documentElement;
    const prepared = new WeakSet<HTMLElement>();
    let pressed: HTMLElement | null = null;
    const release = () => {
      if (pressed) delete pressed.dataset.applePressed;
      pressed = null;
    };
    const update = () => {
      root.dataset.motionPaused = String(document.hidden);
      if (document.hidden) release();
    };
    const pointer = (event: PointerEvent) => {
      root.dataset.appleInput = "pointer";
      release();
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(
        'button, summary, a[role="button"], input[type="checkbox"], input[type="radio"]',
      );
      if (!control || !control.closest('.procurement-shell, .shell-overlay-root') ||
          control.matches(':disabled, [aria-disabled="true"], [data-apple-motion-owned], [data-apple-feedback="off"]') ||
          control.closest('[inert]')) return;
      const bounds = control.getBoundingClientRect();
      if (!prepared.has(control)) {
        control.style.setProperty('--apple-rest-image', getComputedStyle(control).backgroundImage);
        control.dataset.appleFeedbackReady = "true";
        prepared.add(control);
      }
      control.style.setProperty('--apple-touch-x', `${event.clientX - bounds.left}px`);
      control.style.setProperty('--apple-touch-y', `${event.clientY - bounds.top}px`);
      control.dataset.applePressed = "true";
      pressed = control;
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey ||
          !['Tab', 'Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      root.dataset.appleInput = "keyboard";
      release();
    };
    update();
    root.dataset.appleInput = "keyboard";
    document.addEventListener("visibilitychange", update);
    document.addEventListener("pointerdown", pointer, { capture: true, passive: true });
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("keydown", keyboard, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("blur", release);
      delete root.dataset.motionPaused;
      delete root.dataset.appleInput;
      document.querySelectorAll<HTMLElement>('[data-apple-feedback-ready="true"]').forEach(control => {
        delete control.dataset.appleFeedbackReady;
        ['--apple-rest-image', '--apple-touch-x', '--apple-touch-y'].forEach(property => control.style.removeProperty(property));
      });
    };
  }, []);
  return null;
}
