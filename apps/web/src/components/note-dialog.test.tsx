// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteDialog } from "./note-dialog";

function DialogHarness({ onSave }: { onSave: (note: string | null) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开备注
      </button>
      <NoteDialog
        open={open}
        value=""
        onClose={() => setOpen(false)}
        onSave={onSave}
      />
    </>
  );
}

describe("NoteDialog keyboard focus", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onSave = vi.fn();
    act(() => root.render(<DialogHarness onSave={onSave} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function openDialog() {
    const trigger = host.querySelector("button");
    if (!(trigger instanceof HTMLButtonElement))
      throw new Error("备注触发按钮不存在");
    trigger.focus();
    act(() => trigger.click());
    const textarea = document.body.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement))
      throw new Error("备注输入框不存在");
    return { trigger, textarea };
  }

  it("traps forward and reverse Tab navigation inside the dialog", () => {
    const { textarea } = openDialog();
    expect(document.activeElement).toBe(textarea);

    const close = document.body.querySelector('[aria-label="关闭备注"]');
    const save = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(close).toBeInstanceOf(HTMLButtonElement);
    expect(save).toBeInstanceOf(HTMLButtonElement);

    (save as HTMLButtonElement).focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(close);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(save);
  });

  it("uses the compact note panel and input height", () => {
    openDialog();
    const dialog = document.body.querySelector('[role="dialog"]');
    const textarea = document.body.querySelector("textarea");

    expect(dialog?.classList.contains("max-w-[320px]")).toBe(true);
    expect(textarea?.classList.contains("min-h-[72px]")).toBe(true);
    expect(textarea?.getAttribute("rows")).toBe("2");
  });

  it("deduplicates same-frame saves and keeps the dialog available after a failed save", async () => {
    let rejectSave: (reason: Error) => void = () => undefined;
    onSave.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const { textarea } = openDialog();
    const save = Array.from(document.body.querySelectorAll("button")).find(button => button.textContent === "保存")!;
    act(() => { save.click(); save.click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
    await act(async () => { rejectSave(new Error("服务器暂时不可用")); await Promise.resolve(); });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("服务器暂时不可用");
    expect(document.body.querySelector("textarea")).toBe(textarea);
    expect(save.disabled).toBe(false);
  });

  it.each(["save", "cancel", "escape", "backdrop"] as const)(
    "restores the real trigger after closing through %s",
    async (method) => {
      const { trigger } = openDialog();

      if (method === "escape") {
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      } else if (method === "backdrop") {
        const backdrop = document.body.querySelector(".modal-backdrop");
        if (!(backdrop instanceof HTMLElement))
          throw new Error("备注背景不存在");
        act(() => {
          backdrop.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true }),
          );
        });
      } else {
        const label = method === "save" ? "保存" : "取消";
        const button = Array.from(
          document.body.querySelectorAll("button"),
        ).find((candidate) => candidate.textContent === label);
        if (!(button instanceof HTMLButtonElement))
          throw new Error(`${label}按钮不存在`);
        await act(async () => {
          button.click();
          await Promise.resolve();
        });
      }

      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(onSave).toHaveBeenCalledTimes(method === "save" ? 1 : 0);
    },
  );
});
