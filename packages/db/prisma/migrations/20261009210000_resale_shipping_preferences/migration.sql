ALTER TABLE resale_settings
  ADD COLUMN shipping_mode TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN shipping_fee_cny DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN location_text TEXT NOT NULL DEFAULT '';
ALTER TABLE resale_listings
  ADD COLUMN shipping_mode TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN shipping_fee_cny DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN location_text TEXT NOT NULL DEFAULT '';
ALTER TABLE resale_settings ADD CONSTRAINT resale_settings_shipping_mode CHECK (shipping_mode IN ('free', 'fixed', 'distance', 'none'));
ALTER TABLE resale_listings ADD CONSTRAINT resale_listings_shipping_mode CHECK (shipping_mode IN ('free', 'fixed', 'distance', 'none'));
ALTER TABLE resale_settings ADD CONSTRAINT resale_settings_shipping_fee CHECK (shipping_fee_cny >= 0 AND shipping_fee_cny <= 100000);
ALTER TABLE resale_listings ADD CONSTRAINT resale_listings_shipping_fee CHECK (shipping_fee_cny >= 0 AND shipping_fee_cny <= 100000);
