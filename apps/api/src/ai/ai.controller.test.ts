import { BadRequestException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiController } from "./ai.controller.js";

describe("AiController internal endpoints", () => {
  const originalToken = process.env.AI_INTERNAL_TOKEN;

  function expectBadRequest(action: () => unknown) {
    try {
      action();
      throw new Error("Expected request validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  }

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AI_INTERNAL_TOKEN;
    else process.env.AI_INTERNAL_TOKEN = originalToken;
  });

  it("requires the internal token before image analysis", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const system = { analyzeImages: vi.fn() };
    const controller = new AiController(
      system as never,
      {} as never,
      {} as never,
    );
    const body = {
      title: "item",
      imageUrls: ["https://images.example.test/item.jpg"],
    };

    expect(() => controller.analyzeImages(undefined, body)).toThrow(
      "Invalid AI internal token",
    );
    expect(system.analyzeImages).not.toHaveBeenCalled();
  });

  it("forwards a trusted image request", async () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const system = { analyzeImages: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AiController(
      system as never,
      {} as never,
      {} as never,
    );
    const body = {
      title: "item",
      imageUrls: ["https://images.example.test/item.jpg"],
    };

    await expect(
      controller.analyzeImages("expected-token", body, "item-1"),
    ).resolves.toEqual({ ok: true });
    expect(system.analyzeImages).toHaveBeenCalledWith(body, "item-1");
  });

  it("routes trusted product operations through ProductAiService", async () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );
    const body = {
      operation: "title_parsing" as const,
      responseSchemaId: "internal.china-search-keywords" as const,
      responseSchemaVersion: 1,
      itemId: "item-1",
      maxTokens: 512,
      messages: [{ role: "user" as const, content: "parse" }],
    };

    await expect(
      controller.executeProductInternal("expected-token", body),
    ).resolves.toEqual({ ok: true });
    expect(productAi.execute).toHaveBeenCalledWith(
      "title_parsing",
      expect.objectContaining({
        itemId: "item-1",
        maxTokens: 512,
        messages: body.messages,
        responseSchema: expect.objectContaining({
          id: "internal.china-search-keywords",
          version: 1,
        }),
      }),
    );
  });

  it("rejects product operations without the internal token", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn() };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );

    expect(() =>
      controller.executeProductInternal(undefined, {
        operation: "product_identification",
        responseSchemaId: "internal.china-candidate-decisions",
        responseSchemaVersion: 1,
        expectedIds: ["listing-1"],
        messages: [{ role: "user", content: "identify" }],
      }),
    ).toThrow("Invalid AI internal token");
    expect(productAi.execute).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown internal response schema", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn() };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );

    expectBadRequest(() =>
      controller.executeProductInternal("expected-token", {
        operation: "title_parsing",
        responseSchemaId: "client.unknown",
        responseSchemaVersion: 1,
        messages: [{ role: "user", content: "parse" }],
      } as never),
    );
    expect(productAi.execute).not.toHaveBeenCalled();
  });

  it("rejects a known response contract on the wrong product operation", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn() };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );

    expect(() =>
      controller.executeProductInternal("expected-token", {
        operation: "automatic_classification",
        responseSchemaId: "internal.china-search-keywords",
        responseSchemaVersion: 1,
        messages: [{ role: "user", content: "classify" }],
      }),
    ).toThrow("Response schema is not allowed for operation");
    expect(productAi.execute).not.toHaveBeenCalled();
  });

  it("uses only the server-owned schema for the generic internal endpoint", async () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const gateway = { executeJson: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AiController(
      {} as never,
      gateway as never,
      {} as never,
    );
    const clientSchema = { id: "client.supplied", version: 999 };

    await controller.executeInternal("expected-token", {
      task: "translation",
      responseSchemaId: "internal.market-intel-translation",
      responseSchemaVersion: 1,
      maxTokens: 500,
      messages: [{ role: "user", content: "translate" }],
      responseSchema: clientSchema,
    } as never);

    const request = gateway.executeJson.mock.calls[0]?.[0];
    expect(request.responseSchema).not.toBe(clientSchema);
    expect(request.responseSchema).toMatchObject({
      id: "internal.market-intel-translation",
      version: 1,
    });
  });

  it.each([
    {
      task: "translation" as const,
      responseSchemaId: "internal.market-intel-translation" as const,
      responseSchemaVersion: 2,
    },
    {
      task: "crawler_diagnosis" as const,
      responseSchemaId: "internal.market-intel-translation" as const,
      responseSchemaVersion: 1,
    },
  ])("rejects an incompatible gateway schema before execution", (reference) => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const gateway = { executeJson: vi.fn() };
    const controller = new AiController(
      {} as never,
      gateway as never,
      {} as never,
    );

    expectBadRequest(() =>
      controller.executeInternal("expected-token", {
        ...reference,
        maxTokens: 64,
        messages: [{ role: "user", content: "run" }],
      }),
    );
    expect(gateway.executeJson).not.toHaveBeenCalled();
  });

  it("rejects incompatible expected IDs before product execution", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn() };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );

    expectBadRequest(() =>
      controller.executeProductInternal("expected-token", {
        operation: "title_parsing",
        responseSchemaId: "internal.china-search-keywords",
        responseSchemaVersion: 1,
        expectedIds: ["listing-1"],
        messages: [{ role: "user", content: "parse" }],
      }),
    );
    expect(productAi.execute).not.toHaveBeenCalled();
  });

  it("does not forward client-owned schema fields to ProductAiService", async () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const productAi = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AiController(
      {} as never,
      {} as never,
      productAi as never,
    );
    const clientSchema = { id: "client.owned-schema", version: 999 };

    await controller.executeProductInternal("expected-token", {
      operation: "title_parsing",
      responseSchemaId: "internal.china-search-keywords",
      responseSchemaVersion: 1,
      messages: [{ role: "user", content: "parse" }],
      responseContract: "legacy_contract",
      responseSchema: clientSchema,
    } as never);

    const input = productAi.execute.mock.calls[0]?.[1];
    expect(input).not.toHaveProperty("responseContract");
    expect(input.responseSchema).not.toBe(clientSchema);
    expect(input.responseSchema).toMatchObject({
      id: "internal.china-search-keywords",
      version: 1,
    });
  });
});
