// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PurchaseReceiptPreviewDialog,
  type PurchaseReceiptPreviewRequest,
} from "./purchase-receipt-preview-dialog";

const request: PurchaseReceiptPreviewRequest = {
  endpoint: "/backend/items/item-1/purchase/receipts/receipt-1",
  fileName: "付款截图.png",
  mimeType: "image/png",
};

function Harness() {
  const [preview, setPreview] = useState<PurchaseReceiptPreviewRequest | null>(
    null,
  );
  return (
    <>
      <button type="button" onClick={() => setPreview(request)}>
        打开凭证
      </button>
      <PurchaseReceiptPreviewDialog
        request={preview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

describe("PurchaseReceiptPreviewDialog", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const createObjectURL = vi.fn(() => "blob:receipt-preview");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  async function openWith(mimeType: string, fileName: string) {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mimeType,
          fileName,
          dataBase64: "aGVsbG8=",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const trigger = host.querySelector("button");
    if (!(trigger instanceof HTMLButtonElement))
      throw new Error("凭证触发按钮不存在");
    trigger.focus();
    await act(async () => {
      trigger.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    return trigger;
  }

  it("previews an image in the centered portal and never opens a delayed popup", async () => {
    const openSpy = vi.spyOn(window, "open");
    await openWith("image/png", "付款截图.png");

    const dialog = document.body.querySelector('[role="dialog"]');
    const image = document.body.querySelector(
      'img[src="blob:receipt-preview"]',
    );
    expect(dialog).toBeInstanceOf(HTMLElement);
    expect(dialog?.closest(".modal-backdrop")?.classList).toContain(
      "place-items-center",
    );
    expect(image?.getAttribute("alt")).toContain("付款截图.png");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("revokes the Blob URL and restores focus after Escape closes the dialog", async () => {
    const trigger = await openWith("image/png", "付款截图.png");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-preview");
    expect(document.activeElement).toBe(trigger);
  });

  it("offers direct user-gesture links for a non-image receipt", async () => {
    await openWith("application/pdf", "付款凭证.pdf");

    const links = Array.from(document.body.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual([
      "打开文件",
      "下载文件",
    ]);
    expect(links[0]?.getAttribute("href")).toBe("blob:receipt-preview");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[1]?.getAttribute("download")).toBe("付款凭证.pdf");
  });
});
