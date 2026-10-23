import { normalizeHttpBaseUrl } from "@tokusatsu/shared";
import {
  AutomaticAiDeferredError,
  automaticPaidAiEnabled,
  backgroundAiFetch,
} from "./background-ai-guard.js";

export async function processAiOperations() {
  if (!automaticPaidAiEnabled())
    return { skipped: "paid_automation_not_authorized" } as const;
  const token = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!token) return { skipped: "ai_internal_token_not_configured" };
  const apiBase = normalizeHttpBaseUrl(process.env.API_INTERNAL_URL);
  let response: Response;
  try {
    response = await backgroundAiFetch(
      "market-memory:refresh",
      `${apiBase}/ai/internal/refresh-memory`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-ai-internal-token": token,
        },
        signal: AbortSignal.timeout(
          Math.max(
            250_000,
            Math.min(
              Number(process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 270_000),
              300_000,
            ),
          ),
        ),
      },
    );
  } catch (error) {
    if (error instanceof AutomaticAiDeferredError)
      return {
        skipped: "ai_gateway_temporarily_unavailable",
        retryAfter: error.retryAt.toISOString(),
      };
    throw error;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `AI operational memory ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
    );
  }
  return response.json();
}
