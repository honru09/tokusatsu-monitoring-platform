import { ItemStatus, prisma, Prisma, ToyType } from "@tokusatsu/db";

type TranslationFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type BatchDependencies = {
  findPending: (limit: number) => Promise<Array<{ id: string }>>;
  countPending: () => Promise<number>;
  fetcher?: TranslationFetch;
  apiBaseUrl?: string;
  batchSize?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

let translationPausedUntil = 0;
const TRANSLATION_PAUSE_MS = 30 * 60_000;

export class DetailTranslationUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DetailTranslationUnavailableError";
  }
}

async function unavailableCode(response: Response) {
  const body = await response
    .clone()
    .text()
    .catch(() => "");
  try {
    const payload = JSON.parse(body) as { code?: unknown; message?: unknown };
    if (payload.code === "AI_GATEWAY_NOT_CONFIGURED")
      return "AI_GATEWAY_NOT_CONFIGURED";
    if (payload.code === "AI_GATEWAY_UNAVAILABLE")
      return "AI_GATEWAY_UNAVAILABLE";
    if (payload.code === "AI_GATEWAY_DEADLINE_EXCEEDED")
      return "AI_GATEWAY_UNAVAILABLE";
  } catch {}
  if (/AI Gateway|B\.AI|模型路由均不可用/i.test(body))
    return "AI_GATEWAY_UNAVAILABLE";
  return undefined;
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchTranslationWithRetry(
  url: string,
  fetcher: TranslationFetch = fetch,
  wait: (milliseconds: number) => Promise<void> = sleep,
  attempts = 4,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(
          Math.max(
            250_000,
            Math.min(
              Number(process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 270_000),
              300_000,
            ),
          ),
        ),
      });
      if (response.ok) return response;
      const blockingCode = await unavailableCode(response);
      if (blockingCode)
        throw new DetailTranslationUnavailableError(
          "AI Gateway unavailable",
          blockingCode,
        );
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Detail translation API ${response.status}`);
      }
      lastError = new Error(`Detail translation API ${response.status}`);
      await response.arrayBuffer().catch(() => undefined);
      if (attempt < attempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(
          Number.isFinite(retryAfter)
            ? Math.max(2_000, retryAfter * 1_000)
            : Math.min(30_000, 2_000 * 2 ** (attempt - 1)),
        );
      }
    } catch (error) {
      if (error instanceof DetailTranslationUnavailableError) throw error;
      lastError = error;
      if (attempt < attempts)
        await wait(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function processDetailTranslationBatch(
  dependencies: BatchDependencies,
) {
  const batchSize = Math.max(
    1,
    Math.min(4, Math.floor(dependencies.batchSize ?? 2)),
  );
  const items = await dependencies.findPending(batchSize);
  if (items.length === 0) return { translated: 0, failed: 0, remaining: 0 };

  const baseUrl = (dependencies.apiBaseUrl ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const response = await fetchTranslationWithRetry(
        `${baseUrl}/analysis/item/${encodeURIComponent(item.id)}`,
        dependencies.fetcher ?? fetch,
        dependencies.wait ?? sleep,
      );
      const payload = (await response.json()) as { translation?: unknown };
      if (!payload.translation)
        throw new Error(`Detail translation returned no item for ${item.id}`);
      return item.id;
    }),
  );
  const translated = results.filter(
    (result) => result.status === "fulfilled",
  ).length;
  const failed = results.length - translated;
  const unavailable = results.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof DetailTranslationUnavailableError,
  );
  if (unavailable) translationPausedUntil = Date.now() + TRANSLATION_PAUSE_MS;
  const remaining = await dependencies.countPending();
  if (failed > 0)
    console.warn(
      JSON.stringify({
        event: "detail_translation_batch_deferred",
        batchSize: items.length,
        translated,
        failed,
        remaining,
      }),
    );
  return { translated, failed, remaining };
}

async function findPendingHistoricalItems(limit: number) {
  const commonWhere: Prisma.ItemWhereInput = {
    ignored: false,
    categoryToyType: { not: ToyType.card },
    OR: [
      {
        archivedAt: null,
        status: { in: [ItemStatus.active, ItemStatus.unknown] },
      },
      { purchaseRecord: { isNot: null } },
    ],
  };
  const pending = await prisma.item.findMany({
    where: {
      ...commonWhere,
      translationStatus: "pending",
    },
    select: { id: true },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (pending.length >= limit) return pending;
  const failed = await prisma.item.findMany({
    where: { ...commonWhere, translationStatus: "failed" },
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit - pending.length,
  });
  if (pending.length + failed.length >= limit) return [...pending, ...failed];
  // A request interrupted by an API/container restart can leave a row in
  // processing. Do not duplicate live calls; reclaim only genuinely stale
  // rows after the ordinary pending and failed backlog has been considered.
  const staleProcessing = await prisma.item.findMany({
    where: {
      ...commonWhere,
      translationStatus: "processing",
      updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit - pending.length - failed.length,
  });
  return [...pending, ...failed, ...staleProcessing];
}

async function countPendingHistoricalItems() {
  return prisma.item.count({
    where: {
      ignored: false,
      categoryToyType: { not: "card" },
      translationStatus: { not: "completed" },
      OR: [
        {
          archivedAt: null,
          status: { in: [ItemStatus.active, ItemStatus.unknown] },
        },
        { purchaseRecord: { isNot: null } },
      ],
    },
  });
}

export async function processDetailTranslation() {
  if (Date.now() < translationPausedUntil)
    return {
      skipped: "ai_gateway_temporarily_unavailable",
      retryAfter: new Date(translationPausedUntil).toISOString(),
    };
  return processDetailTranslationBatch({
    findPending: findPendingHistoricalItems,
    countPending: countPendingHistoricalItems,
    fetcher: fetch,
    apiBaseUrl: process.env.API_INTERNAL_URL ?? "http://localhost:3001",
    batchSize: Number(process.env.DETAIL_TRANSLATION_BATCH_SIZE ?? 2),
  });
}
