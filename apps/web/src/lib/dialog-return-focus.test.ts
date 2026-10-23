// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  captureDialogReturnFocus,
  restoreDialogReturnFocus,
} from "./dialog-return-focus";

describe("dialog return focus", () => {
  it("returns focus to the captured product card after the dialog closes", () => {
    const card = document.createElement("article");
    card.tabIndex = -1;
    document.body.append(card);
    card.focus();
    const target = captureDialogReturnFocus();

    const closeButton = document.createElement("button");
    document.body.append(closeButton);
    closeButton.focus();

    restoreDialogReturnFocus(target);

    expect(document.activeElement).toBe(card);
    card.remove();
    closeButton.remove();
  });

  it("does not focus a product card that left the document", () => {
    const card = document.createElement("article");
    card.tabIndex = -1;
    document.body.append(card);
    card.focus();
    const focus = vi.spyOn(card, "focus");
    const target = captureDialogReturnFocus();
    card.remove();

    restoreDialogReturnFocus(target);

    expect(focus).not.toHaveBeenCalled();
  });
});
