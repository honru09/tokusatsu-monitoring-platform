export async function processAiOperations() {
  const token = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!token) return { skipped: "ai_internal_token_not_configured" };
  const apiBase = (
    process.env.API_INTERNAL_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const response = await fetch(`${apiBase}/ai/internal/refresh-memory`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-ai-internal-token": token,
    },
    signal: AbortSignal.timeout(
      Math.max(120_000, Number(process.env.AI_TIMEOUT_MS ?? 120_000) * 4),
    ),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `AI operational memory ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
    );
  }
  return response.json();
}
