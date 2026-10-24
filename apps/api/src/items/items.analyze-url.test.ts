import "reflect-metadata";
import { validate } from "class-validator";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queueMocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  getJob: vi.fn(),
  quit: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = queueMocks.add;
    close = queueMocks.close;
    getJob = queueMocks.getJob;
  },
}));

vi.mock("ioredis", () => ({
  Redis: class {
    quit = queueMocks.quit;
  },
}));

import { AnalyzePurchaseLinksDto, AnalyzeUrlDto } from "./items.dto.js";
import { ItemsService, splitAnalyzeUrlInputs } from "./items.service.js";

function prismaStub() {
  let sequence = 0;
  return {
    urlImport: {
      create: vi.fn(async () => ({ id: `import-${++sequence}` })),
      update: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(),
    },
  };
}

describe("batch URL imports", () => {
  beforeEach(() => {
    queueMocks.add.mockReset();
    queueMocks.close.mockReset();
    queueMocks.getJob.mockReset().mockResolvedValue(undefined);
    queueMocks.quit.mockReset();
    queueMocks.add
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" });
    queueMocks.close.mockResolvedValue(undefined);
    queueMocks.quit.mockResolvedValue("OK");
  });

  it("splits whitespace-separated links and removes exact duplicates", () => {
    expect(
      splitAnalyzeUrlInputs([
        "https://paypayfleamarket.yahoo.co.jp/item/z667890666\nhttps://paypayfleamarket.yahoo.co.jp/item/z670895698",
        "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      ]),
    ).toEqual([
      "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      "https://paypayfleamarket.yahoo.co.jp/item/z670895698",
    ]);
  });

  it("queues valid links independently and reports an invalid link in place", async () => {
    const prisma = prismaStub();
    const service = new ItemsService(prisma as never);

    const result = await service.analyzeUrl([
      "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      "not-a-url",
      "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      "https://paypayfleamarket.yahoo.co.jp/item/z670895698",
    ]);

    expect(result).toMatchObject({
      accepted: true,
      acceptedCount: 2,
      rejectedCount: 1,
      results: [
        {
          url: "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
          accepted: true,
          adapter: "yahoo_fleamarket",
          importId: "import-1",
          jobId: "job-1",
        },
        { url: "not-a-url", accepted: false },
        {
          url: "https://paypayfleamarket.yahoo.co.jp/item/z670895698",
          accepted: true,
          adapter: "yahoo_fleamarket",
          importId: "import-2",
          jobId: "job-2",
        },
      ],
    });
    expect(prisma.urlImport.create).toHaveBeenCalledTimes(2);
    expect(queueMocks.add).toHaveBeenCalledTimes(2);
    expect(queueMocks.close).toHaveBeenCalledOnce();
    expect(queueMocks.quit).toHaveBeenCalledOnce();
  });

  it("keeps the legacy single-link response shape", async () => {
    const prisma = prismaStub();
    queueMocks.add.mockReset().mockResolvedValue({ id: "job-single" });
    const service = new ItemsService(prisma as never);

    const result = await service.analyzeUrl(
      "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
    );

    expect(result).toMatchObject({
      accepted: true,
      adapter: "yahoo_fleamarket",
      importId: "import-1",
      jobId: "job-single",
    });
    expect(result).not.toHaveProperty("results");
  });

  it("clears an old failure before retrying the same import record", async () => {
    const prisma = prismaStub();
    prisma.urlImport.findUnique.mockResolvedValue({
      id: "failed-import",
      sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      status: "failed",
    });
    queueMocks.add.mockReset().mockResolvedValue({ id: "job-retry" });
    const service = new ItemsService(prisma as never);

    const result = await service.retryUrlImport("failed-import");

    expect(result).toMatchObject({
      accepted: true,
      importId: "failed-import",
      jobId: "job-retry",
    });
    expect(prisma.urlImport.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "failed-import" },
        data: expect.objectContaining({
          status: "queued",
          progress: 0,
          errorText: null,
          finishedAt: null,
        }),
      }),
    );
  });

  it("reuses a delayed automatic retry instead of creating a duplicate job", async () => {
    const prisma = prismaStub();
    prisma.urlImport.findUnique.mockResolvedValue({
      id: "auto-retry-import",
      sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
      queueJobId: "existing-job",
      status: "failed",
    });
    queueMocks.getJob.mockResolvedValue({
      id: "existing-job",
      getState: vi.fn().mockResolvedValue("delayed"),
    });
    const service = new ItemsService(prisma as never);

    const result = await service.retryUrlImport("auto-retry-import");

    expect(result).toMatchObject({
      accepted: true,
      importId: "auto-retry-import",
      jobId: "existing-job",
      reused: true,
    });
    expect(queueMocks.add).not.toHaveBeenCalled();
    expect(prisma.urlImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "queued",
          errorText: null,
          finishedAt: null,
        }),
      }),
    );
  });
});

describe("purchase link analysis with actual amounts", () => {
  beforeEach(() => {
    queueMocks.add.mockReset();
    queueMocks.close.mockReset().mockResolvedValue(undefined);
    queueMocks.getJob.mockReset().mockResolvedValue(undefined);
    queueMocks.quit.mockReset().mockResolvedValue("OK");
  });

  it("threads the entered amount for each URL into that URL's job only", async () => {
    queueMocks.add
      .mockResolvedValueOnce({ id: "job-paid" })
      .mockResolvedValueOnce({ id: "job-plain" });
    const service = new ItemsService(prismaStub() as never);

    const result = await service.analyzePurchaseLinks(
      [
        "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
        "https://paypayfleamarket.yahoo.co.jp/item/z670895698",
      ],
      {
        "https://paypayfleamarket.yahoo.co.jp/item/z667890666": 12_800,
        "https://paypayfleamarket.yahoo.co.jp/item/z670895698": 0,
      },
    );

    expect(result).toMatchObject({ accepted: true, acceptedCount: 2 });
    expect(queueMocks.add).toHaveBeenNthCalledWith(
      1,
      "analyze-purchase-url",
      expect.objectContaining({
        sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z667890666",
        importOrigin: "purchase",
        actualAmountYen: 12_800,
      }),
      expect.anything(),
    );
    // A zero amount is not a real paid price, so the second job stays
    // without one and falls back to the listing price when polled.
    expect(queueMocks.add).toHaveBeenNthCalledWith(
      2,
      "analyze-purchase-url",
      expect.not.objectContaining({ actualAmountYen: expect.anything() }),
      expect.anything(),
    );
  });

  it("returns the entered amount as the suggested price when polling", async () => {
    const item = {
      id: "item-1",
      priceCurrent: 15_000,
      source: { key: "yahoo_fleamarket", displayName: "Yahoo" },
      sourceData: null,
    };
    const prisma = { item: { findUnique: vi.fn(async () => item) } };
    queueMocks.getJob.mockResolvedValue({
      id: "job-paid",
      data: { importOrigin: "purchase", actualAmountYen: 12_800 },
      getState: vi.fn().mockResolvedValue("completed"),
      progress: 100,
      returnvalue: { itemId: "item-1" },
    });
    const service = new ItemsService(prisma as never);

    await expect(
      service.getPurchaseLinkAnalysis("job-paid"),
    ).resolves.toMatchObject({
      readyForPricing: true,
      pricingOptions: {
        perItem: {
          itemId: "item-1",
          suggestedAmountYen: 12_800,
          suggestedAmountSource: "actual",
        },
      },
    });
  });

  it("falls back to the listing price when no amount was entered", async () => {
    const item = {
      id: "item-2",
      priceCurrent: 9_800,
      source: { key: "yahoo_fleamarket", displayName: "Yahoo" },
      sourceData: null,
    };
    const prisma = { item: { findUnique: vi.fn(async () => item) } };
    queueMocks.getJob.mockResolvedValue({
      id: "job-plain",
      data: { importOrigin: "purchase" },
      getState: vi.fn().mockResolvedValue("completed"),
      progress: 100,
      returnvalue: { itemId: "item-2" },
    });
    const service = new ItemsService(prisma as never);

    await expect(
      service.getPurchaseLinkAnalysis("job-plain"),
    ).resolves.toMatchObject({
      pricingOptions: {
        perItem: {
          suggestedAmountYen: 9_800,
          suggestedAmountSource: "listing",
        },
      },
    });
  });
});

describe("AnalyzePurchaseLinksDto", () => {
  it("accepts an optional amountsByUrl object and rejects a non-object", async () => {
    const accepted = Object.assign(new AnalyzePurchaseLinksDto(), {
      urls: ["https://example.com/one"],
      amountsByUrl: { "https://example.com/one": 12_800 },
    });
    const withoutAmounts = Object.assign(new AnalyzePurchaseLinksDto(), {
      urls: ["https://example.com/one"],
    });
    const rejected = Object.assign(new AnalyzePurchaseLinksDto(), {
      urls: ["https://example.com/one"],
      amountsByUrl: "12800",
    });

    expect(await validate(accepted)).toHaveLength(0);
    expect(await validate(withoutAmounts)).toHaveLength(0);
    expect(await validate(rejected)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "amountsByUrl" }),
      ]),
    );
  });
});

describe("AnalyzeUrlDto", () => {
  it("accepts a bounded URL array and rejects more than twenty entries", async () => {
    const accepted = Object.assign(new AnalyzeUrlDto(), {
      urls: ["https://example.com/one", "https://example.com/two"],
    });
    const rejected = Object.assign(new AnalyzeUrlDto(), {
      urls: Array.from(
        { length: 21 },
        (_, index) => `https://example.com/${index}`,
      ),
    });

    expect(await validate(accepted)).toHaveLength(0);
    expect(await validate(rejected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "urls" })]),
    );
  });
});
