import { afterEach, describe, expect, it, vi } from "vitest";
import { processAiOperations } from "./ai-operations.processor.js";
import { resetAutomaticAiGuardForTests } from "./background-ai-guard.js";

const originalToken = process.env.AI_INTERNAL_TOKEN;
const originalApiUrl = process.env.API_INTERNAL_URL;

afterEach(() => {
  resetAutomaticAiGuardForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalToken == null) delete process.env.AI_INTERNAL_TOKEN;
  else process.env.AI_INTERNAL_TOKEN = originalToken;
  if (originalApiUrl == null) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("automatic market-memory refresh", () => {
  it("does not call the internal AI endpoint when paid automation is disabled", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const fetcher = vi.fn(async () => Response.json({ refreshed: true }));
    vi.stubGlobal("fetch", fetcher);

    await expect(processAiOperations()).resolves.toEqual({
      skipped: "paid_automation_not_authorized",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("coalesces duplicate bootstrap/repeat work into one paid request", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    process.env.API_INTERNAL_URL = "http://api:3001";
    const fetcher = vi.fn(async () => Response.json({ refreshed: true }));
    vi.stubGlobal("fetch", fetcher);

    const [first, duplicate] = await Promise.all([
      processAiOperations(),
      processAiOperations(),
    ]);

    expect(first).toEqual({ refreshed: true });
    expect(duplicate).toEqual({ refreshed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("defers subsequent memory work after a shared provider outage", async () => {
    process.env.AI_INTERNAL_TOKEN = "worker-token";
    const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(processAiOperations()).resolves.toMatchObject({
      skipped: "ai_gateway_temporarily_unavailable",
    });
    await expect(processAiOperations()).resolves.toMatchObject({
      skipped: "ai_gateway_temporarily_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
