"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

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

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setDraft((value ?? "").slice(0, maxLength));
    setError("");
  }, [maxLength, open, value]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, saving]);

  if (!mounted || !open) return null;

  async function save() {
    const next = draft.trim().slice(0, maxLength);
    setSaving(true);
    setError("");
    try {
      await onSave(next || null);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "备注保存失败");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-[120] grid place-items-center bg-ink/45 p-4"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-panel note-dialog w-full max-w-sm rounded-[22px] bg-white p-4 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-[17px] font-semibold leading-6 text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭备注"
            className="grid h-11 w-11 place-items-center rounded-full bg-fog text-xl leading-none text-ink/60 disabled:opacity-40"
          >
            ×
          </button>
        </div>
        <label className="mt-3 block">
          <span className="sr-only">采购备注，最多 {maxLength} 字</span>
          <textarea
            autoFocus
            value={draft}
            maxLength={maxLength}
            rows={3}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value.slice(0, maxLength))}
            placeholder={`最多 ${maxLength} 字`}
            className="min-h-[96px] w-full resize-none rounded-2xl border border-ink/10 bg-fog/55 px-3 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink/35"
          />
        </label>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] tabular-nums text-ink/40">
            {draft.length}/{maxLength}
          </span>
          {error && (
            <span role="alert" className="min-w-0 flex-1 truncate text-right text-xs text-rust">
              {error}
            </span>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-xl bg-fog px-4 text-sm font-semibold text-ink disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[#0071e3] px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
