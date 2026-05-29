-- ============================================================
-- 006_deal_state_reviews.sql
--
-- ⚠️  ALREADY APPLIED TO PRODUCTION — committed for repo parity only.
--     This SQL was run directly in the Supabase SQL Editor during the
--     6.2 build. It is reproduced here so supabase/migrations/ matches
--     the live database. Re-running is safe (IF NOT EXISTS / guarded).
--
-- Trust loop: buyer-claim / seller-confirm deal state on hay_listings,
-- bidirectional verified-deal reviews, persisted seller aggregates.
-- ============================================================

-- 1. Profile aggregate columns (some added by hand earlier; safe either way)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seller_avg_rating   numeric(3,2),
  ADD COLUMN IF NOT EXISTS seller_review_count integer NOT NULL DEFAULT 0;

-- 2. Mark-sold + buyer-claim handshake on listings.
--    claim_status is the source of truth for deal state — never inferred.
ALTER TABLE public.hay_listings
  ADD COLUMN IF NOT EXISTS claim_status        text NOT NULL DEFAULT 'none'
    CHECK (claim_status IN ('none', 'pending', 'confirmed', 'rejected')),
  ADD COLUMN IF NOT EXISTS buyer_claim_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_to_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_external       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_at             timestamptz;

CREATE INDEX IF NOT EXISTS hay_listings_sold_to_idx
  ON public.hay_listings (sold_to_user_id);

CREATE INDEX IF NOT EXISTS hay_listings_claim_pending_idx
  ON public.hay_listings (user_id) WHERE claim_status = 'pending';

-- 3. Generalize hay_reviews (migration 005) to bidirectional / verified-deal.
ALTER TABLE public.hay_reviews
  RENAME COLUMN seller_user_id TO reviewee_user_id;

ALTER TABLE public.hay_reviews
  ADD COLUMN IF NOT EXISTS reviewee_role text CHECK (reviewee_role IN ('seller', 'buyer')),
  ADD COLUMN IF NOT EXISTS verified_deal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

ALTER INDEX IF EXISTS hay_reviews_seller_idx RENAME TO hay_reviews_reviewee_idx;

-- One review per reviewer per deal is already enforced by the existing
-- unique (listing_id, reviewer_user_id) constraint from migration 005.

-- No self-reviews.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hay_reviews_no_self') THEN
    ALTER TABLE public.hay_reviews
      ADD CONSTRAINT hay_reviews_no_self CHECK (reviewer_user_id <> reviewee_user_id);
  END IF;
END $$;
