import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const workbenchSource = readFileSync(
  new URL("../components/workbench-workspace.tsx", import.meta.url), "utf8",
);

describe("dashboard navigation and listing transition contracts", () => {
  it("restores each workspace position when switching away and back", () => {
    expect(source).toMatch(
      /function navigateWorkspace[\s\S]*?const nextScroll = workspaceScrollRef\.current\.get\(nextState\.workspace\) \?\? 0;[\s\S]*?pendingWorkspaceScrollRestoreRef\.current = \{[\s\S]*?workspace: nextState\.workspace,[\s\S]*?top: nextScroll/,
    );
    expect(source).toMatch(
      /function goBackWorkspace[\s\S]*?const previousScroll =[\s\S]*?pendingWorkspaceScrollRestoreRef\.current = \{[\s\S]*?workspace: previousState\.workspace,[\s\S]*?top: previousScroll/,
    );
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?pending\.workspace !== workspace[\s\S]*?restoreWorkspaceScroll\(pending\.top, workspaceScrollContainerRef\.current/,
    );
    expect(source).toMatch(
      /function currentWorkspaceScrollTop[\s\S]*?readWorkspaceScrollTop\(\s*workspaceScrollContainerRef\.current,\s*window\.scrollY/,
    );
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain('window.addEventListener("pagehide"');
    expect(source).toMatch(/ref=\{workspaceScrollContainerRef\}/);
  });

  it("clears stale listing results before switching transaction type", () => {
    expect(source).toMatch(
      /function changeListingMode\(mode: ListingType\)[\s\S]*?beginInventoryQueryTransition\(\);[\s\S]*?setListingMode\(mode\);/,
    );
    expect(source).toMatch(
      /function beginInventoryQueryTransition\(\)[\s\S]*?setItems\(\[\]\);[\s\S]*?setTotal\(0\);/,
    );
  });

  it("cancels stale inventory requests before a newer result can commit", () => {
    expect(source).toMatch(/inventoryRequestRef\.current\?\.abort\(\);/);
    expect(source).toMatch(/signal: controller\.signal/);
    expect(source).toMatch(
      /controller\.signal\.aborted \|\|[\s\S]*?inventoryRequestVersionRef\.current !== requestVersion \|\|[\s\S]*?inventoryQueryKeyRef\.current !== requestQueryKey/,
    );
  });

  it("keeps browser and system Back in sync with nested workspaces", () => {
    expect(source).toMatch(/window\.history\.pushState\(/);
    expect(source).toMatch(/window\.addEventListener\("popstate"/);
    expect(source).toMatch(/parseWorkspaceHistoryState\(/);
  });

  it("keeps purchase history discoverable from the workbench", () => {
    expect(workbenchSource).toMatch(/\["purchases",\s*TERMS\.purchases,/);
    expect(source).toMatch(/<WorkbenchWorkspace[\s\S]*?onNavigate=\{navigateWorkspace\}/);
  });

  it("keeps purchase history and inventory orders in separate workspaces", () => {
    expect(workbenchSource).toMatch(/\["orders",\s*TERMS\.orders,/);
    const purchasesStart = source.indexOf('{workspace === "purchases" && (');
    const ordersStart = source.indexOf('{workspace === "orders" && (');
    const purchasesWorkspace = source.slice(purchasesStart, ordersStart);
    expect(purchasesStart).toBeGreaterThan(-1);
    expect(ordersStart).toBeGreaterThan(purchasesStart);
    expect(purchasesWorkspace).toContain("<PurchaseRecordsPanel");
    expect(purchasesWorkspace).not.toContain("<InventoryOrdersWorkspace");
    expect(source.slice(ordersStart)).toContain("<InventoryOrdersWorkspace");
  });

  it("portals the manager gate into the viewport overlay host", () => {
    expect(source).toContain("setShellOverlayRoot(getShellOverlayRoot())");
    expect(source).toMatch(
      /accountGateOpen[\s\S]*?createPortal\([\s\S]*?<ManagerAccountGate[\s\S]*?shellOverlayRoot/,
    );
  });

  it("gives a lone urgent auction the full mobile content width", () => {
    expect(source).toContain(
      "urgent-auction-grid procurement-grid mt-3 grid auto-rows-max grid-cols-1",
    );
    expect(source).toContain("sm:grid-cols-2 md:grid-cols-3");
  });

  it("keeps the thirty-minute auction area collapsed behind a native drawer", () => {
    expect(source).toContain(
      '<details\n              className="urgent-auction-zone urgent-auction-drawer',
    );
    expect(source).toContain(
      '<summary className="urgent-auction-drawer-summary">',
    );
    expect(source).toContain("urgent-auction-drawer-body");
    expect(source).not.toContain("<details open");
  });
});
