import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("dashboard modal accessibility wiring", () => {
  it("uses the shared focus scope for item details, AI analysis, settings and filters", () => {
    expect(source).toMatch(
      /function DetailDrawer[\s\S]*?useDialogFocus\(\{[\s\S]*?initialFocusRef:\s*closeRef/,
    );
    expect(source).toMatch(
      /function MarketAnalysisDialog[\s\S]*?useDialogFocus\(\{[\s\S]*?initialFocusRef:\s*closeRef/,
    );
    expect(source).toMatch(
      /active:\s*settingsOpen,[\s\S]*?dialogRef:\s*settingsDialogRef,[\s\S]*?initialFocusRef:\s*settingsCloseRef/,
    );
    expect(source).toMatch(
      /active:\s*filtersOpen,[\s\S]*?dialogRef:\s*filterDialogRef,[\s\S]*?initialFocusRef:\s*filterCloseRef,[\s\S]*?returnFocusRef:\s*filterTriggerRef/,
    );
  });

  it("keeps receipt modals locked without leaving the account gate's mobile scroll lock behind", () => {
    expect(source).toMatch(
      /!settingsOpen\s*&&\s*!purchaseReceiptPreview\s*&&\s*!sellerId/,
    );
    expect(source).toMatch(
      /\[\s*analysisOpen,\s*settingsOpen,\s*purchaseReceiptPreview,/,
    );
    expect(source).not.toMatch(
      /!settingsOpen\s*&&\s*!accountGateOpen\s*&&\s*!purchaseReceiptPreview/,
    );
  });
});
