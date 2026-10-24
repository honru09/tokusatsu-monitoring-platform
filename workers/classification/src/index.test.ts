import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyImages,
  ImageAnalysisError,
  isNonRetryableImageAnalysisError,
  selectImageAnalysisUrls,
} from "./index.js";

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

describe("selectImageAnalysisUrls", () => {
  it("keeps the first two images in listing order", () => {
    expect(
      selectImageAnalysisUrls([
        "https://images.example.test/1.jpg",
        "https://images.example.test/2.jpg",
        "https://images.example.test/3.jpg",
        "https://images.example.test/4.jpg",
      ]),
    ).toEqual([
      "https://images.example.test/1.jpg",
      "https://images.example.test/2.jpg",
    ]);
  });

  it("passes through two or fewer images unchanged", () => {
    expect(selectImageAnalysisUrls(["https://images.example.test/1.jpg"])).toEqual([
      "https://images.example.test/1.jpg",
    ]);
    expect(selectImageAnalysisUrls([])).toEqual([]);
  });
});

describe("classifyImages image selection", () => {
  it("sends at most two images to the gateway", async () => {
    process.env.AI_INTERNAL_TOKEN = "classification-token";
    let requestBody: { imageUrls?: string[] } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as {
          imageUrls?: string[];
        };
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
      imageUrls: [
        "https://images.example.test/1.jpg",
        "https://images.example.test/2.jpg",
        "https://images.example.test/3.jpg",
      ],
    });

    expect(requestBody.imageUrls).toEqual([
      "https://images.example.test/1.jpg",
      "https://images.example.test/2.jpg",
    ]);
  });
});

describe("classifyImages gateway errors", () => {
  it("marks the image-count assertion as non-retryable", async () => {
    process.env.AI_INTERNAL_TOKEN = "classification-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 400,
              message: "一次最多读取两张商品图片",
              error: "Bad Request",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const error = await classifyImages({
      title: "item",
      imageUrls: ["https://images.example.test/1.jpg"],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImageAnalysisError);
    expect((error as ImageAnalysisError).status).toBe(400);
    expect((error as Error).message).toContain("一次最多读取两张商品图片");
    expect(isNonRetryableImageAnalysisError(error)).toBe(true);
  });

  it("keeps plain server failures retryable", async () => {
    process.env.AI_INTERNAL_TOKEN = "classification-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("upstream error", {
            status: 500,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );

    const error = await classifyImages({
      title: "item",
      imageUrls: ["https://images.example.test/1.jpg"],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImageAnalysisError);
    expect(isNonRetryableImageAnalysisError(error)).toBe(false);
  });
});
