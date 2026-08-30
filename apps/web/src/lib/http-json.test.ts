import { describe, expect, it } from "vitest";
import { HttpResponseError, readJsonResponse } from "./http-json";

describe("readJsonResponse", () => {
  it("turns an empty upstream error into a recoverable application error", async () => {
    const response = new Response("", { status: 504 });

    await expect(readJsonResponse(response, "AI 暂时无法回答")).rejects.toEqual(
      expect.objectContaining<HttpResponseError>({
        name: "HttpResponseError",
        message: "AI 暂时无法回答，请稍后重试",
        status: 504,
      }),
    );
  });

  it("uses a JSON error message when the API supplies one", async () => {
    const response = Response.json(
      { message: "模型正在切换，请重试" },
      { status: 503 },
    );

    await expect(readJsonResponse(response, "备用错误")).rejects.toThrow(
      "模型正在切换，请重试",
    );
  });
});
