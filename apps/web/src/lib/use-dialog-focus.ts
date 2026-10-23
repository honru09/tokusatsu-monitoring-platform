"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  captureDialogReturnFocus,
  restoreDialogReturnFocus,
} from "./dialog-return-focus";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !Array.from(dialog.querySelectorAll("details:not([open])")).some(
        (details) =>
          details.contains(element) &&
          !details.querySelector(":scope > summary")?.contains(element),
      ),
  );
}

/**
 * Keeps a modal keyboard-scoped and restores the control that opened it.
 * The dialog may stay mounted; `active` owns the complete focus lifecycle.
 */
export function useDialogFocus<
  TDialog extends HTMLElement,
  TInitial extends HTMLElement,
>({
  active,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
  onClose,
}: {
  active: boolean;
  dialogRef: RefObject<TDialog | null>;
  initialFocusRef?: RefObject<TInitial | null>;
  /**
   * Use the known trigger when a pointer activation has not focused it before
   * React commits the dialog. Falls back to the currently focused element.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!active) return;
    const returnTarget = returnFocusRef?.current ?? captureDialogReturnFocus();
    const dialog = dialogRef.current;
    const initialTarget =
      initialFocusRef?.current ??
      (dialog ? focusableElements(dialog)[0] : undefined) ??
      dialog;
    initialTarget?.focus({ preventScroll: true });

    return () => restoreDialogReturnFocus(returnTarget);
  }, [active, dialogRef, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (current === last || !dialog.contains(current))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, dialogRef]);
}
