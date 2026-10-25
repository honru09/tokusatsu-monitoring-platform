import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_AI_OPERATION_DEFAULTS,
  PRODUCT_AI_SCOPED_OPERATIONS,
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
      provider: "zhipu",
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
    PRODUCT_AI_SCOPED_OPERATIONS.map(
      (operation) =>
        [
          operation,
          PRODUCT_AI_OPERATION_DEFAULTS[operation],
        ] as [
          ProductAiOperation,
          (typeof PRODUCT_AI_OPERATION_DEFAULTS)[ProductAiOperation],
        ],
    ),
  )("applies the %s routing defaults", async (operation, defaults) => {
    const { gateway, service } = serviceFixture();

    await service.execute(operation, {
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "商品信息" }],
    });

    expect(gateway.executeJson).toHaveBeenCalledWith({
      responseSchema: RESPONSE_SCHEMA,
      messages: [{ role: "user", content: "商品信息" }],
      task: defaults.task,
      maxTokens: defaults.maxTokens,
      cacheTtlMs: defaults.cacheTtlMs,
      dataClass: defaults.dataClass,
      // The scoped route never spends paid capacity, whatever the
      // operation default or the caller asked for.
      costPolicy: "free_only",
      purpose: operation === "translation" ? "translation" : "product_reading",
    });
  });

  it.each(
    (Object.keys(PRODUCT_AI_OPERATION_DEFAULTS) as ProductAiOperation[]).filter(
      (operation) => !PRODUCT_AI_SCOPED_OPERATIONS.includes(operation),
    ),
  )("refuses the out-of-scope %s operation before the gateway", (operation) => {
    const { gateway, service } = serviceFixture();

    expect(() =>
      service.execute(operation, {
        responseSchema: RESPONSE_SCHEMA,
        messages: [{ role: "user", content: "商品信息" }],
      }),
    ).toThrow(ServiceUnavailableException);
    expect(() =>
      service.execute(operation, {
        responseSchema: RESPONSE_SCHEMA,
        messages: [{ role: "user", content: "商品信息" }],
      }),
    ).toThrow("当前 AI 仅用于商品读取、翻译和聊天");
    expect(gateway.executeJson).not.toHaveBeenCalled();
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

});
