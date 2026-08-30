const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const target = process.env.TARGET_URL || "http://localhost:3000";
const out = path.resolve(
  process.env.PW_ARTIFACT_DIR ||
    "playwright-artifacts/latest-commerce-regression",
);
fs.mkdirSync(out, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label}: horizontal overflow ${dimensions.scrollWidth} > ${dimensions.clientWidth}`,
  );
}

async function waitForInventory(page) {
  await page
    .getByRole("heading", { name: /(?:拍卖|直购)专区 · \d+ 条采购线索/ })
    .waitFor({ timeout: 45_000 });
  await page.locator(".js-product-card").first().waitFor({ timeout: 45_000 });
}

function validateSharePayload(payload, expectedCount) {
  assert(payload.itemCount === expectedCount, "share item count is incorrect");
  assert(payload.items?.length === expectedCount, "share items are missing");
  assert(typeof payload.text === "string", "share text is missing");
  const blocks = payload.text.split("\n\n");
  assert(blocks.length === expectedCount, "products are not separated by a blank line");
  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index];
    const url = new URL(item.sourceUrl);
    assert(/^https?:$/.test(url.protocol), "share URL is not public HTTP(S)");
    assert(!url.pathname.startsWith("/share/"), "share URL points at an internal page");
    assert(
      blocks[index] === `${item.title}\n${item.sourceUrl}`,
      "share block is not title + newline + original URL",
    );
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { viewports: {}, pageErrors: [] };
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    desktop.on("pageerror", (error) => report.pageErrors.push(error.message));
    await desktop.goto(target, { waitUntil: "domcontentloaded" });
    await waitForInventory(desktop);
    await assertNoOverflow(desktop, "desktop inventory");

    await desktop.getByRole("heading", { name: "30 分钟临期拍卖" }).waitFor();
    await desktop.getByRole("tab", { name: /^拍卖 · \d+/ }).waitFor();
    await desktop
      .getByRole("heading", { name: /直购专区 · \d+ 条采购线索/ })
      .waitFor();
    const auctionResponsePromise = desktop.waitForResponse((response) => {
      if (response.request().method() !== "GET") return false;
      try {
        const url = new URL(response.url());
        return (
          url.pathname.endsWith("/items") &&
          url.searchParams.get("listingType") === "auction" &&
          !url.searchParams.has("auctionMinutes")
        );
      } catch {
        return false;
      }
    });
    await desktop.getByRole("tab", { name: /^拍卖 · \d+/ }).click();
    const auctionPayload = await (await auctionResponsePromise).json();
    assert(
      auctionPayload.items.every((item) => item.listingType === "auction"),
      "auction inventory response contains direct items",
    );
    await desktop
      .getByRole("heading", { name: /拍卖专区 · \d+ 条采购线索/ })
      .waitFor();
    const directResponsePromise = desktop.waitForResponse((response) => {
      if (response.request().method() !== "GET") return false;
      try {
        const url = new URL(response.url());
        return url.pathname.endsWith("/items") && url.searchParams.get("listingType") === "direct";
      } catch {
        return false;
      }
    });
    await desktop.getByRole("tab", { name: /^直购 · \d+/ }).click();
    const directPayload = await (await directResponsePromise).json();
    assert(
      directPayload.items.every((item) => item.listingType === "direct"),
      "direct inventory response contains auction items",
    );

    const firstCard = desktop.locator(".js-product-card").first();
    await firstCard.getByRole("button", { name: /采购备注/ }).click();
    const noteInput = firstCard.getByRole("textbox", { name: "采购备注" });
    assert((await noteInput.getAttribute("maxlength")) === "25", "note limit is not 25");
    await noteInput.press("Escape");

    await firstCard.getByRole("button", { name: "标记为不感兴趣" }).click();
    const ignoreDialog = desktop.getByRole("alertdialog", { name: "移入不感兴趣？" });
    await ignoreDialog.waitFor();
    await ignoreDialog.getByRole("button", { name: "取消" }).click();

    const itemIds = await desktop.locator(".js-product-card").evaluateAll((cards) =>
      cards
        .slice(0, 2)
        .map((card) => card.getAttribute("data-item-id"))
        .filter(Boolean),
    );
    assert(itemIds.length === 2, "not enough inventory cards for share regression");
    const singleShare = await desktop.evaluate(async (ids) => {
      const response = await fetch("/backend/cart/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [ids[0]] }),
      });
      if (!response.ok) throw new Error(`single share API ${response.status}`);
      return response.json();
    }, itemIds);
    validateSharePayload(singleShare, 1);
    const multiShare = await desktop.evaluate(async (ids) => {
      const response = await fetch("/backend/cart/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: ids }),
      });
      if (!response.ok) throw new Error(`multi share API ${response.status}`);
      return response.json();
    }, itemIds);
    validateSharePayload(multiShare, 2);

    await desktop.getByRole("button", { name: "工作台", exact: true }).click();
    await desktop.getByRole("heading", { name: "工作台", exact: true }).waitFor();
    await desktop.getByRole("button", { name: "收藏", exact: true }).click();
    await desktop.getByRole("heading", { name: "收藏", exact: true }).waitFor();
    const favoriteTabs = desktop.locator('[aria-label="收藏商品类型"] [role="tab"]');
    if ((await favoriteTabs.count()) > 0) {
      assert((await favoriteTabs.count()) === 2, "favorites are not split into two tabs");
      await desktop.getByRole("tab", { name: /^拍卖 · \d+/ }).click();
      const auctionSort = desktop.getByLabel("排序");
      assert(
        (await auctionSort.locator('option[value="ending-asc"]').count()) === 1,
        "auction countdown sorting is missing",
      );
      assert(
        (await desktop.locator(".favorite-mini-card").first().getByRole("button", { name: /采购备注/ }).count()) <= 1,
        "favorite note control is duplicated",
      );
    }
    await desktop.screenshot({ path: path.join(out, "desktop-favorites.png"), fullPage: true });

    await desktop.getByRole("button", { name: "发现", exact: true }).click();
    await desktop.getByRole("heading", { name: "发现", exact: true }).waitFor();
    await desktop.locator(".discovery-active-card").waitFor({ timeout: 45_000 });
    assert(
      (await desktop.locator(".discovery-card-shell").evaluate((node) => getComputedStyle(node).overflow)) ===
        "visible",
      "discovery card stack clips swipe animation",
    );
    await desktop.getByRole("button", { name: /^拍卖(?: \d+)?$/ }).click();
    await desktop.locator(".discovery-active-card").waitFor({ timeout: 45_000 });
    await desktop
      .locator('[role="progressbar"][aria-label^="拍卖剩余时间"]')
      .first()
      .waitFor({ timeout: 45_000 });
    const discoveryNote = desktop
      .locator(".discovery-active-card")
      .getByRole("button", { name: /采购备注/ });
    assert((await discoveryNote.count()) === 1, "discovery note control is missing");
    await assertNoOverflow(desktop, "desktop discovery");
    await desktop.screenshot({ path: path.join(out, "desktop-discovery.png"), fullPage: true });
    report.viewports.desktop = { share: "original URLs", discovery: "auction countdown" };
    await desktop.close();

    for (const viewport of [
      { name: "mobile-390", width: 390, height: 844 },
      { name: "mobile-320", width: 320, height: 720 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      await page.goto(target, { waitUntil: "domcontentloaded" });
      await waitForInventory(page);
      await assertNoOverflow(page, `${viewport.name} inventory`);
      await page.getByRole("button", { name: "发现", exact: true }).click();
      await page.getByRole("heading", { name: "发现", exact: true }).waitFor();
      const card = page.locator(".discovery-active-card");
      await card.waitFor({ timeout: 45_000 });
      const cardBox = await card.boundingBox();
      assert(cardBox && cardBox.height < viewport.height - 100, `${viewport.name} discovery card is too tall`);
      assert(
        (await card.evaluate((node) => getComputedStyle(node).touchAction)) === "pan-y",
        `${viewport.name} card blocks vertical page gestures`,
      );
      await assertNoOverflow(page, `${viewport.name} discovery`);
      await page.screenshot({ path: path.join(out, `${viewport.name}.png`), fullPage: true });
      report.viewports[viewport.name] = {
        cardHeight: Math.round(cardBox.height),
        touchAction: "pan-y",
      };
      await context.close();
    }

    assert(report.pageErrors.length === 0, `page errors: ${report.pageErrors.join(" | ")}`);
    console.log(JSON.stringify(report, null, 2));
    console.log("PASS latest commerce requirements on desktop, 390px and 320px");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
