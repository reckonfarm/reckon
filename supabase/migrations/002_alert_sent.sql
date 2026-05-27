-- ============================================================
-- 002_alert_sent.sql
-- Tracks which alerts have been sent, one row per user/county/week.
-- Unique on (user_id, county_id, week_date) so each user gets at
-- most one email per county per USDM release.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.alert_sent (
  id         bigserial primary key,
  user_id    uuid     not null references auth.users (id) on delete cascade,
  county_id  integer  not null references public.counties (id) on delete cascade,
  week_date  date     not null,
  tier       smallint not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, county_id, week_date)
);

create index if not exists alert_sent_user_week_idx
  on public.alert_sent (user_id, week_date desc);
