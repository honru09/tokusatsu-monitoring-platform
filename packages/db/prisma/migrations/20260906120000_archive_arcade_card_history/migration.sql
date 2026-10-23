-- Kamen Rider arcade-card systems are outside the physical-toy procurement
-- scope.  Older rows can predate the crawler-side rejection rule, so archive
-- them without deleting the listing or any of its durable relations.
--
-- Purchase records always win over maintenance.  The brief SHARE lock prevents
-- a purchase from being inserted between target selection and the archive
-- update; locked Item rows also prevent a concurrent worker from double-writing
-- the same maintenance audit.
BEGIN;

LOCK TABLE "PurchaseRecord" IN SHARE MODE;

WITH maintenance_clock AS (
  SELECT CURRENT_TIMESTAMP::timestamp without time zone AS archived_at
), target AS MATERIALIZED (
  SELECT
    item."id",
    item."favorite",
    item."ignored",
    item."ignoredAt",
    item."categoryToyType",
    item."titleRaw",
    clock.archived_at
  FROM "Item" AS item
  CROSS JOIN maintenance_clock AS clock
  WHERE item."archivedAt" IS NULL
    AND item."titleRaw" ~* '(ガンバライド|ガンバライジング|ガンバレジェンズ)'
    AND NOT EXISTS (
      SELECT 1
      FROM "PurchaseRecord" AS purchase
      WHERE purchase."itemId" = item."id"
    )
  FOR UPDATE OF item
), audited AS (
  INSERT INTO "ManualReview" (
    "id",
    "itemId",
    "actor",
    "reason",
    "beforeData",
    "afterData",
    "createdAt"
  )
  SELECT
    gen_random_uuid(),
    target."id",
    'inventory-maintenance',
    'excluded_arcade_card_archived',
    jsonb_build_object(
      'favorite', target."favorite",
      'ignored', target."ignored",
      'ignoredAt', target."ignoredAt",
      'archivedAt', NULL,
      'categoryToyType', target."categoryToyType"::text,
      'titleRaw', target."titleRaw"
    ),
    jsonb_build_object(
      'favorite', target."favorite",
      'ignored', target."ignored",
      'ignoredAt', target."ignoredAt",
      'archivedAt', target.archived_at,
      'categoryToyType', target."categoryToyType"::text,
      'titleRaw', target."titleRaw"
    ),
    target.archived_at
  FROM target
  RETURNING "itemId"
)
UPDATE "Item" AS item
SET
  "archivedAt" = target.archived_at,
  "updatedAt" = target.archived_at
FROM target
JOIN audited ON audited."itemId" = target."id"
WHERE item."id" = target."id"
  AND item."archivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PurchaseRecord" AS purchase
    WHERE purchase."itemId" = item."id"
  );

COMMIT;
