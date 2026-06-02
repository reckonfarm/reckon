-- ============================================================
-- 016_hay_listing_freshness.sql
-- Fix #3 (stale-listing handling): record when a seller last
-- confirmed a listing is still available. NO auto-delete — this
-- only records confirmations. Buyer-facing freshness + the seller
-- nudge are derived from created_at / expires_at (already present),
-- so the read paths never depend on this column existing; the
-- "Confirm still available" action writes it (and extends expires_at).
--
-- ADDITIVE / NON-DESTRUCTIVE.
-- ============================================================

ALTER TABLE public.hay_listings
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

-- Backfill existing rows so the record reads honestly from day one.
UPDATE public.hay_listings
   SET last_confirmed_at = created_at
 WHERE last_confirmed_at IS NULL;

-- ------------------------------------------------------------
-- OPTIONAL (Fix #2 cleanup) — NOT required.
-- `contact` is now an optional, private field. The app stores ''
-- when a seller leaves it blank, so the existing NOT NULL constraint
-- is still satisfied. Run the line below ONLY if you'd prefer blank
-- contact stored as NULL instead of an empty string.
-- ------------------------------------------------------------
-- ALTER TABLE public.hay_listings ALTER COLUMN contact DROP NOT NULL;
