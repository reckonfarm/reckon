-- ============================================================
-- 011_listing_reports.sql
--
-- ⚠️  ALREADY APPLIED TO PRODUCTION — committed for repo parity only.
--     Run directly in the Supabase SQL Editor.
--     Reproduced here so supabase/migrations/ matches the live database.
--
-- "Report this listing" reports stored in our own Supabase, replacing the
-- public mailto: link that exposed a personal email in page source.
-- Anonymous-friendly: reporter_user_id is nullable, captured only if the
-- reporter is logged in. Written via the service-role server route
-- (app/api/report), consistent with the rest of the app's data access.
-- ============================================================

create table if not exists public.listing_reports (
  id               bigserial   primary key,
  listing_id       integer     not null references public.hay_listings (id) on delete cascade,
  reporter_user_id uuid        references auth.users (id) on delete set null,
  reason           text        not null
    check (reason in ('spam','scam','sold','inappropriate','wrong_info','other')),
  note             text,
  user_agent       text,
  status           text        not null default 'open'
    check (status in ('open','reviewed','dismissed')),
  created_at       timestamptz not null default now()
);

create index if not exists listing_reports_listing_idx on public.listing_reports (listing_id);
create index if not exists listing_reports_status_idx  on public.listing_reports (status, created_at desc);

-- No RLS policies: reached only via the service-role server route, like feedback.
