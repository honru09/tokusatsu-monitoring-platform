import { describe, expect, it } from "vitest";
import { calmStatusMessage, readFetchError } from "./fetch-error";

describe("calmStatusMessage", () => {
  it("rewrites raw API 502 strings into calm Chinese copy", () => {
    expect(calmStatusMessage("API 502", 502, "发现队列暂时无法加载")).toBe(
      "后台服务暂时无法连接，请稍后重试",
    );
    expect(calmStatusMessage("502", 502, "fallback")).toBe(
      "后台服务暂时无法连接，请稍后重试",
    );
  });

  it("keeps already-calm proxy messages", () => {
    expect(
      calmStatusMessage("后台服务暂时无法连接，请稍后重试", 502, "fallback"),
    ).toBe("后台服务暂时无法连接，请稍后重试");
  });
});

describe("readFetchError", () => {
  it("reads proxy JSON and calms status-only bodies", async () => {
    const fromJson = await readFetchError(
      new Response(
        JSON.stringify({ message: "后台服务暂时无法连接，请稍后重试" }),
        {
          status: 502,
        },
      ),
      "发现队列暂时无法加载",
    );
    expect(fromJson).toBe("后台服务暂时无法连接，请稍后重试");

    const fromRaw = await readFetchError(
      new Response("API 502", { status: 502 }),
      "发现队列暂时无法加载",
    );
    expect(fromRaw).toBe("后台服务暂时无法连接，请稍后重试");
  });
});
