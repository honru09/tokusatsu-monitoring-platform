import { prisma } from "@tokusatsu/db";

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let titleTranslationPausedUntil = 0;
const TITLE_TRANSLATION_PAUSE_MS = 10 * 60_000;

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
          response.status !== 429)
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
  if (Date.now() < titleTranslationPausedUntil)
    return {
      skipped: "ai_gateway_temporarily_unavailable",
      retryAfter: new Date(titleTranslationPausedUntil).toISOString(),
    };
  const items = await prisma.item.findMany({
    where: {
      titleZh: null,
      archivedAt: null,
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

  const apiBase = (
    process.env.API_INTERNAL_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  try {
    const response = await fetchWithRetry(`${apiBase}/analysis/translate`, {
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
        Math.max(30_000, Number(process.env.AI_TIMEOUT_MS ?? 120_000) + 15_000),
      ),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if ([401, 402, 403, 429, 502, 503, 504].includes(response.status)) {
        titleTranslationPausedUntil = Date.now() + TITLE_TRANSLATION_PAUSE_MS;
        return {
          translated: 0,
          remaining: await countPending(),
          deferred: true,
          reason: "ai_gateway_unavailable",
          retryAfter: new Date(titleTranslationPausedUntil).toISOString(),
        };
      }
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
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
  });
}
