"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getShellOverlayRoot } from "../lib/shell-overlay";

type IconProps = { className?: string };

function InfoIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v5M12 7.5h.01" />
    </svg>
  );
}

function CloseIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * The little "i" button that opens a short explanation dialog. It was
 * defined inside page.tsx while only the dashboard used it; the
 * purchase-records extraction needs it too, so it lives here now and
 * both import it.
 */
export function ContextInfo({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeInfo = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInfo();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeInfo, open]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink/50 transition-colors hover:text-moss"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full border border-ink/12 bg-white/75 shadow-sm">
          <InfoIcon className="h-4 w-4" />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            className="modal-backdrop absolute inset-0 z-[85] grid place-items-center bg-ink/45 p-4"
            onMouseDown={closeInfo}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="modal-panel w-full max-w-sm rounded-3xl bg-paper p-4 shadow-modal"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id={titleId} className="pt-2 text-base font-bold text-ink">
                  {title}
                </h2>
                <button
                  type="button"
                  autoFocus
                  onClick={closeInfo}
                  aria-label={`关闭${title}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink shadow-sm"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="mt-2 text-sm leading-6 text-ink/65">
                {children}
              </div>
            </section>
          </div>,
          getShellOverlayRoot(),
        )}
    </>
  );
}
