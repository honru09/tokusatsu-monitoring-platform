-- PostgreSQL requires newly added enum values to be committed before a later
-- transaction can use them. Keep this schema change separate from the
-- historical data backfill in 20260905210000.
ALTER TYPE "CategoryIp" ADD VALUE IF NOT EXISTS 'super_sentai';
ALTER TYPE "CategoryIp" ADD VALUE IF NOT EXISTS 'godzilla';
