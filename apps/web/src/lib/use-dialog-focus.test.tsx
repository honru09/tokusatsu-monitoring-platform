// @vitest-environment jsdom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "./use-dialog-focus";

function Harness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    active: open,
    dialogRef,
    initialFocusRef: closeRef,
    returnFocusRef: triggerRef,
    onClose: () => setOpen(false),
  });

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开弹窗
      </button>
      {open && (
        <section ref={dialogRef} role="dialog" tabIndex={-1}>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)}>
            关闭
          </button>
          <button type="button">末尾操作</button>
        </section>
      )}
    </>
  );
}

describe("useDialogFocus", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function openDialog({ focusTrigger = true } = {}) {
    const trigger = host.querySelector("button");
    if (!(trigger instanceof HTMLButtonElement))
      throw new Error("弹窗触发按钮不存在");
    if (focusTrigger) trigger.focus();
    act(() => trigger.click());
    const dialog = host.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) throw new Error("弹窗不存在");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    return { trigger, dialog, first: buttons[0], last: buttons[1] };
  }

  it("focuses the preferred control and traps Tab in both directions", () => {
    const { first, last } = openDialog();
    expect(document.activeElement).toBe(first);

    last.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("closes with Escape and restores the opening control", () => {
    const { trigger } = openDialog();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("focuses disclosure summaries but skips controls inside closed details", () => {
    const { dialog, first } = openDialog();
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "编辑信息";
    const hiddenInput = document.createElement("input");
    details.append(summary, hiddenInput);
    dialog.append(details);
    first.focus();
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(summary);
    details.open = true;
    first.focus();
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(hiddenInput);
  });

  it("restores an explicit trigger when pointer activation began from body", () => {
    const { trigger } = openDialog({ focusTrigger: false });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
