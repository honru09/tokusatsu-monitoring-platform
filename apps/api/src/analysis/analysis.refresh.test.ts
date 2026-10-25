import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";

const queueMocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  quit: vi.fn(),
  getJob: vi.fn(),
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

import { AnalysisController } from "./analysis.controller.js";
import { AnalysisService } from "./analysis.service.js";

describe("POST /analysis/seller/:id/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMocks.add.mockResolvedValue({ id: "mock-job-id" });
    queueMocks.close.mockResolvedValue(undefined);
    queueMocks.quit.mockResolvedValue(undefined);
    queueMocks.getJob.mockResolvedValue(null);
  });

  function createService(sellerData: Record<string, unknown> | null) {
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue(sellerData),
      },
    };
    const service = new AnalysisService(prisma as never, {} as never, {} as never);
    const controller = new AnalysisController(service);
    return { service, controller, prisma };
  }

  it("1. throws NotFoundException (404) when seller does not exist", async () => {
    const { controller } = createService(null);
    await expect(controller.refreshSeller("non-existent-seller")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("2. returns unsupported_source when seller source is not mercari", async () => {
    const { controller } = createService({
      id: "s-yahoo",
      source: { key: "yahoo" },
      sourceData: null,
    });
    const result = await controller.refreshSeller("s-yahoo");
    expect(result).toEqual({ enqueued: false, reason: "unsupported_source" });
    expect(queueMocks.add).not.toHaveBeenCalled();
  });

  it("3. returns fresh when seller catalogue was refreshed within 6 hours", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { controller } = createService({
      id: "s-fresh",
      source: { key: "mercari" },
      sourceData: { lastCatalogueRefreshAt: twoHoursAgo },
    });
    const result = await controller.refreshSeller("s-fresh");
    expect(result).toEqual({ enqueued: false, reason: "fresh" });
    expect(queueMocks.add).not.toHaveBeenCalled();
  });

  it("4. enqueues refresh job when seller was refreshed > 6 hours ago or never", async () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const { controller } = createService({
      id: "s-mercari",
      source: { key: "mercari" },
      sourceData: { lastCatalogueRefreshAt: sevenHoursAgo },
    });
    const result = await controller.refreshSeller("s-mercari");
    expect(result).toEqual({ enqueued: true });
    expect(queueMocks.add).toHaveBeenCalledWith(
      "refresh",
      { sellerId: "s-mercari" },
      {
        jobId: "seller-catalogue-s-mercari",
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    expect(queueMocks.close).toHaveBeenCalled();
    expect(queueMocks.quit).toHaveBeenCalled();
  });

  it("5. removes a retained completed job so the re-add is not deduped away", async () => {
    const staleJob = {
      getState: vi.fn().mockResolvedValue("completed"),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    queueMocks.getJob.mockResolvedValue(staleJob);
    const { controller } = createService({
      id: "s-stuck",
      source: { key: "mercari" },
      sourceData: null,
    });
    const result = await controller.refreshSeller("s-stuck");
    expect(result).toEqual({ enqueued: true });
    expect(queueMocks.getJob).toHaveBeenCalledWith("seller-catalogue-s-stuck");
    expect(staleJob.remove).toHaveBeenCalled();
    expect(queueMocks.add).toHaveBeenCalled();
  });

  it("6. leaves a waiting/active job untouched so it still dedupes", async () => {
    const liveJob = {
      getState: vi.fn().mockResolvedValue("active"),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    queueMocks.getJob.mockResolvedValue(liveJob);
    const { controller } = createService({
      id: "s-live",
      source: { key: "mercari" },
      sourceData: null,
    });
    const result = await controller.refreshSeller("s-live");
    expect(result).toEqual({ enqueued: true });
    expect(liveJob.remove).not.toHaveBeenCalled();
  });
});
