-- ============================================================
-- profiles
-- One row per authenticated user (mirrors auth.users).
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- ============================================================
-- counties
-- Static reference table: one row per US county.
-- ============================================================
create table if not exists public.counties (
  id          serial primary key,
  fips        char(5) not null unique,   -- zero-padded 5-digit FIPS code
  name        text    not null,
  state       char(2) not null,          -- two-letter state abbreviation
  created_at  timestamptz not null default now()
);

create index if not exists counties_state_idx  on public.counties (state);
create index if not exists counties_fips_idx   on public.counties (fips);

-- ============================================================
-- drought_data
-- Weekly USDM drought readings keyed to a county + date.
-- ============================================================
create table if not exists public.drought_data (
  id          bigserial primary key,
  county_id   integer     not null references public.counties (id) on delete cascade,
  week_date   date        not null,       -- Tuesday release date from USDM
  d0          numeric(5,2),               -- abnormally dry   (% area)
  d1          numeric(5,2),               -- moderate drought
  d2          numeric(5,2),               -- severe drought
  d3          numeric(5,2),               -- extreme drought
  d4          numeric(5,2),               -- exceptional drought
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (county_id, week_date)
);

create index if not exists drought_data_county_idx      on public.drought_data (county_id);
create index if not exists drought_data_week_idx        on public.drought_data (week_date);
create index if not exists drought_data_county_week_idx on public.drought_data (county_id, week_date desc);

-- ============================================================
-- user_watchlist
-- Counties a user wants to monitor for drought alerts.
-- alert_level (0-4): fire an alert when any drought at that
-- D-level OR ABOVE has coverage > 0% in the latest reading.
-- Default of 3 means: alert on any D3 (Extreme) or D4 area.
--
-- NOTE: user_id is a plain UUID today (stored in the browser
-- via localStorage). Once auth is added, add the FK:
--   references auth.users (id) on delete cascade
-- ============================================================
create table if not exists public.user_watchlist (
  id           serial   primary key,
  user_id      uuid     not null,
  county_id    integer  not null references public.counties (id) on delete cascade,
  alert_level  smallint not null default 3 check (alert_level between 0 and 4),
  created_at   timestamptz not null default now(),
  unique (user_id, county_id)
);

create index if not exists watchlist_user_idx   on public.user_watchlist (user_id);
create index if not exists watchlist_county_idx on public.user_watchlist (county_id);

-- ============================================================
-- Migration: add coordinates to counties
-- Run in SQL Editor after the original schema is in place.
-- Populated by: npx tsx lib/seed-county-coords.ts
-- ============================================================
alter table public.counties
  add column if not exists lat numeric(9,6),
  add column if not exists lon numeric(9,6);

-- ============================================================
-- official_maps
-- Cached official map images written by the cron job.
-- map_type: 'usdm_national' | 'usdm_state' | 'cpc_monthly' | 'cpc_seasonal'
-- scope: two-letter state abbreviation for state maps, NULL for national maps.
-- ============================================================
create table if not exists public.official_maps (
  id           serial   primary key,
  map_type     text     not null,
  scope        text,
  release_date date     not null,
  image_url    text     not null,
  source_url   text     not null,
  created_at   timestamptz not null default now(),
  unique (map_type, scope, release_date)
);
create index if not exists official_maps_lookup_idx
  on public.official_maps (map_type, scope, release_date desc);

-- ============================================================
-- drought_observations
-- Per-county weekly maximum drought category (derived from
-- drought_data by the cron job; dashboard falls back to
-- computing max_category live from drought_data if empty).
-- ============================================================
create table if not exists public.drought_observations (
  id            bigserial primary key,
  county_id     integer  not null references public.counties (id) on delete cascade,
  max_category  smallint not null check (max_category between 0 and 4),
  release_date  date     not null,
  valid_through date,
  created_at    timestamptz not null default now(),
  unique (county_id, release_date)
);
create index if not exists drought_obs_county_date_idx
  on public.drought_observations (county_id, release_date desc);

-- ============================================================
-- forecast_outlooks
-- Plain-English CPC outlook text per county, written by cron.
-- outlook_type: 'monthly' | 'seasonal'
-- ============================================================
create table if not exists public.forecast_outlooks (
  id            serial   primary key,
  county_id     integer  not null references public.counties (id) on delete cascade,
  outlook_type  text     not null,
  outlook_text  text     not null,
  release_date  date     not null,
  valid_through date,
  created_at    timestamptz not null default now(),
  unique (county_id, outlook_type, release_date)
);
create index if not exists forecast_outlooks_county_type_idx
  on public.forecast_outlooks (county_id, outlook_type, release_date desc);
