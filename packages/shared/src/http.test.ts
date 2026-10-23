import { describe, expect, it } from "vitest";
import { normalizeHttpBaseUrl } from "./http.js";

describe("normalizeHttpBaseUrl", () => {
  it("adds HTTP to a Render hostport and removes trailing slashes", () => {
    expect(normalizeHttpBaseUrl("api.internal:3001/")).toBe(
      "http://api.internal:3001",
    );
  });

  it("preserves a service path but strips query and fragment", () => {
    expect(
      normalizeHttpBaseUrl("https://api.example.test/v1///?x=1#hash"),
    ).toBe("https://api.example.test/v1");
  });

  it("rejects non-HTTP protocols and embedded credentials", () => {
    expect(() => normalizeHttpBaseUrl("javascript:alert(1)")).toThrow(
      "HTTP(S)",
    );
    expect(() => normalizeHttpBaseUrl("https://user:pass@api.test")).toThrow(
      "HTTP(S)",
    );
  });
});
