import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_AI_RESPONSE_SCHEMAS,
  executeProductAi,
} from "./product-ai.client.js";
import { resetAutomaticAiGuardForTests } from "./background-ai-guard.js";

const originalToken = process.env.AI_INTERNAL_TOKEN;
const originalApiUrl = process.env.API_INTERNAL_URL;

afterEach(() => {
  resetAutomaticAiGuardForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalToken === undefined) delete process.env.AI_INTERNAL_TOKEN;
  else process.env.AI_INTERNAL_TOKEN = originalToken;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Product AI worker client", () => {
  it("does not call the Product AI endpoint when paid automation is disabled", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeProductAi({
        operation: "automatic_classification",
        ...PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
        itemId: "item-disabled",
        messages: [{ role: "user", content: "classify" }],
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs a free-authorized operation when only free automation is enabled", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    process.env.API_INTERNAL_URL = "http://api.internal/";
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          data: { scope: "tokusatsu_toy" },
          provider: "zhipu",
          model: "glm-5.3-flash",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeProductAi(
        {
          operation: "automatic_classification",
          ...PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
          itemId: "item-free-only",
          messages: [{ role: "user", content: "classify" }],
        },
        { authorization: "free" },
      ),
    ).resolves.toMatchObject({ data: { scope: "tokusatsu_toy" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("still refuses a default (paid) operation when only free automation is enabled", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeProductAi({
        operation: "automatic_classification",
        ...PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
        itemId: "item-default-paid",
        messages: [{ role: "user", content: "classify" }],
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps every worker response schema pinned to the server allowlist", () => {
    expect(PRODUCT_AI_RESPONSE_SCHEMAS).toEqual({
      chinaSearchKeywords: {
        responseSchemaId: "internal.china-search-keywords",
        responseSchemaVersion: 1,
      },
      chinaCandidateDecisions: {
        responseSchemaId: "internal.china-candidate-decisions",
        responseSchemaVersion: 1,
      },
      procurementReview: {
        responseSchemaId: "internal.procurement-review",
        responseSchemaVersion: 1,
      },
      automaticClassification: {
        responseSchemaId: "internal.automatic-classification",
        responseSchemaVersion: 1,
      },
      advancedClassification: {
        responseSchemaId: "internal.advanced-classification",
        responseSchemaVersion: 1,
      },
    });
  });

  it("calls the internal ProductAiService endpoint with the trusted token", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    process.env.API_INTERNAL_URL = "http://api.internal/";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          data: { keywords: ["假面骑士"] },
          provider: "bai",
          model: "fast",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeProductAi<{ keywords: string[] }>({
        operation: "title_parsing",
        ...PRODUCT_AI_RESPONSE_SCHEMAS.chinaSearchKeywords,
        maxTokens: 512,
        messages: [{ role: "user", content: "parse" }],
      }),
    ).resolves.toMatchObject({ data: { keywords: ["假面骑士"] } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://api.internal/ai/internal/product/execute");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("x-ai-internal-token")).toBe(
      "worker-token",
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      operation: "title_parsing",
      responseSchemaId: "internal.china-search-keywords",
      responseSchemaVersion: 1,
      dataClass: "public_market",
      costPolicy: "free_first",
      maxTokens: 512,
    });
    expect(body).not.toHaveProperty("responseContract");
    expect(body).not.toHaveProperty("responseSchema");
  });

  it("adds http to a Render hostport API address", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    process.env.API_INTERNAL_URL = "api.internal:3001";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          data: { keywords: ["假面骑士"] },
          provider: "bai",
          model: "fast",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeProductAi({
      operation: "title_parsing",
      ...PRODUCT_AI_RESPONSE_SCHEMAS.chinaSearchKeywords,
      messages: [{ role: "user", content: "parse" }],
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://api.internal:3001/ai/internal/product/execute",
    );
  });

  it("does not make a request when the internal token is absent", async () => {
    delete process.env.AI_INTERNAL_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeProductAi({
        operation: "product_identification",
        ...PRODUCT_AI_RESPONSE_SCHEMAS.chinaCandidateDecisions,
        expectedIds: ["listing-1"],
        messages: [{ role: "user", content: "identify" }],
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes an upstream response body in an error", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("provider-secret-detail", { status: 502 }),
      ),
    );

    await expect(
      executeProductAi({
        operation: "automatic_classification",
        ...PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
        messages: [{ role: "user", content: "classify" }],
      }),
    ).rejects.toThrow("Product AI request failed (502)");
  });

  it("does not call another paid background operation during a shared outage cooldown", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      operation: "automatic_classification" as const,
      ...PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
      itemId: "item-1",
      messages: [{ role: "user" as const, content: "classify" }],
    };

    await expect(
      executeProductAi(request, { softHttpFailure: true }),
    ).resolves.toBeNull();
    await expect(
      executeProductAi(
        { ...request, itemId: "item-2" },
        { softHttpFailure: true },
      ),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
