import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntime } from "./ai-provider-registry.js";
import { AiSdkHttpError, AiSdkModelClient } from "./ai-sdk-model.client.js";

function runtime(): ProviderRuntime {
  return {
    id: "litellm",
    label: "LiteLLM Gateway",
    apiUrl: "https://litellm.test/v1",
    catalogueUrl: "https://litellm.test/v1/models",
    apiTier: "paid",
    quotaScope: "credential",
    credentialIds: () => ["default"],
    headers: () => ({ authorization: "Bearer test-key" }),
    extractCatalogueModelIds: () => [],
    normalizeCatalogueModelId: (model) => model,
    normalizeRequestBody: (body) => body,
    allowsDataClass: () => true,
    costTierFor: () => "paid",
  };
}

function ovoRuntime(): ProviderRuntime {
  return {
    ...runtime(),
    id: "ovo",
    label: "OVO GPT 特惠组",
    apiUrl: "https://ovo1.cn/v1",
    catalogueUrl: "https://ovo1.cn/v1/models",
    quotaScope: "account",
    wireApi: "chat_completions",
    staticModelIds: ["gpt-5.6-luna"],
    normalizeRequestBody: (body) => body,
    headers: () => ({
      accept: "application/json",
      authorization: "Bearer test-key",
      "content-type": "application/json",
    }),
  };
}

describe("AiSdkModelClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends LiteLLM virtual models through the AI SDK", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.model).toBe("vision");
        expect(body.max_tokens).toBe(256);
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: "Return JSON.",
            }),
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                {
                  type: "image_url",
                  image_url: { url: "https://images.test/item.jpg" },
                },
              ]),
            }),
          ]),
        );
        return Response.json({
          id: "chatcmpl-1",
          created: 1,
          model: "google/gemini-vision",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"ok":true}' },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await new AiSdkModelClient().generate(
      runtime(),
      "vision",
      {
        messages: [
          { role: "system", content: "Return JSON." },
          { role: "user", content: "Inspect every image." },
        ],
        imageUrls: ["https://images.test/item.jpg"],
        maxTokens: 256,
      },
      "default",
      new AbortController().signal,
    );

    expect(response.choices[0]?.message.content).toBe('{"ok":true}');
    expect(response.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 4,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["HTTP", "http://images.test/item.jpg"],
    ["URL credentials", "https://user:password@images.test/item.jpg"],
    ["localhost", "https://localhost/item.jpg"],
    ["IPv4 loopback", "https://127.0.0.1/item.jpg"],
    ["IPv4 link-local", "https://169.254.169.254/latest/meta-data"],
    ["IPv4 private", "https://10.0.0.1/item.jpg"],
    ["IPv6 loopback", "https://[::1]/item.jpg"],
    ["IPv6 link-local", "https://[fe80::1]/item.jpg"],
    ["IPv6 private", "https://[fc00::1]/item.jpg"],
  ])("rejects %s image URLs before any network request", async (_case, url) => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "chatcmpl-unsafe",
        created: 1,
        model: "vision",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "unsafe" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AiSdkModelClient().generate(
        runtime(),
        "vision",
        {
          messages: [{ role: "user", content: "Inspect every image." }],
          imageUrls: [url],
          maxTokens: 64,
        },
        "default",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "AI_InvalidArgumentError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves HTTP metadata for gateway retry and cooldown decisions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "rate limited", type: "rate_limit_error" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      ),
    );

    await expect(
      new AiSdkModelClient().generate(
        runtime(),
        "fast",
        {
          messages: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        },
        "default",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "AiSdkHttpError",
      statusCode: 429,
    } satisfies Partial<AiSdkHttpError>);
  });

  it("uses OVO's documented Chat Completions wire format", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://ovo1.cn/v1/chat/completions");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-key",
        );
        expect(new Headers(init?.headers).get("originator")).toBeNull();
        expect(new Headers(init?.headers).get("version")).toBeNull();
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "gpt-5.6-luna",
          max_tokens: 256,
          temperature: 0.1,
        });
        expect(body).not.toHaveProperty("reasoning");
        expect(body).not.toHaveProperty("input");
        expect(body.messages).toEqual(
          expect.arrayContaining([
            { role: "system", content: "Return JSON." },
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                { type: "text", text: "Inspect every image." },
                {
                  type: "image_url",
                  image_url: { url: "https://images.test/item.jpg" },
                },
              ]),
            }),
          ]),
        );
        return Response.json({
          id: "chatcmpl-ovo-1",
          model: "gpt-5.6-luna-actual",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"answerZh":"可用"}' },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await new AiSdkModelClient().generate(
      ovoRuntime(),
      "gpt-5.6-luna",
      {
        messages: [
          { role: "system", content: "Return JSON." },
          { role: "user", content: "Inspect every image." },
        ],
        imageUrls: ["https://images.test/item.jpg"],
        maxTokens: 256,
      },
      "default",
      new AbortController().signal,
    );

    expect(response).toEqual({
      model: "gpt-5.6-luna-actual",
      choices: [{ message: { content: '{"answerZh":"可用"}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
