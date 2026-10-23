import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";

const CART_KEY = "shared-procurement-workspace";

const itemInclude = {
  source: { select: { key: true, displayName: true } },
  seller: { select: { id: true, name: true } },
  images: { orderBy: { position: "asc" as const } },
  product: {
    include: {
      series: true,
      manufacturerEntity: true,
      toyTypeEntity: true,
    },
  },
} satisfies Prisma.ItemInclude;

function publicSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function preferredShareTitle(item: {
  titleZh?: string | null;
  titleRaw?: string | null;
}) {
  return (
    [item.titleZh, item.titleRaw]
      .find((value): value is string =>
        Boolean(typeof value === "string" && value.trim()),
      )
      ?.trim() ?? "未命名商品"
  );
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const cart = await this.ensureCart();
    return this.cartPayload(cart.id);
  }

  async updateItem(itemId: string, present: boolean) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("Item not found");
    const cart = await this.ensureCart();
    if (present) {
      await this.prisma.shoppingCartItem.upsert({
        where: { cartId_itemId: { cartId: cart.id, itemId } },
        update: {},
        create: { cartId: cart.id, itemId },
      });
    } else {
      await this.prisma.shoppingCartItem.deleteMany({
        where: { cartId: cart.id, itemId },
      });
    }
    return this.cartPayload(cart.id);
  }

  async createShare(itemIds?: string[], accountId?: string) {
    const cart = await this.ensureCart();
    const requestedIds = [...new Set(itemIds?.filter(Boolean) ?? [])];
    const requestedItems = requestedIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: requestedIds } },
          include: itemInclude,
        })
      : null;
    const requestedById = requestedItems
      ? new Map(requestedItems.map((item) => [item.id, item]))
      : null;
    const items = requestedById
      ? requestedIds.flatMap((id) => {
          const item = requestedById.get(id);
          return item ? [item] : [];
        })
      : (
          await this.prisma.shoppingCartItem.findMany({
            where: { cartId: cart.id },
            include: { item: { include: itemInclude } },
            orderBy: { createdAt: "asc" },
          })
        ).map((entry) => entry.item);
    if (!items.length) throw new NotFoundException("购物车中没有可分享的商品");
    const shareItems = items.flatMap((item) => {
      const sourceUrl = publicSourceUrl(item.sourceUrl);
      return sourceUrl
        ? [
            {
              id: item.id,
              title: preferredShareTitle(item),
              sourceUrl,
            },
          ]
        : [];
    });
    if (!shareItems.length)
      throw new NotFoundException("所选商品没有可分享的原始来源链接");
    const sourceUrls = shareItems.map((item) => item.sourceUrl);
    const text = shareItems
      .map((item) => `${item.title}\n${item.sourceUrl}`)
      .join("\n\n");
    if (accountId) {
      const manager = await this.prisma.managerAccount.findFirst({
        where: { id: accountId, active: true },
        select: { id: true },
      });
      if (manager) {
        await this.prisma.managerActivity.create({
          data: {
            accountId: manager.id,
            action: "share",
            count: shareItems.length,
          },
        });
      }
    }
    return {
      itemCount: shareItems.length,
      primaryUrl: sourceUrls[0],
      sourceUrls,
      items: shareItems,
      text,
    };
  }

  async shared(token: string) {
    const share = await this.prisma.cartShare.findUnique({ where: { token } });
    if (!share || (share.expiresAt && share.expiresAt < new Date()))
      throw new NotFoundException("分享清单不存在或已失效");
    return {
      token: share.token,
      snapshot: share.snapshot,
      createdAt: share.createdAt.toISOString(),
    };
  }

  private ensureCart() {
    return this.prisma.shoppingCart.upsert({
      where: { key: CART_KEY },
      update: {},
      create: { key: CART_KEY },
    });
  }

  private async cartPayload(cartId: string) {
    const entries = await this.prisma.shoppingCartItem.findMany({
      where: { cartId },
      include: { item: { include: itemInclude } },
      orderBy: { createdAt: "asc" },
    });
    return {
      cartId,
      items: entries.map((entry) => entry.item),
      count: entries.length,
      updatedAt:
        entries.at(-1)?.updatedAt.toISOString() ?? new Date().toISOString(),
    };
  }
}
