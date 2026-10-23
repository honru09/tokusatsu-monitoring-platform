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

export type PurchaseReceiptPreviewRequest = {
  endpoint: string;
  fileName: string;
  mimeType: string;
};

type Preview = {
  objectUrl: string;
  fileName: string;
  mimeType: string;
};

function receiptBlob(dataBase64: string, mimeType: string) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function PurchaseReceiptPreviewDialog({
  request,
  onClose,
}: {
  request: PurchaseReceiptPreviewRequest | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    if (!request) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [request]);

  useEffect(() => {
    if (!request) {
      setPreview(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPreview(null);
    setLoading(true);
    setError("");
    void fetch(request.endpoint, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API ${response.status}`);
        return (await response.json()) as {
          dataBase64?: string;
          fileName?: string;
          mimeType?: string;
        };
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!payload.dataBase64) throw new Error("凭证文件内容为空");
        const mimeType =
          payload.mimeType || request.mimeType || "application/octet-stream";
        objectUrl = URL.createObjectURL(
          receiptBlob(payload.dataBase64, mimeType),
        );
        setPreview({
          objectUrl,
          fileName: payload.fileName || request.fileName,
          mimeType,
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "凭证读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
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
  }, [onClose, request]);

  if (!request) return null;

  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[120] grid place-items-center overflow-y-auto bg-ink/55 p-4"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-panel flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-paper shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-ink/10 px-4 py-2">
          <h2
            id={titleId}
            className="min-w-0 truncate text-base font-semibold text-ink"
          >
            {preview?.fileName ?? request.fileName}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭凭证预览"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fog text-xl leading-none text-ink/65"
          >
            ×
          </button>
        </header>
        <div className="grid min-h-48 flex-1 place-items-center overflow-auto p-4">
          {loading ? (
            <p role="status" className="text-sm text-ink/60">
              正在读取凭证…
            </p>
          ) : error ? (
            <p role="alert" className="text-sm font-semibold text-rust">
              {error}
            </p>
          ) : preview?.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated Blob URL is not compatible with next/image.
            <img
              src={preview.objectUrl}
              alt={`购买凭证：${preview.fileName}`}
              className="max-h-[70dvh] max-w-full object-contain"
            />
          ) : preview ? (
            <div className="grid justify-items-center gap-4 text-center">
              <p className="break-all text-sm font-semibold text-ink">
                {preview.fileName}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={preview.objectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white"
                >
                  打开文件
                </a>
                <a
                  href={preview.objectUrl}
                  download={preview.fileName}
                  className="inline-flex min-h-11 items-center rounded-xl bg-fog px-4 text-sm font-semibold text-ink"
                >
                  下载文件
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}
