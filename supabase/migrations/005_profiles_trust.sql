-- ============================================================
-- 005_profiles_trust.sql
-- Sprint 3: trust architecture — seller profile fields,
-- hay_reviews table for buyer ratings.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Seller profile extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified_phone boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name   text,
  ADD COLUMN IF NOT EXISTS bio            text,
  ADD COLUMN IF NOT EXISTS total_sales    integer DEFAULT 0;

-- Buyer reviews for hay sellers
CREATE TABLE IF NOT EXISTS public.hay_reviews (
  id               serial      primary key,
  listing_id       integer     references public.hay_listings(id) on delete cascade,
  reviewer_user_id uuid        references auth.users(id) on delete cascade,
  seller_user_id   uuid        references auth.users(id) on delete cascade,
  rating           smallint    not null check (rating between 1 and 5),
  comment          text,
  created_at       timestamptz default now(),
  unique (listing_id, reviewer_user_id)
);

CREATE INDEX IF NOT EXISTS hay_reviews_seller_idx
  ON public.hay_reviews (seller_user_id);
