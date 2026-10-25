import { proxyTimeoutMs } from "../../../lib/proxy-timeout";
import { forwardedClientIp } from "../../../lib/forwarded-client-ip";
import { sessionTokenFromCookieHeader } from "../../../lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function internalApiBase() {
  const configured = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
  return /^https?:\/\//.test(configured) ? configured : `http://${configured}`;
}

const retryableUpstreamStatuses = new Set([502, 503, 504]);
const getRetryDelaysMs = [120, 320] as const;

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function fetchUpstream(target: URL, init: RequestInit, method: string) {
  const canRetry = method === "GET" || method === "HEAD";
  const attempts = canRetry ? getRetryDelaysMs.length + 1 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(target, init);
      const hasAnotherAttempt = attempt + 1 < attempts;
      if (
        !hasAnotherAttempt ||
        !retryableUpstreamStatuses.has(response.status)
      ) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) throw error;
    }
    await wait(getRetryDelaysMs[attempt]!);
  }

  throw lastError ?? new Error("upstream request failed");
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = new URL(
    path.map(encodeURIComponent).join("/"),
    `${internalApiBase()}/`,
  );
  target.search = incoming.search;

  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = forwardedClientIp(request.headers);
  if (clientIp) headers.set("x-client-ip", clientIp);
  // The session token travels as a cookie; the API expects a Bearer
  // header, so translate it here. A client-supplied Authorization
  // header is never forwarded - the cookie is the only credential
  // channel, which keeps the header allowlist closed.
  const sessionToken = sessionTokenFromCookieHeader(
    request.headers.get("cookie"),
  );
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const isAiRequest = path[0] === "ai";
  const timeoutMs = proxyTimeoutMs(path);
  try {
    const response = await fetchUpstream(
      target,
      {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      },
      request.method,
    );
    const responseBody = await response.arrayBuffer();
    if (response.status >= 400 && responseBody.byteLength === 0) {
      return Response.json(
        {
          code: "UPSTREAM_EMPTY_RESPONSE",
          message: isAiRequest
            ? "AI 服务暂时没有返回内容，请重试"
            : "后台服务暂时没有返回内容，请重试",
          retryable: true,
        },
        {
          status: response.status,
          headers: { "cache-control": "no-store, max-age=0" },
        },
      );
    }
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "no-store, max-age=0");
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return Response.json(
      {
        code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        message: timedOut
          ? isAiRequest
            ? "AI 服务响应超时，请重试，系统会自动切换备用模型"
            : "后台服务响应超时，请稍后重试"
          : "后台服务暂时无法连接，请稍后重试",
        retryable: true,
      },
      {
        status: timedOut ? 504 : 502,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
