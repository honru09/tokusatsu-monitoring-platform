import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_AI_OPERATION_DEFAULTS,
  ProductAiService,
  type ProductAiOperation,
} from "./product-ai.service.js";
import { recordResponseSchema } from "./ai-response-schema.js";

const RESPONSE_SCHEMA = recordResponseSchema(
  "test.product-operation",
  1,
  (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { success: true as const, value: value as Record<string, unknown> }
      : { success: false as const, issues: [{ path: "$", code: "type" }] },
);

function serviceFixture() {
  const gateway = {
    executeJson: vi.fn().mockResolvedValue({
      data: { ok: true },
      provider: "bai",
      model: "test-model",
    }),
  };
  return {
    gateway,
    service: new ProductAiService(gateway as never),
  };
}

describe("ProductAiService", () => {
  it.each(
    Object.entries(PRODUCT_AI_OPERATION_DEFAULTS) as Array<
      [
        ProductAiOperation,
        (typeof PRODUCT_AI_OPERATION_DEFAULTS)[ProductAiOperation],
      ]
    >,
  )("applies the %s routing defaults", async (operation, defaults) => {
    const { gateway, service } = serviceFixture();

    await service.execute(operation, {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "商品信息" }],
    });

    expect(gateway.executeJson).toHaveBeenCalledWith({
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "商品信息" }],
      ...defaults,
    });
  });

  it("forces images without a verified item to sensitive data", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("image_analysis", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "识别图片" }],
      imageUrls: ["https://images.example.test/private.jpg"],
      dataClass: "public_market",
    });

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({ dataClass: "sensitive_image" }),
    );
  });

  it("does not treat an item id alone as proof that an image is public", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("image_analysis", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "识别图片" }],
      imageUrls: ["https://images.example.test/public.jpg"],
      itemId: "item-1",
    });

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({ dataClass: "sensitive_image" }),
    );
  });

  it("does not accept an item id and caller classification as proof that an image is public", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("image_analysis", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "识别图片" }],
      imageUrls: ["https://images.example.test/public.jpg"],
      itemId: "item-1",
      dataClass: "public_market",
    });

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({ dataClass: "sensitive_image" }),
    );
  });

  it("accepts a public classification only after server-side image verification", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("image_analysis", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "识别图片" }],
      imageUrls: ["https://images.example.test/public.jpg"],
      itemId: "item-1",
      dataClass: "public_market",
      publicImageUrlsVerified: true,
    });

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        dataClass: "public_market",
      }),
    );
  });

  it("honors explicit execution policy overrides", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("title_parsing", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "解析标题" }],
      maxTokens: 777,
      cacheTtlMs: 123,
      dataClass: "user_private",
      costPolicy: "free_only",
    });

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "classification",
        maxTokens: 777,
        cacheTtlMs: 123,
        dataClass: "user_private",
        costPolicy: "free_only",
      }),
    );
  });

  it("routes procurement filtering through bulk_filter with procurement defaults", async () => {
    const { gateway, service } = serviceFixture();

    await service.execute("procurement_filter", {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "筛选采购候选" }],
    });

    expect(gateway.executeJson).toHaveBeenCalledWith({
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "筛选采购候选" }],
      task: "bulk_filter",
      maxTokens: 1_600,
      cacheTtlMs: 7 * 24 * 60 * 60_000,
      dataClass: "public_market",
      costPolicy: "free_first",
    });
  });
});
