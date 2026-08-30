-- Text such as "サイズ120 本体" was previously parsed as "120本". Clear
-- the derived quantity/unit cost on every existing affected listing; future
-- imports are protected by the shared classifier regression test.
UPDATE "Item"
SET "quantityEst" = NULL,
    "unitCostEst" = NULL,
    "updatedAt" = NOW()
WHERE ("titleRaw" || E'\n' || COALESCE("descriptionRaw", ''))
      ~* '(サイズ|size)[[:space:]]*[0-9]{2,3}([^0-9]|$)'
  AND ("titleRaw" || E'\n' || COALESCE("descriptionRaw", ''))
      ~* '[0-9]{1,3}[[:space:]]*本体'
  AND "quantityEst" IS NOT NULL;
