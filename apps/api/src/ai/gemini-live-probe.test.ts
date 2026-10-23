import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_OPENAI_BASE_URL,
  geminiFailure,
  preferredGeminiModels,
  runGeminiProbe,
} from "./gemini-live-probe.js";

describe("Gemini live probe", () => {
  it("normalizes the live catalogue and picks canonical preferred IDs", () => {
    expect(
      preferredGeminiModels([
        "models/gemini-3.1-flash-lite-preview",
        "models/gemma-4-31b-it",
        "models/gemini-3.1-flash-lite",
        "models/gemma-4-26b-a4b-it",
      ]),
    ).toEqual([
      {
        label: "Gemma 4 26B",
        available: true,
        model: "gemma-4-26b-a4b-it",
      },
      {
        label: "Gemma 4 31B",
        available: true,
        model: "gemma-4-31b-it",
      },
      {
        label: "Gemini 3.1 Flash Lite",
        available: true,
        model: "gemini-3.1-flash-lite",
      },
    ]);
  });

  it("rejects non-exact Gemma output and selects the first exact response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "models/gemma-4-26b-a4b-it" },
            { id: "models/gemma-4-31b-it" },
            { id: "models/gemini-3.1-flash-lite" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            { message: { content: "<thought>internal</thought>MODEL_OK" } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "MODEL_OK" } }] }),
      );

    const report = await runGeminiProbe({
      apiKey: "test-key",
      fetch: fetchMock,
      sleep: async () => undefined,
      random: () => 0.5,
    });

    expect(report.baseUrl).toBe(GEMINI_OPENAI_BASE_URL);
    expect(report.selectedModel).toBe("gemma-4-31b-it");
    expect(report.response).toBe("MODEL_OK");
    expect(report.candidates.map(({ ok }) => ok)).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      model: "gemma-4-26b-a4b-it",
      messages: [{ role: "user", content: "Reply exactly with: MODEL_OK" }],
    });
  });

  it("reports structured quota metadata without exposing credentials", async () => {
    const response = Response.json(
      {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exhausted",
          details: [
            {
              quotaMetric: "generativelanguage.googleapis.com/request_count",
              retryDelay: "12s",
            },
          ],
        },
      },
      { status: 429 },
    );

    await expect(geminiFailure(response)).resolves.toEqual({
      status: 429,
      code: "429",
      type: "RESOURCE_EXHAUSTED",
      message: "Quota exhausted",
      quotaMetric: "generativelanguage.googleapis.com/request_count",
      retryDelay: "12s",
    });
  });
});
