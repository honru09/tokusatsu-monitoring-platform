import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import { ProductAiService } from "../ai/product-ai.service.js";
import { ResaleService } from "./resale.service.js";
import { ResalePublisher } from "./resale-publisher.js";
import { ResaleOperationsService } from "./resale-operations.service.js";

describe.skipIf(!process.env.RESALE_TEST_DATABASE_URL)(
  "resale operations PostgreSQL workflow",
  () => {
    const db = new PrismaService({
      datasourceUrl: process.env.RESALE_TEST_DATABASE_URL,
    });
    const publisher = {
      capability: {
        configured: true,
        sellerActions: ["bump", "reprice", "metrics"],
        mode: "bridge",
        label: "test",
      },
      execute: vi.fn(),
      sellerAction: vi.fn(),
      pullMetrics: vi.fn(),
    };
    const ai = { execute: vi.fn() };
    const main = new ResaleService(
      db,
      ai as unknown as ProductAiService,
      publisher as unknown as ResalePublisher,
    );
    const ops = new ResaleOperationsService(
      db,
      publisher as unknown as ResalePublisher,
    );
    const actor = "resale-ops-test";
    let sourceId: string;
    let listingId: string;
    beforeAll(async () => {
      if (
        !/^\/resale_test(?:_[a-z0-9]+)?$/.test(
          new URL(process.env.RESALE_TEST_DATABASE_URL!).pathname,
        )
      )
        throw new Error("An isolated resale_test database is required");
      await db.$connect();
      sourceId = (
        await db.source.upsert({
          where: { key: "mercari" },
          create: { key: "mercari", displayName: "Mercari" },
          update: {},
        })
      ).id;
      await db.managerAccount.upsert({
        where: { id: actor },
        create: {
          id: actor,
          key: actor,
          displayName: "测试运营",
          avatarInitial: "测",
          position: 20,
        },
        update: { active: true },
      });
    });
    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await db.resaleSellerTask.deleteMany();
      await db.resaleMetricSnapshot.deleteMany();
      await db.resaleMarketObservation.deleteMany();
      await db.resaleMonitor.deleteMany();
      await db.resaleEvent.deleteMany();
      await db.resaleListing.deleteMany();
      await db.item.deleteMany();
      await db.resaleSettings.deleteMany();
      await db.resaleSettings.create({ data: { id: "default" } });
      const itemId = randomUUID();
      await db.item.create({
        data: {
          id: itemId,
          sourceId,
          sourceItemId: itemId,
          sourceUrl: `https://jp.mercari.com/item/${itemId}`,
          titleRaw: "中古玩具",
          descriptionRaw: "有划痕",
          priceCurrent: 1000,
          shippingFee: 0,
          priceTotalEst: 1000,
          status: "active",
          listingType: "direct",
        },
      });
      await main.import({ accountId: actor, itemIds: [itemId] });
      listingId = (await db.resaleListing.findFirstOrThrow()).id;
      publisher.capability.sellerActions = ["bump", "reprice", "metrics"];
      publisher.execute.mockReset();
      publisher.sellerAction.mockReset();
      publisher.pullMetrics.mockReset();
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await main.onModuleDestroy();
      ops.onModuleDestroy();
      await db.$disconnect();
    });
    async function published() {
      return db.resaleListing.update({
        where: { id: listingId },
        data: {
          status: "published",
          humanControl: false,
          targetItemId: "998877",
          targetUrl: "https://www.goofish.com/item?id=998877",
          publishOrigin: "bridge",
          priceCny: 100,
        },
      });
    }
    it("retains untranslated candidates when exclusion and search filters are combined", async () => {
      await db.resaleEvent.deleteMany();
      await db.resaleListing.deleteMany();
      await db.resaleSettings.update({
        where: { id: "default" },
        data: { requiredKeywords: ["中古"], excludedKeywords: ["缺页"] },
      });
      expect(
        (await main.candidates({ page: 1, limit: 30, search: "玩具" })).total,
      ).toBe(1);
      await db.item.updateMany({ data: { descriptionRaw: "缺页" } });
      expect(
        (await main.candidates({ page: 1, limit: 30, search: "玩具" })).total,
      ).toBe(0);
    });
    it("does not execute future maintenance or jobs taken over by a human", async () => {
      const row = await published();
      await db.resaleSettings.update({
        where: { id: "default" },
        data: { paused: false },
      });
      const { task } = await ops.createTask({
        accountId: actor,
        listingId,
        version: row.version,
        kind: "bump",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await ops.tick();
      expect(publisher.sellerAction).not.toHaveBeenCalled();
      await db.resaleSellerTask.update({
        where: { id: task.id },
        data: { scheduledAt: new Date() },
      });
      await db.resaleListing.update({
        where: { id: listingId },
        data: { humanControl: true },
      });
      await ops.tick();
      expect(publisher.sellerAction).not.toHaveBeenCalled();
      expect(
        (
          await db.resaleSellerTask.findUniqueOrThrow({
            where: { id: task.id },
          })
        ).status,
      ).toBe("queued");
    });
    async function monitor() {
      return (
        await ops.saveMonitor({
          accountId: actor,
          keyword: "AI",
          minPriceCny: 10,
          maxPriceCny: 200,
          requiredKeywords: ["AI"],
          excludedKeywords: ["缺页"],
          regions: ["上海"],
          intervalMinutes: 60,
          active: false,
        })
      ).monitor;
    }
    const observation = {
      id: "1234",
      title: "AI 学习资料",
      price: 100,
      area: "上海",
      link: "https://www.goofish.com/item?id=1234",
    };
    it("deduplicates discoveries while preserving original discovery time and read state", async () => {
      const task = await monitor();
      expect(
        await ops.ingest(task.id, {
          accountId: actor,
          items: [
            observation,
            { ...observation, id: "wrong" },
            { ...observation, title: "AI 缺页" },
          ],
        }),
      ).toEqual({ discovered: 1, updated: 0, rejected: 2 });
      const original = await db.resaleMarketObservation.findFirstOrThrow();
      await ops.markRead(actor);
      expect(
        await ops.ingest(task.id, {
          accountId: actor,
          items: [{ ...observation, price: 90 }, observation],
        }),
      ).toEqual({ discovered: 0, updated: 1, rejected: 0 });
      const current = await db.resaleMarketObservation.findFirstOrThrow();
      expect(current.discoveredAt).toEqual(original.discoveredAt);
      expect(current.readAt).not.toBeNull();
      expect(current.priceCny).toBe(90);
    });
    it("stops blocked searches and does not report them as empty results", async () => {
      const task = await monitor();
      vi.stubEnv("RESALE_MARKET_SEARCH_URL", "https://search.test/items");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
      );
      await expect(ops.scan(task.id, actor)).rejects.toThrow("监测已停止");
      expect(
        (await db.resaleMonitor.findUniqueOrThrow({ where: { id: task.id } }))
          .active,
      ).toBe(false);
      expect(await db.resaleMarketObservation.count()).toBe(0);
    });
    it("rejects edits of leased monitors and automatically scanning paused settings", async () => {
      const task = await monitor();
      await db.resaleMonitor.update({
        where: { id: task.id },
        data: { leaseUntil: new Date(Date.now() + 90000) },
      });
      await expect(
        ops.saveMonitor({ ...task, accountId: actor, keyword: "new" }),
      ).rejects.toThrow("扫描进行中");
      vi.stubEnv("RESALE_MARKET_SEARCH_URL", "https://search.test/items");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(ops.scan(task.id)).rejects.toThrow("已暂停");
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("keeps unknown metrics null and exports actual zero as zero", async () => {
      await published();
      let report = await ops.metrics(7);
      expect(report.totals.views).toEqual({ value: null, coverage: 0 });
      await ops.saveMetric({
        accountId: actor,
        listingId,
        observedAt: new Date().toISOString(),
        views: 0,
      });
      report = await ops.metrics(7);
      expect(report.totals.views).toEqual({ value: 0, coverage: 1 });
      expect(report.totals.orders).toEqual({ value: null, coverage: 0 });
      expect(report.listings[0]!.periodChange.views).toBeNull();
      expect(await ops.csv(7)).toContain('"0","","","","manual"');
      await expect(
        ops.saveMetric({
          accountId: actor,
          listingId,
          observedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("至少填写");
    });
    it("records channel snapshots once and enforces hourly automatic polling", async () => {
      await published();
      await db.resaleSettings.update({
        where: { id: "default" },
        data: { paused: false, autoMetrics: true },
      });
      publisher.pullMetrics.mockResolvedValue({
        observedAt: new Date(),
        views: 20,
        wants: null,
        orders: null,
        revenueCny: null,
      });
      await ops.tick();
      await ops.tick();
      expect(publisher.pullMetrics).toHaveBeenCalledTimes(1);
      expect(await db.resaleMetricSnapshot.count()).toBe(1);
      await ops.syncMetric(listingId, actor);
      expect(await db.resaleMetricSnapshot.count()).toBe(1);
    });
    it("turns unsupported maintenance into a manual checklist and records verified prices", async () => {
      const row = await published();
      publisher.capability.sellerActions = [];
      const { task } = await ops.createTask({
        accountId: actor,
        listingId,
        version: row.version,
        kind: "reprice",
        priceCny: 90,
        scheduledAt: new Date().toISOString(),
      });
      expect(task.status).toBe("manual");
      await ops.tick();
      expect(publisher.sellerAction).not.toHaveBeenCalled();
      await ops.resolveTask(task.id, { accountId: actor, action: "confirmed" });
      expect(
        (await db.resaleListing.findUniqueOrThrow({ where: { id: listingId } }))
          .priceCny,
      ).toBe(90);
    });
    it("claims concurrent task runs exactly once and saves acknowledged prices", async () => {
      const row = await published();
      await db.resaleSettings.update({
        where: { id: "default" },
        data: { paused: false },
      });
      await ops.createTask({
        accountId: actor,
        listingId,
        version: row.version,
        kind: "reprice",
        priceCny: 95,
        scheduledAt: new Date().toISOString(),
      });
      publisher.sellerAction.mockResolvedValue({});
      const second = new ResaleOperationsService(
        db,
        publisher as unknown as ResalePublisher,
      );
      await Promise.all([ops.tick(), second.tick()]);
      expect(publisher.sellerAction).toHaveBeenCalledTimes(1);
      expect(
        (await db.resaleListing.findUniqueOrThrow({ where: { id: listingId } }))
          .priceCny,
      ).toBe(95);
      second.onModuleDestroy();
    });
    it("does not retry ambiguous seller actions and blocks conflicting withdrawal", async () => {
      const row = await published();
      await db.resaleSettings.update({
        where: { id: "default" },
        data: { paused: false },
      });
      await ops.createTask({
        accountId: actor,
        listingId,
        version: row.version,
        kind: "bump",
        scheduledAt: new Date().toISOString(),
      });
      publisher.sellerAction.mockRejectedValue(new Error("network timeout"));
      await ops.tick();
      await ops.tick();
      expect(publisher.sellerAction).toHaveBeenCalledTimes(1);
      const current = await db.resaleListing.findUniqueOrThrow({
        where: { id: listingId },
      });
      expect(current.humanControl).toBe(true);
      expect((await db.resaleSellerTask.findFirstOrThrow()).status).toBe(
        "uncertain",
      );
      await expect(
        main.action(listingId, {
          accountId: actor,
          version: current.version,
          action: "withdraw",
        }),
      ).rejects.toThrow("维护任务");
      expect(publisher.execute).not.toHaveBeenCalled();
    });
    it("recovers persisted running tasks to human control after restart without resending", async () => {
      const row = await published();
      const { task } = await ops.createTask({
        accountId: actor,
        listingId,
        version: row.version,
        kind: "bump",
        scheduledAt: new Date().toISOString(),
      });
      await db.resaleSellerTask.update({
        where: { id: task.id },
        data: { status: "running", startedAt: new Date(Date.now() - 121000) },
      });
      await ops.tick();
      expect(
        (await db.resaleListing.findUniqueOrThrow({ where: { id: listingId } }))
          .humanControl,
      ).toBe(true);
      expect(
        (
          await db.resaleSellerTask.findUniqueOrThrow({
            where: { id: task.id },
          })
        ).status,
      ).toBe("uncertain");
      expect(publisher.sellerAction).not.toHaveBeenCalled();
    });
    it("rejects stale versions and preserves future publication schedules inside the claim", async () => {
      const row = await db.resaleListing.update({
        where: { id: listingId },
        data: {
          status: "ready",
          rightsConfirmed: true,
          fulfillmentConfirmed: true,
          imageUrls: ["https://example.com/image.jpg"],
          deliveryText: "真实交付条件",
        },
      });
      const result = await main.bulk({
        accountId: actor,
        listingIds: [row.id, "missing"],
        versions: { [row.id]: row.version, missing: 1 },
        action: "enqueue",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(result.succeeded).toBe(1);
      expect(result.results[1]!.ok).toBe(false);
      const current = await db.resaleListing.findUniqueOrThrow({
        where: { id: row.id },
      });
      const executor = main as unknown as {
        executePublication: (
          id: string,
          version: number,
          action: "publish",
          actor: null,
          automatic: boolean,
        ) => Promise<unknown>;
      };
      await expect(
        executor.executePublication(
          row.id,
          current.version,
          "publish",
          null,
          true,
        ),
      ).rejects.toThrow("尚未到计划");
      expect(publisher.execute).not.toHaveBeenCalled();
      await expect(
        main.action(row.id, {
          accountId: actor,
          version: row.version,
          action: "pause",
        }),
      ).rejects.toThrow("已更新");
    });
  },
);
