import { NotFoundException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBundleNegotiationScript,
  NegotiationScriptService,
} from "./negotiation-script.service.js";

afterEach(() => vi.unstubAllEnvs());

const roundItems = [
  { roundId: "round-1", itemId: "item-1", targetPriceYen: 8_000, copiedAt: null },
  { roundId: "round-1", itemId: "item-2", targetPriceYen: null, copiedAt: null },
  { roundId: "round-1", itemId: "item-3", targetPriceYen: 5_000, copiedAt: null },
];

const items = [
  {
    id: "item-1",
    titleRaw: "仮面ライダー フィギュア",
    priceCurrent: 10_000,
    shippingFee: 500,
    sourceUrl: "https://example.com/items/1",
    sellerId: "seller-1",
    seller: { id: "seller-1", name: "特摄商店" },
  },
  {
    id: "item-2",
    titleRaw: "ウルトラマン ソフビ",
    priceCurrent: 6_000,
    shippingFee: null,
    sourceUrl: "https://example.com/items/2",
    sellerId: "seller-1",
    seller: { id: "seller-1", name: "特摄商店" },
  },
  {
    id: "item-3",
    titleRaw: "戦隊 ロボット",
    priceCurrent: 7_000,
    shippingFee: 300,
    sourceUrl: "https://example.com/items/3",
    sellerId: null,
    seller: null,
  },
];

function fixture(gateway?: { executeJson: ReturnType<typeof vi.fn> }) {
  const prisma = {
    shareRound: {
      findUnique: vi.fn().mockResolvedValue({
        id: "round-1",
        createdById: "manager-1",
        createdAt: new Date(),
        note: null,
      }),
    },
    shareRoundItem: { findMany: vi.fn().mockResolvedValue(roundItems) },
    item: { findMany: vi.fn().mockResolvedValue(items) },
  };
  const service = new NegotiationScriptService(
    prisma as never,
    gateway as never,
  );
  return { prisma, service };
}

describe("NegotiationScriptService", () => {
  it("returns the fixed template per seller group without calling the gateway when the flag is off", async () => {
    const gateway = { executeJson: vi.fn() };
    const { service } = fixture(gateway);
    const result = await service.negotiationScript("round-1");
    expect(gateway.executeJson).not.toHaveBeenCalled();
    expect(result.roundId).toBe("round-1");
    expect(result.groups).toHaveLength(2);
    const sellerGroup = result.groups[0];
    expect(sellerGroup).toMatchObject({
      sellerId: "seller-1",
      sellerName: "特摄商店",
      itemIds: ["item-1", "item-2"],
      fallback: true,
    });
    // Group target: 8,000 target + 6,000 listed fallback = 14,000.
    expect(sellerGroup.script).toBe(
      buildBundleNegotiationScript(
        [
          { titleRaw: "仮面ライダー フィギュア", priceCurrent: 10_000 },
          { titleRaw: "ウルトラマン ソフビ", priceCurrent: 6_000 },
        ],
        14_000,
      ),
    );
    expect(sellerGroup.script).toContain("合計14,000円");
    const singleGroup = result.groups[1];
    expect(singleGroup).toMatchObject({
      sellerId: null,
      sellerName: null,
      itemIds: ["item-3"],
      fallback: true,
    });
    expect(singleGroup.script).toContain("5,000円にお値下げ可能でしょうか？");
  });

  it("falls back to the template when generation fails", async () => {
    vi.stubEnv("AI_EXTENDED_SCOPES_ENABLED", "true");
    const gateway = {
      executeJson: vi.fn().mockRejectedValue(new Error("gateway down")),
    };
    const { service } = fixture(gateway);
    const result = await service.negotiationScript("round-1");
    expect(gateway.executeJson).toHaveBeenCalledTimes(2);
    expect(result.groups.every((group) => group.fallback)).toBe(true);
    expect(result.groups[0].script).toContain("合計14,000円");
  });

  it("returns the generated script with one call per seller group", async () => {
    vi.stubEnv("AI_EXTENDED_SCOPES_ENABLED", "true");
    const gateway = {
      executeJson: vi.fn().mockResolvedValue({
        data: { scriptJa: "生成された話術です。", scriptZh: "生成的话术。" },
        model: "glm-5.3-flash",
      }),
    };
    const { service } = fixture(gateway);
    const result = await service.negotiationScript("round-1");
    expect(gateway.executeJson).toHaveBeenCalledTimes(2);
    for (const call of gateway.executeJson.mock.calls) {
      expect(call[0]).toMatchObject({ task: "bundle_negotiation" });
    }
    expect(result.groups).toEqual([
      expect.objectContaining({
        sellerId: "seller-1",
        script: "生成された話術です。",
        fallback: false,
      }),
      expect.objectContaining({
        sellerId: null,
        script: "生成された話術です。",
        fallback: false,
      }),
    ]);
  });

  it("rejects an unknown round", async () => {
    const { service, prisma } = fixture();
    prisma.shareRound.findUnique.mockResolvedValueOnce(null);
    await expect(service.negotiationScript("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("buildBundleNegotiationScript", () => {
  it("matches the fixed wording for single and multi item groups", () => {
    expect(
      buildBundleNegotiationScript(
        [{ titleRaw: "商品A", priceCurrent: 3_000 }],
        2_500,
      ),
    ).toBe(
      "コメント失礼いたします。購入を考えているのですが、こちらの商品は2,500円にお値下げ可能でしょうか？即決いたしますので、ご検討よろしくお願いいたします。",
    );
    expect(
      buildBundleNegotiationScript(
        [
          { titleRaw: "商品A", priceCurrent: 3_000 },
          { titleRaw: "商品B", priceCurrent: 4_000 },
        ],
        null,
      ),
    ).toBe(
      [
        "コメント失礼いたします。",
        "出品されている以下の2点をまとめて購入希望です。",
        "・商品A（¥3,000）",
        "・商品B（¥4,000）",
        "同梱発送で構いませんので、まとめ割でお気持ちお値引きいただくことは可能でしょうか？",
        "即決いたしますので、ご検討よろしくお願いいたします。",
      ].join("\n"),
    );
  });
});
