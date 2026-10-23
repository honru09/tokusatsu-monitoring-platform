import { describe, expect, it } from "vitest";
import { credentialedSourceEnabled } from "./source-activation.js";

describe("credentialed discovery source activation", () => {
  it.each([
    [
      "yahoo_shopping" as const,
      "YAHOO_SHOPPING_SEARCH_ENABLED",
      "YAHOO_SHOPPING_CLIENT_ID",
    ],
    [
      "firecrawl_market" as const,
      "FIRECRAWL_DISCOVERY_ENABLED",
      "FIRECRAWL_API_KEY",
    ],
    ["apify_ecommerce" as const, "APIFY_ECOMMERCE_ENABLED", "APIFY_TOKEN"],
  ])(
    "requires both the %s feature flag and a nonblank credential",
    (source, flag, credential) => {
      expect(credentialedSourceEnabled(source, {})).toBe(false);
      expect(credentialedSourceEnabled(source, { [flag]: "true" })).toBe(false);
      expect(
        credentialedSourceEnabled(source, {
          [flag]: "true",
          [credential]: "   ",
        }),
      ).toBe(false);
      expect(
        credentialedSourceEnabled(source, {
          [flag]: "false",
          [credential]: "valid-for-configuration-test",
        }),
      ).toBe(false);
      expect(
        credentialedSourceEnabled(source, {
          [flag]: "true",
          [credential]: "valid-for-configuration-test",
        }),
      ).toBe(true);
    },
  );
});
