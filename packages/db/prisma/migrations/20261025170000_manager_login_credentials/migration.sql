-- Manager login credentials: the login code replaces free account
-- switching. Both columns stay nullable so accounts without a
-- credential simply cannot password-login yet.
ALTER TABLE "manager_accounts" ADD COLUMN "login_code" TEXT;
ALTER TABLE "manager_accounts" ADD COLUMN "password_hash" TEXT;

CREATE UNIQUE INDEX "manager_accounts_login_code_key" ON "manager_accounts"("login_code");

-- Backfill the two existing manager accounts. Password equals the code
-- for both (owner decision, first pass). Hash format:
-- scrypt$<salt base64>$<hash base64>, scrypt N=16384 r=8 p=1 keylen 64.
--
-- Owner （王）: prefer the account whose display name matches 王 / WANG /
-- コウジュン / hongrun; otherwise the earliest-created account.
WITH owner AS (
  SELECT "id"
  FROM "manager_accounts"
  WHERE "login_code" IS NULL
  ORDER BY
    CASE
      WHEN "display_name" LIKE '%王%'
        OR "display_name" LIKE '%興潤%'
        OR "display_name" LIKE '%兴润%'
        OR "display_name" ILIKE '%WANG%'
        OR "display_name" LIKE '%コウジュン%'
        OR "display_name" ILIKE '%hongrun%'
      THEN 0
      ELSE 1
    END,
    "created_at" ASC,
    "position" ASC
  LIMIT 1
)
UPDATE "manager_accounts"
SET "login_code" = '666666',
    "password_hash" = 'scrypt$iDBfaOM7CaxrbjyYBCPCSg==$RE5GA40z9li5iYbVdbldhmItLYZLcsrPD2SKrpxX0Cy/tGYHcaKmd4T3StvZ3ZhkS5cndj77pvA0zTNVDgBFVw=='
WHERE "id" IN (SELECT "id" FROM owner);

-- Partner （龙）: prefer a display name matching 龙 / 龍; otherwise the
-- earliest-created account that still has no credential.
WITH partner AS (
  SELECT "id"
  FROM "manager_accounts"
  WHERE "login_code" IS NULL
  ORDER BY
    CASE
      WHEN "display_name" LIKE '%龙%'
        OR "display_name" LIKE '%龍%'
        OR "display_name" ILIKE '%long%'
        OR "display_name" ILIKE '%ryu%'
      THEN 0
      ELSE 1
    END,
    "created_at" ASC,
    "position" ASC
  LIMIT 1
)
UPDATE "manager_accounts"
SET "login_code" = '888888',
    "password_hash" = 'scrypt$fO75a2uK12vZoy8quRpoTw==$QF9iMy8AdIdHM/36Of7Wtqa3xvYLAyvGVbSY5lr9Avy5v4VRUXK86C+fRaj2VyApoJCEFGXvWS1tmd9Di7oR9g=='
WHERE "id" IN (SELECT "id" FROM partner);
