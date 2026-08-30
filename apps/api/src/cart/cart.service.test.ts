import { describe, expect, it, vi } from "vitest";
import { CartService } from "./cart.service.js";

describe("CartService sharing", () => {
  it("returns original marketplace URLs without creating an internal share token", async () => {
    const cartShareCreate = vi.fn();
    const prisma = {
      shoppingCart: {
        upsert: vi.fn().mockResolvedValue({ id: "cart-1" }),
      },
      item: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "item-2",
            sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/y456",
            titleZh: null,
            titleRaw: "仮面ライダー 変身ベルト",
            product: { titleZh: "假面骑士变身腰带" },
          },
          {
            id: "item-1",
            sourceUrl: "https://jp.mercari.com/item/m123",
            titleZh: "假面骑士 DX 驱动器套装",
            titleRaw: "仮面ライダー DXドライバー セット",
            product: { titleZh: "不应覆盖商品中文标题" },
          },
        ]),
      },
      shoppingCartItem: { findMany: vi.fn() },
      cartShare: { create: cartShareCreate },
    };
    const service = new CartService(prisma as never);

    await expect(service.createShare(["item-1", "item-2"])).resolves.toEqual({
      itemCount: 2,
      primaryUrl: "https://jp.mercari.com/item/m123",
      sourceUrls: [
        "https://jp.mercari.com/item/m123",
        "https://page.auctions.yahoo.co.jp/jp/auction/y456",
      ],
      items: [
        {
          id: "item-1",
          title: "假面骑士 DX 驱动器套装",
          sourceUrl: "https://jp.mercari.com/item/m123",
        },
        {
          id: "item-2",
          title: "假面骑士变身腰带",
          sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/y456",
        },
      ],
      text: [
        "假面骑士 DX 驱动器套装",
        "https://jp.mercari.com/item/m123",
        "",
        "假面骑士变身腰带",
        "https://page.auctions.yahoo.co.jp/jp/auction/y456",
      ].join("\n"),
    });
    expect(cartShareCreate).not.toHaveBeenCalled();
  });

  it("uses the same title-plus-original-URL contract for one product", async () => {
    const prisma = {
      shoppingCart: {
        upsert: vi.fn().mockResolvedValue({ id: "cart-1" }),
      },
      item: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "item-1",
            sourceUrl: "https://jp.mercari.com/item/m123",
            titleZh: null,
            titleRaw: "仮面ライダーギーツ",
            product: null,
          },
        ]),
      },
      shoppingCartItem: { findMany: vi.fn() },
    };
    const service = new CartService(prisma as never);

    await expect(service.createShare(["item-1"])).resolves.toMatchObject({
      itemCount: 1,
      primaryUrl: "https://jp.mercari.com/item/m123",
      items: [
        {
          title: "仮面ライダーギーツ",
          sourceUrl: "https://jp.mercari.com/item/m123",
        },
      ],
      text: "仮面ライダーギーツ\nhttps://jp.mercari.com/item/m123",
    });
  });
});
