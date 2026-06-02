-- ============================================================
-- 014_hay_photos_column.sql
-- Back-captures the photo_urls column on hay_listings, which
-- existed in production but had NO migration (added by hand).
--
-- GROUND TRUTH (verified against the live DB 2026-06-02 via the
-- PostgREST OpenAPI schema + row sampling):
--   • photo_urls is  text[]  and  NOT NULL  in production.
--   • 23/23 listings have a non-null value, yet the post flow only
--     sets photo_urls when photos exist → production carries a
--     DEFAULT '{}'::text[]. Reproduced here so a from-scratch
--     rebuild matches production exactly.
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS is a no-op
-- against the live DB (the column is already present); it only
-- does work on a fresh rebuild. NON-DESTRUCTIVE — it never alters
-- or drops the existing column.
-- ============================================================

ALTER TABLE public.hay_listings
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}'::text[];
