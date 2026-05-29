-- ============================================================
-- 010_feedback.sql
-- In-app feedback widget. Anonymous-friendly: user_id is nullable
-- and captured only when the submitter happens to be logged in.
-- Writes go through the service-role client (bypasses RLS), matching
-- every other data path in this app.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.feedback (
  id          bigserial   primary key,
  user_id     uuid        references auth.users (id) on delete set null,
  sentiment   text        check (sentiment is null or sentiment in ('positive','neutral','negative')),
  message     text,
  page_path   text,                      -- pathname only, e.g. "/hay/42" — easy grouping
  url         text,                      -- full href incl. query (?deliverTo=, ?thread=) — exact context
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_user_idx     on public.feedback (user_id);

-- No RLS policies: the table is reached only via the service-role server route
-- (app/api/feedback), consistent with the rest of the app's data access.
-- The route requires at least one of (sentiment, message); both columns stay
-- nullable so a bare 👍 or a text-only note are each valid on their own.
