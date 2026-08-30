import { afterEach, describe, expect, it, vi } from "vitest";
import { AiController } from "./ai.controller.js";

describe("AiController internal image endpoint", () => {
  const originalToken = process.env.AI_INTERNAL_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AI_INTERNAL_TOKEN;
    else process.env.AI_INTERNAL_TOKEN = originalToken;
  });

  it("requires the internal token before image analysis", () => {
    process.env.AI_INTERNAL_TOKEN = "expected-token";
    const system = { analyzeImages: vi.fn() };
    const controller = new AiController(system as never, {} as never);
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
    const controller = new AiController(system as never, {} as never);
    const body = {
      title: "item",
      imageUrls: ["https://images.example.test/item.jpg"],
    };

    await expect(
      controller.analyzeImages("expected-token", body, "item-1"),
    ).resolves.toEqual({ ok: true });
    expect(system.analyzeImages).toHaveBeenCalledWith(body, "item-1");
  });
});
