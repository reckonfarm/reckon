-- ============================================================
-- 003_hay_listings.sql
-- Hay Network: listings board + hay-match alert dedup.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.hay_listings (
  id                serial      primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  county_id         integer     not null references public.counties(id),
  listing_type      text        not null check (listing_type in ('sell', 'want', 'donate')),
  hay_type          text        not null,
  tonnage           numeric,
  price_per_ton     numeric,
  contact           text        not null,
  description       text,
  haul_radius_miles integer,
  relief_flag       boolean     not null default false,
  active            boolean     not null default true,
  expires_at        timestamptz not null default now() + interval '30 days',
  created_at        timestamptz not null default now()
);

create index if not exists hay_listings_county_idx     on public.hay_listings (county_id);
create index if not exists hay_listings_user_idx       on public.hay_listings (user_id);
create index if not exists hay_listings_active_exp_idx on public.hay_listings (active, expires_at);

-- Separate dedup table for hay-match alerts (avoids touching alert_sent schema)
create table if not exists public.hay_alert_sent (
  id              bigserial   primary key,
  listing_user_id uuid        not null references auth.users(id) on delete cascade,
  dry_county_id   integer     not null references public.counties(id) on delete cascade,
  week_date       date        not null,
  sent_at         timestamptz not null default now(),
  unique (listing_user_id, dry_county_id, week_date)
);

create index if not exists hay_alert_sent_user_week_idx
  on public.hay_alert_sent (listing_user_id, week_date desc);
