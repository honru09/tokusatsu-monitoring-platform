import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyTimeoutMs } from "../../../lib/proxy-timeout";
import { forwardedClientIp } from "../../../lib/forwarded-client-ip";
import { POST } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("backend proxy", () => {
  it("prefers a strictly valid Cloudflare client IP", () => {
    expect(
      forwardedClientIp(
        new Headers({
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.20, 172.18.0.1",
        }),
      ),
    ).toBe("203.0.113.10");
    expect(
      forwardedClientIp(
        new Headers({
          "cf-connecting-ip": "not-an-ip",
          "x-forwarded-for": "198.51.100.20",
        }),
      ),
    ).toBeUndefined();
  });

  it("forwards only allowlisted headers and a normalized internal client IP", async () => {
    let upstreamHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: URL, init: RequestInit) => {
        upstreamHeaders = new Headers(init.headers);
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    const response = await POST(
      new Request("http://localhost/backend/ai/chat", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer must-not-pass",
          "cf-connecting-ip": "::ffff:203.0.113.10",
          "content-type": "application/json",
          cookie: "must-not-pass=true",
          "x-client-ip": "192.0.2.99",
          "x-forwarded-for": "198.51.100.20",
        },
        body: '{"message":"检查"}',
      }),
      { params: Promise.resolve({ path: ["ai", "chat"] }) },
    );

    expect(response.status).toBe(200);
    expect(upstreamHeaders.get("accept")).toBe("application/json");
    expect(upstreamHeaders.get("content-type")).toBe("application/json");
    expect(upstreamHeaders.get("x-client-ip")).toBe("203.0.113.10");
    expect(upstreamHeaders.get("authorization")).toBeNull();
    expect(upstreamHeaders.get("cookie")).toBeNull();
    expect(upstreamHeaders.get("cf-connecting-ip")).toBeNull();
    expect(upstreamHeaders.get("x-forwarded-for")).toBeNull();
  });

  it("keeps the AI proxy budget above the gateway deadline", () => {
    const original = process.env.AI_PROXY_TIMEOUT_MS;
    delete process.env.AI_PROXY_TIMEOUT_MS;
    expect(proxyTimeoutMs(["ai", "chat"])).toBe(270_000);
    expect(proxyTimeoutMs(["items"])).toBe(60_000);
    process.env.AI_PROXY_TIMEOUT_MS = "999999";
    expect(proxyTimeoutMs(["ai", "chat"])).toBe(300_000);
    if (original == null) delete process.env.AI_PROXY_TIMEOUT_MS;
    else process.env.AI_PROXY_TIMEOUT_MS = original;
  });

  it("converts an empty upstream error into JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    const response = await POST(
      new Request("http://localhost/backend/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"message":"检查"}',
      }),
      { params: Promise.resolve({ path: ["ai", "chat"] }) },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: "UPSTREAM_EMPTY_RESPONSE",
        retryable: true,
      }),
    );
  });

  it("returns a retryable JSON response when the upstream request times out", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    const response = await POST(
      new Request("http://localhost/backend/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"message":"检查"}',
      }),
      { params: Promise.resolve({ path: ["ai", "chat"] }) },
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ code: "UPSTREAM_TIMEOUT", retryable: true }),
    );
  });
});
