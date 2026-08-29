export async function GET() {
  const configuredApi =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:3001";
  const api = /^https?:\/\//.test(configuredApi)
    ? configuredApi
    : `http://${configuredApi}`;
  try {
    const response = await fetch(`${api}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return Response.json(
      { status: response.ok ? "ok" : "degraded", api: response.status },
      { status: response.ok ? 200 : 503 },
    );
  } catch {
    return Response.json(
      { status: "degraded", api: "unreachable" },
      { status: 503 },
    );
  }
}
