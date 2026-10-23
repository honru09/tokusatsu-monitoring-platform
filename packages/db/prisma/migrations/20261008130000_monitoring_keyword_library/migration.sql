CREATE TABLE "monitoring_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'toys',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "monitoring_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_categories_name_length" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "monitoring_categories_scope" CHECK ("scope" IN ('toys', 'general')),
  CONSTRAINT "monitoring_categories_not_self_parent" CHECK ("parent_id" IS DISTINCT FROM "id"),
  CONSTRAINT "monitoring_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "monitoring_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "monitoring_categories_parent_id_name_key" ON "monitoring_categories" ("parent_id", "name") NULLS NOT DISTINCT;
CREATE INDEX "monitoring_categories_parent_id_idx" ON "monitoring_categories" ("parent_id");

CREATE TABLE "monitoring_keywords" (
  "id" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "normalized_keyword" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "interval_minutes" INTEGER NOT NULL DEFAULT 60,
  "category_id" TEXT NOT NULL,
  "source_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "monitoring_keywords_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_keywords_keyword_length" CHECK (length(btrim("keyword")) BETWEEN 1 AND 160 AND length("normalized_keyword") BETWEEN 1 AND 160),
  CONSTRAINT "monitoring_keywords_interval" CHECK ("interval_minutes" BETWEEN 15 AND 1440),
  CONSTRAINT "monitoring_keywords_source_count" CHECK (cardinality("source_keys") <= 12),
  CONSTRAINT "monitoring_keywords_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "monitoring_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "monitoring_keywords_normalized_keyword_key" ON "monitoring_keywords" ("normalized_keyword");
CREATE INDEX "monitoring_keywords_category_id_idx" ON "monitoring_keywords" ("category_id");
CREATE INDEX "monitoring_keywords_enabled_updated_at_idx" ON "monitoring_keywords" ("enabled", "updated_at");

ALTER TABLE "Item" ADD COLUMN "monitoring_category_id" TEXT;
ALTER TABLE "Item" ADD CONSTRAINT "Item_monitoring_category_id_fkey" FOREIGN KEY ("monitoring_category_id") REFERENCES "monitoring_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Item_monitoring_category_id_status_archivedAt_idx" ON "Item" ("monitoring_category_id", "status", "archivedAt");

CREATE TABLE "monitoring_keyword_matches" (
  "item_id" TEXT NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "matched_keyword" TEXT NOT NULL,
  "matched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitoring_keyword_matches_pkey" PRIMARY KEY ("item_id", "keyword_id"),
  CONSTRAINT "monitoring_keyword_matches_keyword_length" CHECK (length("matched_keyword") BETWEEN 1 AND 160),
  CONSTRAINT "monitoring_keyword_matches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "monitoring_keyword_matches_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "monitoring_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "monitoring_keyword_matches_keyword_id_matched_at_idx" ON "monitoring_keyword_matches" ("keyword_id", "matched_at");
CREATE INDEX "CrawlJob_monitoring_keyword_latest_idx" ON "CrawlJob" (("query"->>'monitoringKeywordId'), "createdAt" DESC, "id" DESC) WHERE "jobType"='search' AND "query"->>'monitoringKeywordId' IS NOT NULL;

INSERT INTO "monitoring_categories" ("id", "name", "parent_id", "scope", "updated_at") VALUES
 ('monitoring-toys', '玩具', NULL, 'toys', CURRENT_TIMESTAMP),
 ('monitoring-kamen', '假面骑士', 'monitoring-toys', 'toys', CURRENT_TIMESTAMP),
 ('monitoring-ultraman', '奥特曼', 'monitoring-toys', 'toys', CURRENT_TIMESTAMP),
 ('monitoring-tokusatsu', '特摄玩具', 'monitoring-toys', 'toys', CURRENT_TIMESTAMP),
 ('monitoring-kamen-shf', 'SHF', 'monitoring-kamen', 'toys', CURRENT_TIMESTAMP),
 ('monitoring-ultraman-shf', 'SHF', 'monitoring-ultraman', 'toys', CURRENT_TIMESTAMP),
 ('monitoring-kamen-sic', 'S.I.C.', 'monitoring-kamen', 'toys', CURRENT_TIMESTAMP);

-- Preserve the former shipped keyword plan as editable records. No listing
-- association is fabricated: matches begin only at a real search or reindex.
WITH defaults("keyword", "category_id") AS (VALUES
 ('仮面ライダー まとめ売り', 'monitoring-kamen'),
 ('ウルトラマン まとめ売り', 'monitoring-ultraman'),
 ('特撮 ガシャポン まとめ売り', 'monitoring-tokusatsu'),
 ('特撮 食玩 まとめ売り', 'monitoring-tokusatsu'),
 ('特撮 指人形 まとめ売り', 'monitoring-tokusatsu'),
 ('特撮 ミニフィギュア まとめ売り', 'monitoring-tokusatsu'),
 ('仮面ライダー S.H.Figuarts', 'monitoring-kamen-shf'),
 ('仮面ライダー 真骨彫製法', 'monitoring-kamen-shf'),
 ('仮面ライダー S.H.Figuarts まとめ売り', 'monitoring-kamen-shf'),
 ('仮面ライダー SHF 魂ウェブ商店', 'monitoring-kamen-shf'),
 ('ウルトラマン S.H.Figuarts', 'monitoring-ultraman-shf'),
 ('ウルトラマン SHF まとめ売り', 'monitoring-ultraman-shf'),
 ('ウルトラマン S.H.Figuarts 魂ウェブ商店', 'monitoring-ultraman-shf'),
 ('仮面ライダー S.I.C.', 'monitoring-kamen-sic'),
 ('仮面ライダー SIC まとめ売り', 'monitoring-kamen-sic'),
 ('S.I.C. 仮面ライダー', 'monitoring-kamen-sic'),
 ('S.I.C. 極魂 仮面ライダー', 'monitoring-kamen-sic'),
 ('仮面ライダー', 'monitoring-kamen'),
 ('ウルトラマン', 'monitoring-ultraman'),
 ('仮面ライダー DX', 'monitoring-kamen'),
 ('仮面ライダー ベルト', 'monitoring-kamen'),
 ('仮面ライダー ソフビ', 'monitoring-kamen'),
 ('仮面ライダー 食玩', 'monitoring-kamen'),
 ('仮面ライダー ガシャポン', 'monitoring-kamen'),
 ('特撮 まとめ売り', 'monitoring-tokusatsu')
)
INSERT INTO "monitoring_keywords" ("id", "keyword", "normalized_keyword", "interval_minutes", "category_id", "updated_at")
SELECT 'monitoring-default-' || md5(lower("keyword")), "keyword", lower("keyword"), 15, "category_id", CURRENT_TIMESTAMP FROM defaults;
