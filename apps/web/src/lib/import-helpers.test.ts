import { describe, expect, it } from "vitest";
import {
  friendlyImportError,
  publicUrlsFromInput,
} from "./import-helpers";

describe("friendlyImportError", () => {
  it("returns default message for empty or missing values", () => {
    expect(friendlyImportError()).toBe("分析未完成，可稍后重试");
    expect(friendlyImportError(null)).toBe("分析未完成，可稍后重试");
    expect(friendlyImportError("")).toBe("分析未完成，可稍后重试");
  });

  it("maps database constraint errors to seller profile write failure message", () => {
    expect(
      friendlyImportError("PrismaClientKnownRequestError: 42P10 constraint"),
    ).toBe("卖家资料写入失败；系统已更新，请重新提交该链接");
  });

  it("maps network and timeout errors", () => {
    expect(friendlyImportError("Failed to fetch resource")).toBe(
      "网络暂时不可用，请稍后重试",
    );
    expect(friendlyImportError("Request timed out after 10000ms")).toBe(
      "网络暂时不可用，请稍后重试",
    );
  });

  it("maps NoPublicPriceError to user-friendly message", () => {
    expect(
      friendlyImportError(
        "NoPublicPriceError: Mercari detail page did not contain a public price",
      ),
    ).toBe("商品页已无公开价格，无法自动分析");
    expect(
      friendlyImportError(
        "Error: Item did not contain a public price on the page",
      ),
    ).toBe("商品页已无公开价格，无法自动分析");
  });

  it("maps book/card filter errors to out-of-scope message", () => {
    expect(friendlyImportError("Error: 已过滤书籍或卡片类商品")).toBe(
      "书籍 / 卡片类商品不在登记范围",
    );
    expect(friendlyImportError("书籍或卡片")).toBe(
      "书籍 / 卡片类商品不在登记范围",
    );
  });

  it("strips Error: prefix and returns fallback for pure English technical errors", () => {
    expect(friendlyImportError("Error: connection refused 127.0.0.1:8080")).toBe(
      "分析失败，可稍后重试",
    );
    expect(friendlyImportError("Internal Server Error (500)")).toBe(
      "分析失败，可稍后重试",
    );
  });

  it("strips Error: prefix but retains Chinese error text up to 120 chars", () => {
    expect(friendlyImportError("Error: 卖家已将商品下架")).toBe(
      "卖家已将商品下架",
    );
    expect(friendlyImportError("Error:   商品库存不足，无法购买   ")).toBe(
      "商品库存不足，无法购买",
    );
  });
});

describe("publicUrlsFromInput", () => {
  it("extracts valid HTTP and HTTPS URLs and deduplicates", () => {
    const input = `
      https://jp.mercari.com/item/m1
      http://example.com/test
      https://jp.mercari.com/item/m1
      invalid-url
    `;
    expect(publicUrlsFromInput(input)).toEqual([
      "https://jp.mercari.com/item/m1",
      "http://example.com/test",
    ]);
  });
});
