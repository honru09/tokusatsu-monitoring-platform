const {
  chromium,
} = require("../../workers/crawlers/node_modules/playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const target = process.env.EDITORIAL_UI_URL || "http://localhost:3000";
const artifactDir = path.resolve("work/editorial-upgrade/operations-browser");
fs.mkdirSync(artifactDir, { recursive: true });
const title =
  "S.H.Figuarts 真骨彫製法 仮面ライダー：完整配件、长中日文商品标题与整批采购核算";
const order = {
  id: "editorial-order",
  orderNumber: "ORD-EDITORIAL",
  name: title,
  platform: "Mercari",
  purchaseCost: 123456789,
  initialQuantity: 30,
  remainingQuantity: 17,
  soldQuantity: 13,
  totalSales: 90000000,
  status: "partially_sold",
  statusLabel: "部分售出",
  averageCost: 4115226,
  realizedProfit: 36502057,
  recoveryPercent: 72.9,
  finalOrderProfit: null,
  finalOrderMarginPercent: null,
  purchasedAt: "2026-10-09T04:00:00Z",
  imageUrl: `${target}/brand-icon.svg`,
  note: "保留完整采购备注，不将备注替代商品名",
};
const config = {
  keywords: [
    {
      id: "kw-editorial",
      keyword: "S.H.Figuarts 真骨彫製法",
      enabled: true,
      intervalMinutes: 60,
      categoryId: "cat-editorial",
      category: { id: "cat-editorial", name: "假面骑士 SHF" },
      sourceKeys: [],
      _count: { matches: 1234 },
      lastRunAt: "2026-10-09T04:00:00Z",
    },
  ],
  categories: [
    {
      id: "cat-editorial",
      name: "假面骑士 SHF",
      scope: "toys",
      parentId: null,
      _count: { items: 1234 },
    },
    {
      id: "cat-other",
      name: "其他学习与收藏资料",
      scope: "general",
      parentId: null,
      _count: { items: 0 },
    },
  ],
  platforms: [{ key: "mercari", displayName: "Mercari", enabled: true }],
};
const logisticsItem = {
  id: "editorial-item",
  titleRaw: title,
  titleZh: title,
  priceCurrent: 123456789,
  favorite: true,
  source: { key: "mercari", displayName: "Mercari" },
  images: [{ url: `${target}/brand-icon.svg` }],
  logistics: {
    weightGrams: 100,
    packageWeightGrams: 150,
    lengthMm: 120,
    widthMm: 80,
    heightMm: 60,
    estimatedSalePriceYen: 150000000,
    notes: "夹具数值，实际参数可人工修改",
  },
};
const intel = {
  id: "editorial-intel",
  sourceUrl: "https://example.org/editorial-fixture",
  sourcePlatform: "forum",
  sourceName: "公开收藏论坛",
  kind: "forum",
  author: "资料作者",
  titleRaw: "仮面ライダー SHF 発売情報",
  bodyRaw: "原文正文。配件与发布日期完整保留。",
  titleZh: title,
  bodyZh: "完整正文。\n本条只用于界面验证，来源、日期、作者与原始文本可查看。",
  translationStatus: "completed",
  publishedAt: "2026-10-09T04:00:00Z",
  detectedAt: "2026-10-09T04:00:00Z",
  sourceData: { completeBody: true },
};
const workspaces = [
  ["orders", "库存订单", ".inventory-orders-workspace"],
  ["monitoring", "监控配置", ".mcfg-workspace"],
  ["logistics", "利润与物流", ".logistics-workspace"],
  ["calculator", "进货计算器", ".procurement-calculator"],
  ["intel", "资讯专区", 'section[aria-labelledby="market-intel-heading"]'],
];
const viewports = [
  { width: 320, height: 667 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
  { width: 390, height: 568 },
];

async function inspect(page, selector) {
  await page.waitForFunction(
    (selector) =>
      [...document.querySelector(selector).querySelectorAll("button")]
        .filter((el) => el.getClientRects().length)
        .every((el) => {
          const r = el.getBoundingClientRect();
          return el.offsetHeight < 44 || (r.height >= 43.5 && r.width >= 43.5);
        }),
    selector,
  );
  return page.locator(selector).evaluate((node) => {
    const controls = [
      ...node.querySelectorAll(
        'button,input:not([type="checkbox"]),select,summary,a[href]',
      ),
    ].filter(
      (el) =>
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== "hidden",
    );
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      small: controls
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        })
        .map((el) => ({
          text:
            el.getAttribute("aria-label") ||
            el.textContent?.trim() ||
            el.tagName,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
          transform: getComputedStyle(el).transform,
          layoutHeight: el.offsetHeight,
        })),
      controls: controls.length,
    };
  });
}

(async () => {
  const accounts = await (
    await fetch(`${target}/backend/collaboration/accounts`)
  ).json();
  const actor = accounts.accounts[0].id;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  let activePage;
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: viewport.width === 1440 ? "reduce" : "no-preference",
      });
      await context.addInitScript(
        (actor) => localStorage.setItem("kamen-procurement-manager-v1", actor),
        actor,
      );
      const page = await context.newPage();
      activePage = page;
      const errors = [];
      const mutations = [];
      let scenario = "normal";
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.pathname.startsWith("/backend/") || url.port === "3001",
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const suffix = url.pathname.replace(/^\/backend/, "");
          const json = (body, status = 200) =>
            route.fulfill({
              status,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify(body),
            });
          if (request.method() === "OPTIONS")
            return route.fulfill({
              status: 204,
              headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
                "access-control-allow-headers": "content-type",
              },
            });
          if (suffix === "/collaboration/accounts") return json(accounts);
          const owned =
            /^\/(inventory-orders|monitoring\/config|logistics|market-intel)(\/|$)/.test(
              suffix,
            );
          if (request.method() !== "GET") {
            mutations.push({ path: suffix, method: request.method() });
            if (
              request.method() === "PATCH" &&
              suffix === "/logistics/items/editorial-item"
            )
              return json({ logistics: request.postDataJSON() });
            if (suffix === "/logistics/optimize")
              return json({
                best: {
                  shippingYen: 1000,
                  itemCostYen: 123456789,
                  saleYen: 150000000,
                  profitYen: 26542211,
                },
                ai: null,
              });
            if (suffix.endsWith("/predict"))
              return json({ message: "界面测试禁止模型调用" }, 403);
            if (suffix.startsWith("/inventory-orders"))
              return json({ message: "界面测试：保存失败，输入保留" }, 409);
            return json({ message: "界面测试拦截正式写入" }, 403);
          }
          if (owned && scenario === "error")
            return json({ message: "界面测试读取失败" }, 503);
          if (suffix === "/inventory-orders")
            return json({
              orders: scenario === "empty" ? [] : [order],
              total: scenario === "empty" ? 0 : 1,
              totals: {
                purchaseCostYen: order.purchaseCost,
                totalSalesYen: order.totalSales,
              },
            });
          if (suffix === "/inventory-orders/editorial-order")
            return json({
              order: {
                ...order,
                salesRecords: [
                  {
                    id: "sale-fixture",
                    quantity: 13,
                    salePrice: 90000000,
                    allocatedCost: 53500000,
                    profit: 36500000,
                    soldAt: "2026-10-09T04:00:00Z",
                    note: "销售记录备注",
                  },
                ],
                adjustments: [
                  {
                    id: "adjust-fixture",
                    quantityDelta: -1,
                    reason: "盘点",
                    createdAt: "2026-10-09T04:00:00Z",
                  },
                ],
              },
            });
          if (suffix === "/monitoring/config")
            return json(
              scenario === "empty"
                ? { ...config, keywords: [], categories: [] }
                : config,
            );
          if (suffix === "/logistics/items")
            return json({ items: scenario === "empty" ? [] : [logisticsItem] });
          if (suffix === "/logistics/carriers")
            return json({
              carriers: [
                {
                  id: "carrier-fixture",
                  displayName: "测试承运商",
                  enabled: true,
                },
              ],
            });
          if (suffix === "/market-intel")
            return json({
              items: scenario === "empty" ? [] : [intel],
              total: scenario === "empty" ? 0 : 1,
              pageCount: 1,
              lastUpdatedAt: "2026-10-09T04:00:00Z",
            });
          return route.continue();
        },
      );
      for (const [key, heading, selector] of workspaces) {
        scenario = "normal";
        await page.goto(`${target}/?workspace=${key}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("heading", { name: new RegExp(`^${heading}`) })
          .first()
          .waitFor();
        const region = page.locator(selector);
        if (key === "orders")
          await region
            .getByRole("button", { name: new RegExp("S.H.Figuarts") })
            .waitFor();
        if (key === "monitoring")
          await region
            .getByRole("button", {
              name: "S.H.Figuarts 真骨彫製法 假面骑士 SHF",
            })
            .waitFor();
        if (key === "logistics")
          await region
            .getByRole("button", { name: new RegExp("S.H.Figuarts") })
            .waitFor();
        if (key === "intel")
          await region
            .getByRole("button", { name: new RegExp(title) })
            .filter({ visible: true })
            .waitFor();
        const baseline = await inspect(page, selector);
        assert.equal(
          baseline.overflow,
          false,
          `${key}/${viewport.width}: document overflow`,
        );
        assert.deepEqual(
          baseline.small,
          [],
          `${key}/${viewport.width}: small controls`,
        );
        await page.screenshot({
          path: path.join(
            artifactDir,
            `${key}-${viewport.width}x${viewport.height}.png`,
          ),
          fullPage: true,
        });
        if (key === "orders") {
          const entry = region.getByRole("button", {
            name: new RegExp("S.H.Figuarts"),
          });
          await entry.focus();
          await page.keyboard.press("Enter");
          const detail = page.getByRole("dialog");
          await detail.getByRole("heading", { name: title }).waitFor();
          await page.keyboard.press("Escape");
          assert.equal(await detail.count(), 0);
          await region
            .getByRole("button", { name: "卖出", exact: true })
            .click();
          const sale = page.getByRole("dialog");
          await sale.getByLabel("成交价（日元合计）").fill("5000000");
          await sale
            .getByRole("button", { name: "确认卖出", exact: true })
            .click();
          await sale
            .getByText("界面测试：保存失败，输入保留", { exact: true })
            .waitFor();
          assert.equal(
            await sale.getByLabel("成交价（日元合计）").inputValue(),
            "5000000",
          );
          await page.keyboard.press("Escape");
        }
        if (key === "monitoring") {
          await region
            .getByRole("button", { name: "添加关键词", exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByRole("heading", { name: "新建关键词" })
            .waitFor();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Escape");
          assert.equal(await page.getByRole("dialog").count(), 0);
        }
        if (key === "logistics") {
          await region
            .getByRole("button", { name: new RegExp("S.H.Figuarts") })
            .first()
            .click();
          await region
            .getByRole("button", { name: "商品参数 · 1 件", exact: true })
            .click();
          await region.getByLabel("商品重量", { exact: true }).fill("500");
          await region.getByLabel("实际快递费", { exact: true }).fill("1000");
          await region
            .getByRole("button", { name: "计算利润", exact: true })
            .click();
          await region
            .getByText("利润结果已按实际快递费更新", { exact: true })
            .waitFor();
          await region.getByText("¥26,542,211", { exact: true }).waitFor();
          const adjusted = await inspect(page, selector);
          assert.equal(adjusted.overflow, false);
          assert.deepEqual(adjusted.small, []);
        }
        if (key === "calculator") {
          await region.getByLabel("商品数量", { exact: true }).fill("30");
          await region
            .getByLabel("日本整批商品报价", { exact: true })
            .fill("123456789");
          await region
            .getByLabel("预计国内整批售价", { exact: true })
            .fill("20000000");
          await region
            .getByRole("button", { name: "对内 · 实际收益", exact: true })
            .click();
          await region
            .getByLabel("实际整批采购价", { exact: true })
            .fill("123456789");
          await region.getByLabel("实际整批运税", { exact: true }).fill("1500");
          await region
            .getByRole("button", { name: "修改对外报价", exact: true })
            .click();
          assert.equal(
            await region.getByLabel("商品数量", { exact: true }).inputValue(),
            "30",
          );
          const calculated = await inspect(page, selector);
          assert.equal(calculated.overflow, false);
          assert.deepEqual(calculated.small, []);
        }
        if (key === "intel") {
          const entry = region
            .getByRole("button", { name: new RegExp(title) })
            .filter({ visible: true });
          await entry.focus();
          await page.keyboard.press("Enter");
          const detail = page.getByRole("dialog");
          await detail.getByRole("heading", { name: "资讯详情" }).waitFor();
          await detail
            .getByRole("button", { name: "原文", exact: true })
            .click();
          await detail
            .getByRole("heading", { name: intel.titleRaw, exact: true })
            .waitFor();
          await page.keyboard.press("Escape");
          assert.equal(await detail.count(), 0);
        }
        results.push({
          workspace: key,
          viewport,
          baseline,
          interaction: "passed",
        });
      }
      if (viewport.width === 390 && viewport.height === 844) {
        for (const state of ["empty", "error"])
          for (const [key, heading, selector] of workspaces.filter(
            ([key]) => key !== "calculator",
          )) {
            scenario = state;
            await page.goto(`${target}/?workspace=${key}`, {
              waitUntil: "domcontentloaded",
            });
            await page
              .getByRole("heading", { name: new RegExp(`^${heading}`) })
              .first()
              .waitFor();
            if (key === "orders")
              await (
                state === "empty"
                  ? page
                      .locator(selector)
                      .getByText("还没有库存订单", { exact: true })
                  : page.locator(selector).getByRole("alert")
              ).waitFor();
            if (key === "monitoring")
              await page
                .locator(selector)
                .getByText(
                  state === "empty" ? "还没有监控关键词" : "界面测试读取失败",
                  { exact: true },
                )
                .waitFor();
            if (key === "logistics")
              await page
                .locator(selector)
                .getByText(
                  state === "empty" ? "暂无可计算商品" : "物流数据加载失败",
                  { exact: true },
                )
                .waitFor();
            if (key === "intel")
              await page
                .locator(selector)
                .getByText(
                  state === "empty"
                    ? "暂无匹配资讯，后台仍会每小时继续检索。"
                    : "无法读取资讯：API 503",
                  { exact: true },
                )
                .waitFor();
            const inspected = await inspect(page, selector);
            assert.equal(inspected.overflow, false);
            assert.deepEqual(inspected.small, []);
            results.push({
              workspace: key,
              state,
              viewport,
              baseline: inspected,
            });
          }
      }
      assert.deepEqual(errors, [], `page errors ${viewport.width}`);
      assert.equal(
        mutations.some((entry) => /predict|ai|translate/.test(entry.path)),
        false,
        "UI viewing must not request a model",
      );
      await context.close();
    }
    fs.writeFileSync(
      path.join(artifactDir, "verification.json"),
      JSON.stringify({ target, results, passed: true }, null, 2),
    );
    console.log(
      JSON.stringify({ passed: true, checks: results.length, artifactDir }),
    );
  } catch (error) {
    console.error(error);
    if (activePage && !activePage.isClosed()) {
      await activePage
        .screenshot({
          path: path.join(artifactDir, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
      console.error(
        (
          await activePage
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 2500),
      );
      console.error("URL", activePage.url());
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
