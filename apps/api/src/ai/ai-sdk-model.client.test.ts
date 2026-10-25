import { describe, expect, it } from "vitest";
import {
  AiSdkHttpError,
  isSafeExternalImageUrl,
} from "./ai-sdk-model.client.js";

describe("isSafeExternalImageUrl", () => {
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
  ])("rejects %s image URLs", (_case, url) => {
    expect(isSafeExternalImageUrl(url)).toBe(false);
  });

  it("accepts a public HTTPS image URL", () => {
    expect(isSafeExternalImageUrl("https://images.test/item.jpg")).toBe(true);
    expect(isSafeExternalImageUrl("https://8.8.8.8/item.jpg")).toBe(true);
  });
});

describe("AiSdkHttpError", () => {
  it("carries the HTTP metadata gateway decisions need", () => {
    const error = new AiSdkHttpError(
      429,
      "rate limited",
      new Headers({ "retry-after": "2" }),
      "request failed",
    );
    expect(error).toMatchObject({
      name: "AiSdkHttpError",
      statusCode: 429,
      responseBody: "rate limited",
    });
    expect(error.responseHeaders.get("retry-after")).toBe("2");
  });
});
