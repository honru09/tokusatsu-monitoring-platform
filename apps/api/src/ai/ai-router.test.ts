import { afterEach, describe, expect, it } from "vitest";
import { AI_MODEL_ALLOWLIST, routeFor } from "./ai-router.js";

const originalRoute = process.env.AI_ROUTE_ASSISTANT_CHAT;

afterEach(() => {
  if (originalRoute == null) delete process.env.AI_ROUTE_ASSISTANT_CHAT;
  else process.env.AI_ROUTE_ASSISTANT_CHAT = originalRoute;
});

describe("assistant AI route", () => {
  it("uses the Central AI Brain route from the approved B.AI model registry", () => {
    delete process.env.AI_ROUTE_ASSISTANT_CHAT;

    expect(routeFor("assistant_chat")).toEqual([
      "glm-5.3-flash",
      "qwen3.8-flash",
      "mimo-v2.5",
    ]);
  });

  it("rejects every model outside the six-model report allowlist", () => {
    process.env.AI_ROUTE_ASSISTANT_CHAT =
      "gpt-5.6-sol|unapproved/free|glm-5.3-flash|glm-5.3-flash|deepseek-v4-pro";

    expect(routeFor("assistant_chat")).toEqual(["glm-5.3-flash"]);
    expect(AI_MODEL_ALLOWLIST).toEqual(
      new Set([
        "mimo-v2.5",
        "glm-5.3-flash",
        "deepseek-v4-flash-vision-exp",
        "qwen3.8-flash",
        "deepseek-v4-flash",
        "hy3",
      ]),
    );
  });
});
