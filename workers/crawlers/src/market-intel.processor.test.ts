import { describe, expect, it, vi } from "vitest";
import { runMarketIntelTwoPhase } from "./market-intel.processor.js";

describe("market intelligence refresh", () => {
  it("persists every original-language candidate before an unavailable AI stops translation", async () => {
    const events: string[] = [];
    const translate = vi.fn(async (record: { key: string }) => {
      events.push(`translate:${record.key}`);
      throw new Error("paid_automation_not_authorized");
    });

    const result = await runMarketIntelTwoPhase<
      string,
      { key: string; inserted: boolean }
    >(
      ["one", "two", "three"],
      async (key) => {
        events.push(`persist:${key}`);
        return { key, inserted: true };
      },
      translate,
      () => true,
    );

    expect(events).toEqual([
      "persist:one",
      "persist:two",
      "persist:three",
      "translate:one",
    ]);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      inserted: 3,
      translated: 0,
      failed: 1,
      deferred: true,
    });
  });

  it("continues translating later records after an isolated content failure", async () => {
    const translated: string[] = [];
    const result = await runMarketIntelTwoPhase<
      string,
      { key: string; inserted: boolean }
    >(
      ["one", "two"],
      async (key) => ({ key, inserted: false }),
      async (record) => {
        if (record.key === "one") throw new Error("invalid translation");
        translated.push(record.key);
      },
      () => false,
    );

    expect(translated).toEqual(["two"]);
    expect(result).toEqual({
      inserted: 0,
      translated: 1,
      failed: 1,
      deferred: false,
    });
  });
});
