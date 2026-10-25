// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailSellerMeta } from "./detail-seller-meta";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(props: Parameters<typeof DetailSellerMeta>[0]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<DetailSellerMeta {...props} />));
  return host;
}

const LONG_UNBREAKABLE =
  "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz";

describe("detail seller and note section", () => {
  it("keeps an unbreakable seller name whole in the DOM", () => {
    render({
      seller: { id: "s1", name: LONG_UNBREAKABLE },
      note: null,
      onOpenSeller: () => undefined,
    });
    const name = host!.querySelector(".detail-seller-name");
    expect(name?.textContent).toBe(LONG_UNBREAKABLE);
    // The wrap side of this fixture is pinned by detail-css.contract.test.ts:
    // .detail-seller-name carries overflow-wrap: anywhere inside a
    // min-width: 0 row, so the token breaks instead of pushing the layout.
  });

  it("shows an explicit unknown state when the seller is missing", () => {
    render({ seller: null, note: null });
    expect(host!.textContent).toContain("卖家未知");
    expect(host!.querySelector(".detail-seller-action")).toBeNull();
  });

  it("opens the seller view from the same-store action", () => {
    const onOpenSeller = vi.fn();
    render({
      seller: { id: "seller-9", name: "测试卖家" },
      note: null,
      onOpenSeller,
    });
    const button = host!.querySelector<HTMLButtonElement>(
      ".detail-seller-action",
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(onOpenSeller).toHaveBeenCalledWith("seller-9");
  });

  it("carries the full purchase note text and hides the block without one", () => {
    const note = "外盒有凹痕，先问卖家能否同捆另一件再下单。".repeat(4);
    render({ seller: { name: "卖家甲" }, note });
    expect(host!.querySelector(".detail-team-note")?.textContent).toContain(
      note,
    );
    expect(host!.textContent).toContain("采购备注");
  });

  it("renders no note block when the item has no note", () => {
    render({ seller: { name: "卖家甲" }, note: null });
    expect(host!.querySelector(".detail-team-note")).toBeNull();
  });
});
