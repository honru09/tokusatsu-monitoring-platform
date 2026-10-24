// One-off backfill: turn legacy bundle messages into share rounds.
//
// Bundle membership used to be encoded in the message text as
//   [[BUNDLE:{"itemIds":[...],"targetPriceYen":123}]]\n<body>
// New bundle messages link to a ShareRound row instead. This script finds
// direct messages that still carry the prefix and have no round yet, creates
// one round per message (the bundle-level target goes on the first item,
// matching how the send path treats legacy callers), links the message via
// roundId, and strips the prefix from the stored text.
//
// Owner-run only:
//   DATABASE_URL=... node scripts/backfill-share-rounds.mjs [--dry-run]

import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let PrismaClient;
try {
  ({ PrismaClient } = require("@prisma/client"));
} catch {
  ({ PrismaClient } = require(
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../packages/db/node_modules/@prisma/client",
    ),
  ));
}

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const BUNDLE_META_PREFIX = "[[BUNDLE:";
const BUNDLE_META_SUFFIX = "]]";

function parseBundleMessageText(rawText) {
  if (!rawText || !rawText.startsWith(BUNDLE_META_PREFIX)) return null;
  const endIndex = rawText.indexOf(BUNDLE_META_SUFFIX);
  if (endIndex === -1) return null;
  const jsonPart = rawText.slice(BUNDLE_META_PREFIX.length, endIndex);
  const rest = rawText.slice(endIndex + BUNDLE_META_SUFFIX.length).replace(/^\n/, "");
  try {
    const parsed = JSON.parse(jsonPart);
    const itemIds = Array.isArray(parsed.itemIds)
      ? parsed.itemIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];
    const targetPriceYen =
      typeof parsed.targetPriceYen === "number" && parsed.targetPriceYen > 0
        ? Math.round(parsed.targetPriceYen)
        : null;
    return { cleanText: rest.trim() || null, itemIds, targetPriceYen };
  } catch {
    return null;
  }
}

async function main() {
  const candidates = await prisma.directMessage.findMany({
    where: { roundId: null, text: { startsWith: BUNDLE_META_PREFIX } },
    select: { id: true, senderId: true, text: true, itemId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`found ${candidates.length} legacy bundle message(s)`);
  let converted = 0;
  let skipped = 0;
  for (const message of candidates) {
    const parsed = parseBundleMessageText(message.text);
    const itemIds = [
      ...new Set(
        [...(parsed?.itemIds ?? []), ...(message.itemId ? [message.itemId] : [])].filter(Boolean),
      ),
    ];
    if (!parsed || !itemIds.length) {
      skipped += 1;
      console.log(`skip ${message.id}: unparseable prefix or no items`);
      continue;
    }
    const existing = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((entry) => entry.id));
    const liveItemIds = itemIds.filter((id) => existingIds.has(id));
    if (!liveItemIds.length) {
      skipped += 1;
      console.log(`skip ${message.id}: none of the bundled items exist anymore`);
      continue;
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}convert ${message.id}: ${liveItemIds.length} item(s), target ${parsed.targetPriceYen ?? "-"}`,
    );
    if (dryRun) {
      converted += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const round = await tx.shareRound.create({
        data: {
          createdById: message.senderId,
          createdAt: message.createdAt,
          items: {
            create: liveItemIds.map((itemId, index) => ({
              itemId,
              targetPriceYen:
                index === 0 ? parsed.targetPriceYen : null,
            })),
          },
        },
      });
      await tx.directMessage.update({
        where: { id: message.id },
        data: { roundId: round.id, text: parsed.cleanText },
      });
    });
    converted += 1;
  }
  console.log(`done: ${converted} converted, ${skipped} skipped`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
