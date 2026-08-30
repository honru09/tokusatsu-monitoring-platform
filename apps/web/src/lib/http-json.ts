export class HttpResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "HttpResponseError";
  }
}

function messageFrom(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as { message?: unknown }).message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const joined = value.filter((part) => typeof part === "string").join("；");
    return joined || undefined;
  }
  return undefined;
}

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await response.text();
  let body: unknown;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) {
        throw new HttpResponseError(
          `${fallbackMessage}，服务返回格式异常，请重试`,
          response.status,
        );
      }
    }
  }

  if (!response.ok) {
    throw new HttpResponseError(
      messageFrom(body) ?? `${fallbackMessage}，请稍后重试`,
      response.status,
      body,
    );
  }
  if (!text.trim() || body === undefined) {
    throw new HttpResponseError(
      `${fallbackMessage}，服务没有返回内容，请重试`,
      response.status,
    );
  }
  return body as T;
}
