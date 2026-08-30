import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyImages } from "./index.js";

const originalToken = process.env.AI_INTERNAL_TOKEN;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalToken === undefined) delete process.env.AI_INTERNAL_TOKEN;
  else process.env.AI_INTERNAL_TOKEN = originalToken;
});

describe("classification AI gateway authentication", () => {
  it("fails locally when the internal token is missing", async () => {
    delete process.env.AI_INTERNAL_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      classifyImages({
        title: "item",
        imageUrls: ["https://images.example.test/item.jpg"],
      }),
    ).rejects.toThrow("AI Gateway 内部令牌未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the internal token to image analysis", async () => {
    process.env.AI_INTERNAL_TOKEN = "classification-token";
    let headers = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        headers = new Headers(init?.headers);
        return Response.json({
          model: "vision-model",
          data: {
            franchise: { value: null, confidence: 0, evidence: [] },
            series: { value: null, confidence: 0, evidence: [] },
            characters: { value: null, confidence: 0, evidence: [] },
            toyTypes: { value: null, confidence: 0, evidence: [] },
            manufacturers: { value: null, confidence: 0, evidence: [] },
            quantity: { value: null, confidence: 0, evidence: [] },
            sealedCount: { value: null, confidence: 0, evidence: [] },
            packaging: { value: null, confidence: 0, evidence: [] },
            condition: { value: null, confidence: 0, evidence: [] },
            visibleDamage: { value: null, confidence: 0, evidence: [] },
            missingParts: { value: null, confidence: 0, evidence: [] },
            backMarkings: { value: null, confidence: 0, evidence: [] },
            year: { value: null, confidence: 0, evidence: [] },
            modelNumber: { value: null, confidence: 0, evidence: [] },
            copyrightText: { value: null, confidence: 0, evidence: [] },
            confidence: 0,
          },
        });
      }),
    );

    await classifyImages({
      title: "item",
      itemId: "item-1",
      imageUrls: ["https://images.example.test/item.jpg"],
    });

    expect(headers.get("x-ai-internal-token")).toBe("classification-token");
  });
});
