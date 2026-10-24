import { prisma } from "@tokusatsu/db";
import { normalizeHttpBaseUrl } from "@tokusatsu/shared";
import {
  AutomaticAiDeferredError,
  automaticBackgroundAiEnabled,
  backgroundAiFetch,
} from "./background-ai-guard.js";

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The worker only talks to the backend. Provider selection, credentials,
 * retries, JSON validation, caching and audit logging belong to AI Gateway.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
  wait: (milliseconds: number) => Promise<void> = sleep,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (
        response.ok ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429) ||
        [429, 502, 503, 504].includes(response.status)
      )
        return response;
      lastError = new Error(`AI Gateway title translation ${response.status}`);
      await response.arrayBuffer().catch(() => undefined);
      if (attempt < attempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(
          Number.isFinite(retryAfter)
            ? Math.max(2_000, retryAfter * 1_000)
            : Math.min(15_000, 2_000 * 2 ** (attempt - 1)),
        );
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts)
        await wait(Math.min(15_000, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function processTitleTranslation() {
  if (!automaticBackgroundAiEnabled())
    return { skipped: "background_automation_not_authorized" } as const;
  const items = await prisma.item.findMany({
    where: {
      titleZh: null,
      archivedAt: null,
      deletedAt: null,
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
    select: { id: true, titleRaw: true },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    take: Math.max(
      1,
      Math.min(8, Number(process.env.TITLE_TRANSLATION_BATCH_SIZE ?? 2)),
    ),
  });
  if (items.length === 0) return { translated: 0, remaining: 0 };

  const apiBase = normalizeHttpBaseUrl(process.env.API_INTERNAL_URL);
  try {
    const response = await backgroundAiFetch(
      `title:${items.map((item) => item.id).join(",")}`,
      `${apiBase}/analysis/translate?costPolicy=free_only`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          texts: items.map((item) => item.titleRaw),
          itemIds: items.map((item) => item.id),
        }),
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
      { authorization: "free" },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `AI Gateway title translation ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      );
    }
    const payload = (await response.json()) as { translations?: unknown };
    if (!Array.isArray(payload.translations))
      throw new Error("AI Gateway title translation returned invalid data");
    return { translated: items.length, remaining: await countPending() };
  } catch (error) {
    const remaining = await countPending();
    if (error instanceof AutomaticAiDeferredError)
      return {
        translated: 0,
        remaining,
        deferred: true,
        reason: "ai_gateway_unavailable",
        retryAfter: error.retryAt.toISOString(),
      };
    console.warn(
      JSON.stringify({
        event: "title_translation_batch_deferred",
        batchSize: items.length,
        remaining,
        error: String(error).slice(0, 300),
      }),
    );
    return { translated: 0, remaining, deferred: true };
  }
}

function countPending() {
  return prisma.item.count({
    where: {
      titleZh: null,
      archivedAt: null,
      deletedAt: null,
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
  });
}
