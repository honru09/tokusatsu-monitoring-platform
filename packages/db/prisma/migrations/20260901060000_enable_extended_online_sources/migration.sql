-- Register optional online discovery sources before the worker evaluates their
-- environment-gated schedules. New rows remain disabled until scheduleJobs()
-- confirms the corresponding feature flag and credential are both present.
INSERT INTO "Source" (
  "id", "key", "displayName", "baseUrl", "channel", "enabled",
  "rateLimitMs", "failureCount", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid()::text, 'yahoo_shopping', 'Yahoo!ショッピング', 'https://shopping.yahoo.co.jp', 'online', false, 1100, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'firecrawl_market', 'Firecrawl', 'https://api.firecrawl.dev', 'online', false, 3000, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'apify_ecommerce', 'Apify', 'https://api.apify.com', 'online', false, 3000, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "baseUrl" = EXCLUDED."baseUrl",
  "channel" = EXCLUDED."channel",
  "rateLimitMs" = EXCLUDED."rateLimitMs",
  "updatedAt" = CURRENT_TIMESTAMP;
