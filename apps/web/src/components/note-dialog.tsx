"use client";

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./transaction-feedback.module.css";

const DEFAULT_MAX_LENGTH = 25;

export function NoteDialog({
  open,
  value,
  onClose,
  onSave,
  title = "采购备注",
  maxLength = DEFAULT_MAX_LENGTH,
}: {
  open: boolean;
  value?: string | null;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void> | void;
  title?: string;
  maxLength?: number;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sourceValueRef = useRef(value);
  sourceValueRef.current = value;
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const closingRef = useRef(false);
  const animationRef = useRef<Animation | null>(null);
  const pointerInputRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setDraft((sourceValueRef.current ?? "").slice(0, maxLength));
    setError("");
    setSaved(false);
    closingRef.current = false;
  }, [maxLength, open]);
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    pointerInputRef.current = Boolean(returnFocusRef.current && !returnFocusRef.current.matches(":focus-visible"));
    const panel = dialogRef.current;
    if (panel && pointerInputRef.current && !reduceMotion && typeof panel.animate === "function") animationRef.current = panel.animate([{ opacity:0, transform:"translateY(18px) scale(.96)" }, { opacity:1, transform:"translateY(0px) scale(1)" }], { duration:motionTokens.duration.sheet * 1000, easing:"cubic-bezier(.23,1,.32,1)", fill:"none" });
    textareaRef.current?.focus();
    return () => {
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus();
      animationRef.current?.cancel();
    };
  }, [mounted, open, reduceMotion]);
  function close() {
    if (closingRef.current) return;
    const panel = dialogRef.current;
    const opacity = panel ? getComputedStyle(panel).opacity : "1";
    const transform = panel ? getComputedStyle(panel).transform : "none";
    animationRef.current?.cancel();
    if (!panel || reduceMotion || !pointerInputRef.current || typeof panel.animate !== "function") { onClose(); return; }
    closingRef.current = true;
    panel.inert = true;
    const animation = panel.animate([{ opacity, transform }, { opacity:0, transform:"translateY(12px) scale(.97)" }], { duration:motionTokens.duration.fast * 1000, easing:"cubic-bezier(.23,1,.32,1)", fill:"none" });
    animationRef.current = animation;
    void animation.finished.then(onClose).catch(() => undefined);
  }
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        pointerInputRef.current = false;
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, saving]);

  if (!mounted || !open) return null;

  async function save() {
    if (savingRef.current || closingRef.current) return;
    savingRef.current = true;
    const next = draft.trim().slice(0, maxLength);
    setSaving(true);
    setError("");
    try {
      await onSave(next || null);
      setSaved(true);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "备注保存失败");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[120] grid place-items-center bg-ink/45 p-4"
      onMouseDown={() => {
        if (!savingRef.current) close();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal-panel note-dialog ${styles.dialog} w-full max-w-[320px] rounded-[18px] bg-white p-3 shadow-modal`}
        aria-busy={saving}
        data-submit-state={error ? "error" : saved ? "saved" : saving ? "saving" : "idle"}
        onPointerDownCapture={() => { pointerInputRef.current = true; }}
        onKeyDownCapture={() => { pointerInputRef.current = false; }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="text-[17px] font-semibold leading-6 text-ink"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="关闭备注"
            className="grid h-11 w-11 place-items-center rounded-full bg-fog text-xl leading-none text-ink/60 disabled:opacity-40"
          >
            ×
          </button>
        </div>
        <label className="mt-2 block">
          <span className="sr-only">采购备注，最多 {maxLength} 字</span>
          <textarea
            ref={textareaRef}
            value={draft}
            maxLength={maxLength}
            rows={2}
            disabled={saving}
            onChange={(event) =>
              setDraft(event.target.value.slice(0, maxLength))
            }
            placeholder={`最多 ${maxLength} 字`}
            className="min-h-[72px] w-full resize-none rounded-xl border border-ink/10 bg-fog/55 px-3 py-2.5 text-sm leading-5 text-ink placeholder:text-ink/60 focus-visible:border-moss/40 focus-visible:ring-4 focus-visible:ring-moss/15"
          />
        </label>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] tabular-nums text-ink/65">
            {draft.length}/{maxLength}
          </span>
          {error && (
            <span
              role="alert"
              className={`${styles.error} min-w-0 flex-1 text-right text-xs text-rust`}
            >
              {error}
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="min-h-11 rounded-xl bg-fog px-4 text-sm font-semibold text-ink disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={`${styles.submit} min-h-11 rounded-xl bg-moss px-4 text-sm font-semibold text-white disabled:opacity-40`}
          >
            {saved ? "已保存 ✓" : saving ? "保存中" : "保存"}
          </button>
        </div>
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}
