-- Public, robots-permitted online sources that do not require private account
-- credentials. Mandarake remains disabled because its former sales catalogue
-- redirects away from live inventory.
INSERT INTO "Source" (
  "id", "key", "displayName", "baseUrl", "channel", "enabled",
  "rateLimitMs", "failureCount", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid()::text, 'yahoo_fleamarket', 'Yahoo!フリマ', 'https://paypayfleamarket.yahoo.co.jp', 'online', true, 3000, 0, NOW(), NOW()),
  (gen_random_uuid()::text, 'rakuma', 'ラクマ', 'https://fril.jp', 'online', true, 3000, 0, NOW(), NOW()),
  (gen_random_uuid()::text, 'surugaya', '駿河屋', 'https://www.suruga-ya.jp', 'online', true, 30000, 0, NOW(), NOW())
ON CONFLICT ("key") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "baseUrl" = EXCLUDED."baseUrl",
  "channel" = 'online',
  "enabled" = true,
  "rateLimitMs" = EXCLUDED."rateLimitMs",
  "updatedAt" = NOW();

UPDATE "Source"
SET "enabled" = false, "failureCount" = 0, "circuitOpenAt" = NULL,
    "updatedAt" = NOW()
WHERE "key" = 'mandarake';
