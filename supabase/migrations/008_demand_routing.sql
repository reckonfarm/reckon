-- ============================================================
-- 008_demand_routing.sql
--
-- ⚠️  ALREADY APPLIED TO PRODUCTION — committed for repo parity only.
--     Run directly in the Supabase SQL Editor during the demand-routing build.
--     Reproduced here so supabase/migrations/ matches the live database.
--
-- Opt-in seller demand routing: email opted-in sellers when a buyer posts a
-- matching want within haul range. Opt-in default OFF; capped + deduped.
-- ============================================================

-- 1. Seller opt-in — default OFF, no unsolicited demand email until enabled.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS demand_routing_opt_in boolean NOT NULL DEFAULT false;

-- 2. Dedup + frequency-cap source of truth: one row per (want listing, seller).
CREATE TABLE IF NOT EXISTS public.demand_routing_sent (
  id              bigserial primary key,
  want_listing_id integer not null references public.hay_listings (id) on delete cascade,
  seller_user_id  uuid    not null references auth.users (id) on delete cascade,
  sent_at         timestamptz not null default now(),
  unique (want_listing_id, seller_user_id)
);

-- Powers the rolling-7-day cap count per seller (and the dedup leftmost lookup).
CREATE INDEX IF NOT EXISTS demand_routing_sent_seller_idx
  ON public.demand_routing_sent (seller_user_id, sent_at desc);
