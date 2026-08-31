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

import { AnalyzeUrlDto } from "./items.dto.js";
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

describe("AnalyzeUrlDto", () => {
  it("accepts a bounded URL array and rejects more than twenty entries", async () => {
    const accepted = Object.assign(new AnalyzeUrlDto(), {
      urls: ["https://example.com/one", "https://example.com/two"],
    });
    const rejected = Object.assign(new AnalyzeUrlDto(), {
      urls: Array.from({ length: 21 }, (_, index) =>
        `https://example.com/${index}`,
      ),
    });

    expect(await validate(accepted)).toHaveLength(0);
    expect(await validate(rejected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "urls" })]),
    );
  });
});
