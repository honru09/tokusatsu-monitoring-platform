-- Swap the manager login codes that 20261025170000 backfilled onto the
-- wrong accounts.
--
-- That migration picked the owner by display name first, looking for
-- 王 / 興潤 / 兴润 / WANG / コウジュン / hongrun. The owner's actual display
-- name is a single 润, which matches none of those, so it fell back to
-- order by created_at/position and handed 666666 to manager-1 (龙).
-- The partner pass did match 龙 by name, but that account already had
-- a code by then, so manager-2 (the owner) ended up with 888888.
-- Intended assignment: owner (manager-2) = 666666, 龙 (manager-1) =
-- 888888. This migration exchanges the two credentials.
--
-- Identification does not use display names. The accounts are the two
-- rows seeded by 20260906143000_manager_collaboration: position is
-- unique, manager-1 has position 1 and manager-2 has position 2, and
-- no code path ever rewrites position (created_at cannot tell them
-- apart on its own -- both rows were inserted by one statement, so
-- they share a timestamp). The wrong state is exactly "the
-- lowest-position account holds 666666", so the swap below only runs
-- in that state. In the correct state the lowest-position account
-- already holds 888888 and the block is a no-op, which also makes a
-- manual re-run of this SQL safe instead of swapping the codes back.
--
-- Password equals the code for both accounts, so login_code and
-- password_hash move together as a pair: each code keeps
-- authenticating against the scrypt hash it was generated from.
-- Account ids do not change.
--
-- The swap goes through a placeholder code because login_code has a
-- unique index and assigning 888888 to one row while the other still
-- holds it would fail mid-statement.

DO $$
DECLARE
  account_count integer;
  first_id text;
  first_code text;
  first_hash text;
  second_id text;
  second_hash text;
BEGIN
  SELECT COUNT(*) INTO account_count FROM "manager_accounts";
  IF account_count <> 2 THEN
    RAISE EXCEPTION
      'swap_manager_login_codes: expected exactly 2 manager accounts, found %',
      account_count;
  END IF;

  IF (SELECT COUNT(*) FROM "manager_accounts" WHERE "login_code" = '666666') <> 1
    OR (SELECT COUNT(*) FROM "manager_accounts" WHERE "login_code" = '888888') <> 1
  THEN
    RAISE EXCEPTION
      'swap_manager_login_codes: expected the login codes to be exactly {666666, 888888}';
  END IF;

  SELECT "id", "login_code", "password_hash"
    INTO first_id, first_code, first_hash
    FROM "manager_accounts"
    ORDER BY "position" ASC, "created_at" ASC, "id" ASC
    LIMIT 1;

  SELECT "id", "password_hash"
    INTO second_id, second_hash
    FROM "manager_accounts"
    WHERE "id" <> first_id;

  IF first_hash IS NULL OR second_hash IS NULL THEN
    RAISE EXCEPTION
      'swap_manager_login_codes: both accounts must have a password hash to swap';
  END IF;

  IF first_code = '666666' THEN
    UPDATE "manager_accounts"
      SET "login_code" = '__swap_pending__', "password_hash" = second_hash
      WHERE "id" = first_id;

    UPDATE "manager_accounts"
      SET "login_code" = '666666', "password_hash" = first_hash
      WHERE "id" = second_id;

    UPDATE "manager_accounts"
      SET "login_code" = '888888'
      WHERE "id" = first_id;
  END IF;
END $$;
