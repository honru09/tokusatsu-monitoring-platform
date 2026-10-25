-- FX snapshot for confirmed parcels: the declared total in CNY and the
-- JPY/CNY rate used at packing time. The customs cap is 2,000 CNY, so the
-- yen total alone is not enough to audit a parcel after the fact.
-- Both columns stay nullable: shipments confirmed before this migration
-- have no snapshot.

ALTER TABLE "shipments" ADD COLUMN "exchange_rate" DECIMAL(18,8);
ALTER TABLE "shipments" ADD COLUMN "total_declared_cny" INTEGER;
