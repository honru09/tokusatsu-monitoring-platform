import { afterEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@tokusatsu/db", () => ({
  prisma: {
    item: {
      findMany: dbMock.findMany,
      count: dbMock.count,
    },
  },
}));

import {
  fetchWithRetry,
  processTitleTranslation,
} from "./title-translation.processor.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("automatic title translation", () => {
  it("does not inspect the backlog or fetch when background automation is disabled", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    dbMock.findMany.mockResolvedValue([
      { id: "item-disabled", titleRaw: "仮面ライダー" },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(processTitleTranslation()).resolves.toEqual({
      skipped: "background_automation_not_authorized",
    });
    expect(dbMock.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces authorized historical title translation through the free-only route", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("API_INTERNAL_URL", "http://api:3001");
    dbMock.findMany.mockResolvedValue([
      { id: "item-free", titleRaw: "仮面ライダー まとめ売り" },
    ]);
    dbMock.count.mockResolvedValue(0);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ translations: ["假面骑士整批出售"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(processTitleTranslation()).resolves.toEqual({
      translated: 1,
      remaining: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:3001/analysis/translate?costPolicy=free_only",
      expect.objectContaining({ method: "POST" }),
    );
    expect(dbMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(dbMock.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});

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

  it("returns an exhausted gateway response immediately so the scheduler can pause", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"code":"AI_GATEWAY_ALL_FAILED"}', {
        status: 503,
        headers: { "retry-after": "600" },
      }),
    );
    globalThis.fetch = fetchMock;
    const wait = vi.fn(async () => undefined);

    try {
      const response = await fetchWithRetry(
        "https://api.example.test/analysis/translate",
        { method: "POST" },
        3,
        wait,
      );

      expect(response.status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
