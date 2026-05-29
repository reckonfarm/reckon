-- ============================================================
-- 007_hay_radar.sql
--
-- ⚠️  ALREADY APPLIED TO PRODUCTION — committed for repo parity only.
--     Run directly in the Supabase SQL Editor during the Hay Radar build.
--     Reproduced here so supabase/migrations/ matches the live database.
--
-- Hay Radar: saved hay searches + per-listing match dedup.
-- ============================================================

-- 1. Saved searches (one row per saved search; a user may have several)
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id                 bigserial primary key,
  user_id            uuid    not null references auth.users (id) on delete cascade,
  -- criteria — any NULL column means "no constraint on this field"
  state              text,
  hay_type           text,
  listing_type       text    CHECK (listing_type is null or listing_type in ('sell','donate')),
  max_price_per_ton  numeric,
  max_distance_miles integer,
  origin_county_id   integer references public.counties (id) on delete set null,
  label              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS saved_searches_user_idx
  ON public.saved_searches (user_id);

-- 2. Dedup: one email per (saved_search, listing) for all time
CREATE TABLE IF NOT EXISTS public.hay_radar_sent (
  id              bigserial primary key,
  saved_search_id bigint  not null references public.saved_searches (id) on delete cascade,
  listing_id      integer not null references public.hay_listings (id) on delete cascade,
  sent_at         timestamptz not null default now(),
  unique (saved_search_id, listing_id)
);

CREATE INDEX IF NOT EXISTS hay_radar_sent_listing_idx
  ON public.hay_radar_sent (listing_id);
