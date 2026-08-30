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
            id: "item-1",
            sourceUrl: "https://jp.mercari.com/item/m123",
          },
          {
            id: "item-2",
            sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/y456",
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
    });
    expect(cartShareCreate).not.toHaveBeenCalled();
  });
});
