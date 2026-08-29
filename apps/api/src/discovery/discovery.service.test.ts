import { DiscoveryAction } from "@tokusatsu/db";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import { DiscoveryService } from "./discovery.service.js";

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    discoveryFeedback: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    item: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: unknown) => Promise<unknown>)(prisma);
    }),
    ...overrides,
  };
  return {
    prisma,
    service: new DiscoveryService(prisma as unknown as PrismaService),
  };
}

describe("DiscoveryService", () => {
  it("excludes active consumed listings while keeping a paged preload", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findMany.mockResolvedValue([
      { listingId: "consumed-listing" },
    ]);
    prisma.item.findMany.mockResolvedValue([{ id: "next-listing" }]);
    prisma.item.count.mockResolvedValue(8);

    const result = await service.feed(12);

    expect(result.total).toBe(8);
    expect(result.items).toEqual([{ id: "next-listing" }]);
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 12,
        where: expect.objectContaining({
          id: { notIn: ["consumed-listing"] },
          favorite: false,
        }),
      }),
    );
  });

  it("persists favorite feedback and synchronizes the listing favorite flag", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findUnique.mockResolvedValue({
      id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      productId: null,
      favorite: false,
      archivedAt: null,
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "feedback-1",
      action: DiscoveryAction.favorite,
    });
    prisma.item.update.mockResolvedValue({});

    const result = await service.feedback({
      listingId: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      action: "favorite",
      position: 4,
      recommendationScore: 91,
    });

    expect(result.feedback).toEqual({
      id: "feedback-1",
      action: DiscoveryAction.favorite,
    });
    expect(prisma.discoveryFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: DiscoveryAction.favorite,
        position: 4,
        recommendationScore: 91,
      }),
    });
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62" },
      data: { favorite: true },
    });
  });

  it("writes an undo event and restores a favorited listing", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-1",
      listingId: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      productId: null,
      action: DiscoveryAction.favorite,
      position: 2,
      recommendationScore: 87,
      undoEvents: [],
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "undo-1",
      action: DiscoveryAction.undo,
    });
    prisma.item.update.mockResolvedValue({});
    prisma.item.findUnique.mockResolvedValue({
      id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
    });

    const result = await service.undo("feedback-1");

    expect(result.feedback).toEqual({
      id: "undo-1",
      action: DiscoveryAction.undo,
    });
    expect(prisma.discoveryFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: DiscoveryAction.undo,
        undoOfId: "feedback-1",
      }),
    });
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62" },
      data: { favorite: false },
    });
  });
});
