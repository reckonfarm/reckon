-- 019 — News items snapshot
--
-- Pre-tagged ag-news headlines, written by an off-Vercel GitHub Action (some
-- sources — e.g. AgDaily, ams.usda.gov-adjacent hosts — 403-block or time out on
-- Vercel's datacenter egress but come through clean from GitHub runners) and read
-- by NOTHING yet. This is the data layer only (Slice 0): the snapshot script
-- (scripts/news-snapshot.ts) fetches the curated feeds, runs the relevance +
-- scope + locality "brain", dedups, and upserts one row per headline here.
--
-- The live news path (app/api/news/route.ts) is UNCHANGED and does not read this
-- table. Wiring the route to read it is a later, separate, deliberate slice.
--
-- Mirrors migration 012's posture exactly: additive (new table only), RLS on with
-- NO policies, service-role only (the Action writes, a future server component
-- reads). The anon key can never touch it.

create table if not exists public.news_items (
  id           uuid primary key default gen_random_uuid(),
  -- Headline + outbound link only — never full article text (copyright).
  title        text not null,
  link         text not null,            -- canonical article URL (the natural key)
  pub_date     timestamptz,              -- article publish time, null if unparseable
  source       text not null,            -- display name, e.g. 'Northern Ag Network'
  source_id    text not null,            -- stable slug, e.g. 'northern-ag'
  -- Tier stamped from the SOURCE, not text analysis: national | state | regional.
  scope        text not null,
  -- State the source primarily covers (2-letter), or null for national sources.
  state        text,
  -- Locality hint from county-name matching (NEVER asserted as truth): the FIPS of
  -- a county whose name appeared in title+snippet. Null when no county matched.
  fips_hint    text,
  -- Confidence in fips_hint: 'high' only when a county name matched AND the source
  -- state agrees; 'low' for a bare name match; null when there is no hint.
  confidence   text,
  snippet      text not null default '',
  -- Epoch ms for recency sort (0 when pub_date is unknown), mirrors the route's ts.
  ts           bigint not null default 0,
  ingested_at  timestamptz not null default now(),
  -- Idempotency: re-running overwrites the same article, never duplicates.
  unique (link)
);

-- Fast "freshest items first" read for the eventual consumer.
create index if not exists news_items_recent_idx
  on public.news_items (ts desc);

-- Scope/state filtered reads (e.g. "this state's items, freshest first").
create index if not exists news_items_scope_state_idx
  on public.news_items (scope, state, ts desc);

-- Writes come from the service-role client (the Action) and reads (later) from the
-- service-role client (a server component) — both bypass RLS. Enable RLS with no
-- public policies so the anon key can never touch this table.
alter table public.news_items enable row level security;
