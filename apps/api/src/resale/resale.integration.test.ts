import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import { ProductAiService } from "../ai/product-ai.service.js";
import { ResalePublisher } from "./resale-publisher.js";
import { ResaleService } from "./resale.service.js";

// Use an isolated database explicitly supplied by the test runner.
describe.skipIf(!process.env.RESALE_TEST_DATABASE_URL)(
  "resale PostgreSQL workflow",
  () => {
    const database = new PrismaService({
      datasourceUrl: process.env.RESALE_TEST_DATABASE_URL,
    });
    const ai = { execute: vi.fn() };
    const publisher = {
      capability: {
        configured: true,
        mode: "bridge",
        label: "test",
        sellerActions: [],
      },
      execute: vi.fn(),
    };
    const service = new ResaleService(
      database,
      ai as unknown as ProductAiService,
      publisher as unknown as ResalePublisher,
    );
    const actor = "resale-integration-operator";
    let sourceId: string;
    let itemId: string;
    beforeAll(async () => {
      const testUrl = new URL(process.env.RESALE_TEST_DATABASE_URL!);
      if (!/^\/resale_test(?:_[a-z0-9]+)?$/.test(testUrl.pathname))
        throw new Error(
          "Resale integration tests require an isolated resale_test database",
        );
      await database.$connect();
      const source = await database.source.upsert({
        where: { key: "mercari" },
        create: { key: "mercari", displayName: "Mercari" },
        update: {},
      });
      sourceId = source.id;
      await database.managerAccount.upsert({
        where: { id: actor },
        create: {
          id: actor,
          key: actor,
          displayName: "测试管理者",
          avatarInitial: "测",
          position: 21,
        },
        update: {},
      });
    });
    beforeEach(async () => {
      await database.resaleSellerTask.deleteMany();
      await database.resaleMetricSnapshot.deleteMany();
      await database.resaleMarketObservation.deleteMany();
      await database.resaleMonitor.deleteMany();
      await database.resaleEvent.deleteMany();
      await database.resaleListing.deleteMany();
      await database.item.deleteMany();
      await database.resaleSettings.deleteMany();
      itemId = randomUUID();
      await database.item.create({
        data: {
          id: itemId,
          sourceId,
          sourceItemId: itemId,
          sourceUrl: `https://jp.mercari.com/item/${itemId}`,
          titleRaw: "中古商品 傷あり",
          descriptionRaw: "配件缺失",
          priceCurrent: 1000,
          priceTotalEst: 1000,
          shippingFee: 0,
          status: "active",
          listingType: "direct",
        },
      });
      await service.import({ accountId: actor, itemIds: [itemId] });
      publisher.execute.mockReset();
      ai.execute.mockReset();
    });
    afterAll(async () => {
      await service.onModuleDestroy();
      await database.$disconnect();
    });
    async function ready() {
      const row = (await service.list({ page: 1, limit: 30 })).listings[0]!;
      const saved = await service.update(row.id, {
        accountId: actor,
        version: row.version,
        title: "中古商品，有伤",
        description: "配件缺失",
        priceCny: 80,
        imageUrls: ["https://example.com/image.jpg"],
        deliveryText: "日本采购，预计两周",
        rightsConfirmed: true,
        fulfillmentConfirmed: true,
      });
      return (
        await service.action(row.id, {
          accountId: actor,
          version: saved.listing.version,
          action: "approve",
        })
      ).listing;
    }
    it("background copy waits for existing translations without spending AI quota", async () => {
      await database.resaleSettings.update({ where: { id: "default" }, data: { paused: false, autoGenerate: true } });
      const runner = service as unknown as { tick(): Promise<void> };
      await runner.tick();
      expect(ai.execute).not.toHaveBeenCalled();
      expect((await service.list({ page: 1, limit: 30 })).listings[0]!.generatedAt).toBeNull();
      await database.item.update({ where: { id: itemId }, data: { titleZh: "中古商品，有划痕", descriptionZh: "缺少配件" } });
      await runner.tick();
      const row = (await service.list({ page: 1, limit: 30 })).listings[0]!;
      expect(ai.execute).not.toHaveBeenCalled();
      expect(row.generatedAt).not.toBeNull();
      expect(row.description).toBe("缺少配件");
    });
    it("deduplicates concurrent imports of the same source item", async () => {
      const results = await Promise.all([
        service.import({ accountId: actor, itemIds: [itemId] }),
        service.import({ accountId: actor, itemIds: [itemId] }),
      ]);
      expect(results.map((result) => result.imported)).toEqual([0, 0]);
      expect(await database.resaleListing.count()).toBe(1);
    });
    it("rejects a stale editor without overwriting the first human's saved text", async () => {
      const row = await ready();
      const body = {
        accountId: actor,
        version: row.version,
        title: "我的修改",
        description: row.description,
        priceCny: row.priceCny,
        imageUrls: row.imageUrls,
        deliveryText: row.deliveryText,
        rightsConfirmed: true,
        fulfillmentConfirmed: true,
      };
      await service.update(row.id, body);
      await expect(
        service.update(row.id, { ...body, title: "旧页面修改" }),
      ).rejects.toThrow("更新");
      expect((await service.get(row.id)).listing.title).toBe("我的修改");
    });
    it("sends a publication only once when two operators click concurrently", async () => {
      const row = await ready();
      publisher.execute.mockResolvedValue({
        targetItemId: "test-target",
        targetUrl: "https://www.goofish.com/item?id=test-target",
      });
      const results = await Promise.allSettled([
        service.action(row.id, {
          accountId: actor,
          version: row.version,
          action: "publish",
        }),
        service.action(row.id, {
          accountId: actor,
          version: row.version,
          action: "publish",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(publisher.execute).toHaveBeenCalledTimes(1);
      expect((await service.get(row.id)).listing.status).toBe("published");
    });
    it("stops uncertain requests and supports manual reconciliation without resending", async () => {
      const row = await ready();
      publisher.execute.mockRejectedValue(new Error("timeout"));
      const result = await service.action(row.id, {
        accountId: actor,
        version: row.version,
        action: "publish",
      });
      expect(result.listing.status).toBe("uncertain");
      await expect(
        service.action(row.id, {
          accountId: actor,
          version: result.listing.version,
          action: "publish",
        }),
      ).rejects.toThrow();
      const record = await service.action(row.id, {
        accountId: actor,
        version: result.listing.version,
        action: "record",
        targetItemId: "actual-target",
        targetUrl: "https://www.goofish.com/item?id=actual-target",
      });
      expect(record.listing.status).toBe("published");
      expect(publisher.execute).toHaveBeenCalledTimes(1);
    });
    it("blocks publication after source sale or price change", async () => {
      const row = await ready();
      await database.item.update({
        where: { id: itemId },
        data: { priceCurrent: 2000 },
      });
      await expect(
        service.action(row.id, {
          accountId: actor,
          version: row.version,
          action: "publish",
        }),
      ).rejects.toThrow("变化");
      await database.item.update({
        where: { id: itemId },
        data: { status: "sold" },
      });
      await expect(
        service.action(row.id, {
          accountId: actor,
          version: row.version,
          action: "publish",
        }),
      ).rejects.toThrow("售出");
      expect(publisher.execute).not.toHaveBeenCalled();
    });
    it("enforces the daily capacity atomically across different listings", async () => {
      const row = await ready();
      await database.resaleSettings.update({
        where: { id: "default" },
        data: { dailyPublishLimit: 1 },
      });
      publisher.execute.mockResolvedValue({
        targetItemId: "first-target",
        targetUrl: "https://www.goofish.com/item?id=first-target",
      });
      await service.action(row.id, {
        accountId: actor,
        version: row.version,
        action: "publish",
      });
      const item2 = await database.item.create({
        data: {
          sourceId,
          sourceItemId: randomUUID(),
          sourceUrl: "https://jp.mercari.com/item/test2",
          titleRaw: "中古",
          priceCurrent: 1000,
          priceTotalEst: 1000,
          shippingFee: 0,
          status: "active",
          listingType: "direct",
        },
      });
      const listing2 = await database.resaleListing.create({
        data: {
          itemId: item2.id,
          title: row.title,
          description: row.description,
          priceCny: 80,
          imageUrls: row.imageUrls,
          deliveryText: row.deliveryText,
          rightsConfirmed: true,
          fulfillmentConfirmed: true,
          sourcePriceJpy: 1000,
          sourceShippingJpy: 0,
          status: "ready",
        },
      });
      await expect(
        service.action(listing2.id, {
          accountId: actor,
          version: listing2.version,
          action: "publish",
        }),
      ).rejects.toThrow("额度");
      expect(publisher.execute).toHaveBeenCalledTimes(1);
    });
    it("keeps an in-flight receipt while a human takes over", async () => {
      const row = await ready();
      let resolve!: (value: {
        targetItemId: string;
        targetUrl: string;
      }) => void;
      let started!: () => void;
      const dispatched = new Promise<void>((yes) => {
        started = yes;
      });
      publisher.execute.mockImplementation(() => {
        started();
        return new Promise((yes) => {
          resolve = yes;
        });
      });
      const publishing = service.action(row.id, {
        accountId: actor,
        version: row.version,
        action: "publish",
      });
      await dispatched;
      const inFlight = (await service.get(row.id)).listing;
      await service.action(row.id, {
        accountId: actor,
        version: inFlight.version,
        action: "takeover",
      });
      resolve({
        targetItemId: "taken-over",
        targetUrl: "https://www.goofish.com/item?id=taken-over",
      });
      const result = await publishing;
      expect(result.listing.status).toBe("published");
      expect(result.listing.humanControl).toBe(true);
    });
    it("does not overwrite human edits when an older AI response finishes", async () => {
      const row = await ready();
      let resolve!: (value: {
        data: { title: string; description: string };
      }) => void;
      let started!: () => void;
      const dispatched = new Promise<void>((yes) => {
        started = yes;
      });
      ai.execute.mockImplementation(() => {
        started();
        return new Promise((yes) => {
          resolve = yes;
        });
      });
      const requested = await service.action(row.id, {
        accountId: actor,
        version: row.version,
        action: "generate",
      });
      await dispatched;
      await service.update(row.id, {
        accountId: actor,
        version: requested.listing.version,
        title: "保留我的新文案",
        description: row.description,
        priceCny: 80,
        imageUrls: row.imageUrls,
        deliveryText: row.deliveryText,
        rightsConfirmed: false,
        fulfillmentConfirmed: false,
      });
      resolve({ data: { title: "过期AI文案", description: "不应保存" } });
      await vi.waitFor(async () => {
        expect((await service.get(row.id)).listing.generationToken).toBeNull();
      });
      expect((await service.get(row.id)).listing.title).toBe("保留我的新文案");
    });
  },
);
