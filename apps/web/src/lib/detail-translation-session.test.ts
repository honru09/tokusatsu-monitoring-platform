import { describe, expect, it } from "vitest";
import {
  beginDetailTranslationAttempt,
  endDetailTranslationSession,
} from "./detail-translation-session";

describe("detail translation session", () => {
  it("allows only one automatic attempt while the same detail is open", () => {
    const attempts = new Set<string>();

    expect(beginDetailTranslationAttempt(attempts, "listing-1")).toBe(true);
    expect(beginDetailTranslationAttempt(attempts, "listing-1")).toBe(false);
  });

  it("allows an explicit retry without enabling an automatic retry loop", () => {
    const attempts = new Set<string>();
    beginDetailTranslationAttempt(attempts, "listing-1");

    expect(
      beginDetailTranslationAttempt(attempts, "listing-1", { retry: true }),
    ).toBe(true);
    expect(beginDetailTranslationAttempt(attempts, "listing-1")).toBe(false);
  });

  it("starts a fresh session after the detail closes", () => {
    const attempts = new Set<string>();
    beginDetailTranslationAttempt(attempts, "listing-1");

    endDetailTranslationSession(attempts, "listing-1");

    expect(beginDetailTranslationAttempt(attempts, "listing-1")).toBe(true);
  });
});
