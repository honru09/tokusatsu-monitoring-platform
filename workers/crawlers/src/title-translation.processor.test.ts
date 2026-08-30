import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./title-translation.processor.js";

describe("fetchWithRetry", () => {
  it("retries a transient network failure and preserves the translation batch", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock;
    const wait = vi.fn(async () => undefined);

    try {
      const response = await fetchWithRetry(
        "https://api.example.test/chat/completions",
        { method: "POST" },
        4,
        wait,
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledWith(2_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
