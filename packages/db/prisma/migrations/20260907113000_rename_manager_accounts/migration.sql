UPDATE "manager_accounts"
SET
  "display_name" = CASE
    WHEN "id" = 'manager-1' THEN '龙'
    WHEN "id" = 'manager-2' THEN '润'
    ELSE "display_name"
  END,
  "avatar_initial" = CASE
    WHEN "id" = 'manager-1' THEN '龙'
    WHEN "id" = 'manager-2' THEN '润'
    ELSE "avatar_initial"
  END
WHERE "id" IN ('manager-1', 'manager-2');
