import { createHash } from "node:crypto";
import { prisma, Prisma } from "@tokusatsu/db";
import {
  hasSalientOverlap,
  normalizeProductName,
  scoreProductMatch,
  type MatchableProduct,
} from "@tokusatsu/matching";
import {
  catalogEntries,
  entriesForSeed,
  normalizeCatalogText,
  resolveCatalogEntry,
  type CatalogEntry,
  type CatalogKind,
  type CatalogResolution,
} from "@tokusatsu/product-dictionary";

type CandidateRow = {
  id: string;
  normalizedName: string;
  productLine: string | null;
  franchiseKey: string | null;
  seriesKey: string | null;
  manufacturerKey: string | null;
  toyTypeKey: string | null;
};

type FieldConfidenceMap = Record<
  | "franchise"
  | "series"
  | "manufacturer"
  | "toyType"
  | "condition"
  | "quantity",
  number
>;

function byKey(kind: CatalogKind, key: string | null | undefined) {
  return catalogEntries.find(
    (entry) => entry.kind === kind && entry.key === key,
  );
}

function resolutionFromEnum(
  kind: "manufacturer" | "toy_type",
  key: string,
): CatalogResolution | null {
  if (key === "unknown" || key === "other" || key === "card") return null;
  const value = byKey(kind, key);
  return value
    ? {
        value,
        confidence: 0.9,
        evidence: `结构化字段已识别为 ${value.nameJa}`,
        matchedAlias: value.key,
      }
    : null;
}

async function upsertFranchise(entry?: CatalogEntry) {
  if (!entry) return null;
  return prisma.franchise.upsert({
    where: { key: entry.key },
    update: {
      nameJa: entry.nameJa,
      nameZh: entry.nameZh,
      nameEn: entry.nameEn,
    },
    create: {
      key: entry.key,
      nameJa: entry.nameJa,
      nameZh: entry.nameZh,
      nameEn: entry.nameEn,
    },
  });
}

async function ensureReferences(input: {
  franchise?: CatalogEntry;
  series?: CatalogEntry;
  manufacturer?: CatalogEntry;
  toyType?: CatalogEntry;
}) {
  const seriesFranchise = input.series?.franchiseKey
    ? byKey("franchise", input.series.franchiseKey)
    : undefined;
  const franchise = await upsertFranchise(input.franchise ?? seriesFranchise);
  const series =
    input.series && franchise
      ? await prisma.series.upsert({
          where: { key: input.series.key },
          update: {
            franchiseId: franchise.id,
            nameJa: input.series.nameJa,
            nameZh: input.series.nameZh,
            nameEn: input.series.nameEn,
          },
          create: {
            key: input.series.key,
            franchiseId: franchise.id,
            nameJa: input.series.nameJa,
            nameZh: input.series.nameZh,
            nameEn: input.series.nameEn,
          },
        })
      : null;
  const manufacturer = input.manufacturer
    ? await prisma.productManufacturer.upsert({
        where: { key: input.manufacturer.key },
        update: {
          nameJa: input.manufacturer.nameJa,
          nameZh: input.manufacturer.nameZh,
          nameEn: input.manufacturer.nameEn,
        },
        create: {
          key: input.manufacturer.key,
          nameJa: input.manufacturer.nameJa,
          nameZh: input.manufacturer.nameZh,
          nameEn: input.manufacturer.nameEn,
        },
      })
    : null;
  const toyType = input.toyType
    ? await prisma.productToyType.upsert({
        where: { key: input.toyType.key },
        update: {
          nameJa: input.toyType.nameJa,
          nameZh: input.toyType.nameZh,
          nameEn: input.toyType.nameEn,
        },
        create: {
          key: input.toyType.key,
          nameJa: input.toyType.nameJa,
          nameZh: input.toyType.nameZh,
          nameEn: input.toyType.nameEn,
        },
      })
    : null;
  return { franchise, series, manufacturer, toyType };
}

export async function seedCatalogDictionary() {
  const entries = entriesForSeed();
  for (const entry of entries.filter((row) => row.kind === "franchise"))
    await upsertFranchise(entry);
  for (const entry of entries.filter((row) => row.kind === "series")) {
    const franchise = byKey("franchise", entry.franchiseKey);
    if (!franchise) continue;
    await ensureReferences({ franchise, series: entry });
  }
  for (const entry of entries.filter((row) => row.kind === "manufacturer"))
    await ensureReferences({ manufacturer: entry });
  for (const entry of entries.filter((row) => row.kind === "toy_type"))
    await ensureReferences({ toyType: entry });
  await prisma.catalogAlias.createMany({
    data: entries.flatMap((entry) =>
      entry.aliases.map((aliasText) => ({
        entityType: entry.kind,
        entityKey: entry.key,
        aliasText,
        normalizedText: normalizeCatalogText(aliasText),
      })),
    ),
    skipDuplicates: true,
  });
  return { entries: entries.length };
}

function confidenceReasons(values: FieldConfidenceMap) {
  return Object.entries(values).flatMap(([field, confidence]) =>
    confidence >= 0.9
      ? []
      : [confidence >= 0.7 ? `${field}:待确认` : `${field}:无法确认`],
  );
}

function structuredChineseTitle(input: {
  franchise?: CatalogEntry;
  series?: CatalogEntry;
  toyType?: CatalogEntry;
}) {
  const values = [
    input.series?.nameZh ?? input.franchise?.nameZh,
    input.toyType?.nameZh,
  ].filter(Boolean);
  return values.length ? [...new Set(values)].join(" · ") : null;
}

async function trigramCandidates(
  normalizedName: string,
  seriesKey?: string | null,
): Promise<CandidateRow[]> {
  const seriesClause = seriesKey
    ? Prisma.sql`OR s."key" = ${seriesKey}`
    : Prisma.empty;
  try {
    return await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        p."id",
        p."normalized_name" AS "normalizedName",
        p."product_line" AS "productLine",
        f."key" AS "franchiseKey",
        s."key" AS "seriesKey",
        m."key" AS "manufacturerKey",
        t."key" AS "toyTypeKey"
      FROM "products" p
      LEFT JOIN "franchises" f ON f."id" = p."franchise_id"
      LEFT JOIN "series" s ON s."id" = p."series_id"
      LEFT JOIN "manufacturers" m ON m."id" = p."manufacturer_id"
      LEFT JOIN "toy_types" t ON t."id" = p."toy_type_id"
      WHERE similarity(p."normalized_name", ${normalizedName}) >= 0.2
        ${seriesClause}
      ORDER BY similarity(p."normalized_name", ${normalizedName}) DESC
      LIMIT 50
    `);
  } catch {
    const fallback = await prisma.product.findMany({
      where: { normalizedName: { contains: normalizedName.slice(0, 24) } },
      include: {
        franchise: true,
        series: true,
        manufacturerEntity: true,
        toyTypeEntity: true,
      },
      take: 50,
    });
    return fallback.map((product) => ({
      id: product.id,
      normalizedName: product.normalizedName,
      productLine: product.productLine,
      franchiseKey: product.franchise?.key ?? null,
      seriesKey: product.series?.key ?? null,
      manufacturerKey: product.manufacturerEntity?.key ?? null,
      toyTypeKey: product.toyTypeEntity?.key ?? null,
    }));
  }
}

export async function matchOrCreateProduct(itemId: string) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return { skipped: "missing_listing" as const };
  const text = `${item.titleRaw}\n${item.descriptionRaw ?? ""}`;
  const franchise = resolveCatalogEntry("franchise", text);
  const series = resolveCatalogEntry("series", text);
  const manufacturer =
    resolveCatalogEntry("manufacturer", text) ??
    resolutionFromEnum("manufacturer", item.manufacturer);
  const toyType =
    resolveCatalogEntry("toy_type", text) ??
    resolutionFromEnum("toy_type", item.categoryToyType);
  const normalizedName = normalizeProductName(item.titleRaw);
  const fieldConfidences: FieldConfidenceMap = {
    franchise: franchise?.confidence ?? (series ? 0.94 : 0),
    series: series?.confidence ?? 0,
    manufacturer: manufacturer?.confidence ?? 0,
    toyType: toyType?.confidence ?? 0,
    condition: item.conditionGrade === "unknown" ? 0 : item.confidence,
    quantity: item.quantityEst == null ? 0 : 0.9,
  };
  const query: MatchableProduct = {
    normalizedName,
    franchiseKey: franchise?.value.key ?? series?.value.franchiseKey,
    seriesKey: series?.value.key,
    manufacturerKey: manufacturer?.value.key,
    toyTypeKey: toyType?.value.key,
  };
  const candidates = await trigramCandidates(normalizedName, query.seriesKey);
  const ranked = candidates
    .filter((candidate) => hasSalientOverlap(query, candidate))
    .map((candidate) => ({
      candidate,
      result: scoreProductMatch(query, candidate),
    }))
    .sort((left, right) => right.result.score - left.result.score);
  const best = ranked[0];
  let productId: string;
  let matchConfidence: number;
  let matchDecision: "auto_matched" | "review_required";
  const reasons = confidenceReasons(fieldConfidences);

  if (best?.result.decision === "auto_match") {
    productId = best.candidate.id;
    matchConfidence = best.result.score;
    matchDecision = reasons.length ? "review_required" : "auto_matched";
  } else {
    if (best?.result.decision === "review") reasons.push("product:可能重复");
    const references = await ensureReferences({
      franchise: franchise?.value,
      series: series?.value,
      manufacturer: manufacturer?.value,
      toyType: toyType?.value,
    });
    const canonicalKey = createHash("sha256")
      .update(
        [
          query.franchiseKey ?? "",
          query.seriesKey ?? "",
          query.manufacturerKey ?? "",
          query.toyTypeKey ?? "",
          normalizedName,
        ].join("|"),
      )
      .digest("hex");
    const product = await prisma.product.upsert({
      where: { canonicalKey },
      update: {},
      create: {
        canonicalKey,
        canonicalName: item.titleRaw,
        normalizedName,
        titleZh: structuredChineseTitle({
          franchise: franchise?.value,
          series: series?.value,
          toyType: toyType?.value,
        }),
        franchiseId: references.franchise?.id,
        seriesId: references.series?.id,
        manufacturerEntityId: references.manufacturer?.id,
        toyTypeEntityId: references.toyType?.id,
      },
    });
    productId = product.id;
    const confirmed = Object.values(fieldConfidences).filter(
      (confidence) => confidence > 0,
    );
    matchConfidence = confirmed.length
      ? confirmed.reduce((sum, value) => sum + value, 0) / confirmed.length
      : 0;
    matchDecision = reasons.length ? "review_required" : "auto_matched";
  }

  const evidence = {
    franchise,
    series,
    manufacturer,
    toyType,
    productMatch: best?.result ?? null,
  } as unknown as Prisma.InputJsonValue;
  await prisma.item.update({
    where: { id: item.id },
    data: {
      productId,
      normalizedTitle: normalizedName,
      fieldConfidences: fieldConfidences as unknown as Prisma.InputJsonValue,
      extractionEvidence: evidence,
      matchConfidence,
      matchDecision,
      needsReview: item.needsReview || matchDecision === "review_required",
      suspectedDuplicate: best?.result.decision === "review",
    },
  });
  if (matchDecision === "review_required") {
    await prisma.reviewQueue.upsert({
      where: { itemId_status: { itemId: item.id, status: "pending" } },
      update: {
        productId,
        reasons,
        fieldConfidences: fieldConfidences as unknown as Prisma.InputJsonValue,
        suggestedChanges: evidence,
      },
      create: {
        itemId: item.id,
        productId,
        reasons,
        fieldConfidences: fieldConfidences as unknown as Prisma.InputJsonValue,
        suggestedChanges: evidence,
      },
    });
  }
  return { productId, matchConfidence, matchDecision, reasons };
}

export async function backfillUnmatchedListings(limit = 2000) {
  let processed = 0;
  while (processed < limit) {
    const batch = await prisma.item.findMany({
      where: { productId: null, archivedAt: null },
      select: { id: true },
      orderBy: { detectedAt: "desc" },
      take: Math.min(100, limit - processed),
    });
    if (!batch.length) break;
    for (const listing of batch) await matchOrCreateProduct(listing.id);
    processed += batch.length;
  }
  return { processed };
}
