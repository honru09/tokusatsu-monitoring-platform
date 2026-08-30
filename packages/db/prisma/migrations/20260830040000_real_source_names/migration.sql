-- Platform names are product data, not presentation aliases. Updating Source
-- covers every existing item, seller, monitoring job and future relation read.
UPDATE "Source"
SET "displayName" = CASE "key"
  WHEN 'mandarake' THEN 'Mandarake'
  WHEN 'mercari' THEN 'Mercari'
  WHEN 'yahoo_auctions' THEN 'Yahoo!オークション'
  WHEN 'firecrawl_market' THEN 'Firecrawl'
  WHEN 'apify_ecommerce' THEN 'Apify'
  WHEN 'playwright_page' THEN 'Playwright'
  WHEN 'public_page' THEN '网页来源'
  ELSE "displayName"
END
WHERE "key" IN (
  'mandarake',
  'mercari',
  'yahoo_auctions',
  'firecrawl_market',
  'apify_ecommerce',
  'playwright_page',
  'public_page'
);
