-- ============================================================
-- 048_market_events_and_markets_seen.sql
-- Block 2.5 B6 + B7.
--
-- market_events — the dated annotation layer under the price charts. Data,
-- not a component: every row carries a date, a neutral description of what
-- happened, and a citable source URL. The chart draws a marker; the person
-- draws the conclusion. No column exists for an effect, a dollar move, or a
-- percentage — by design, and it must stay that way.
--   Public reference data: RLS on, SELECT for everyone, no client write
--   policy (rows are added by SQL or the service role).
--
-- ranch_members.markets_seen_at — "Since you last checked" for Markets, the
-- same treatment as the ledger's last_seen_at (044): written only by
-- POST /api/seen?surface=markets with the service role after a membership
-- check.
--
-- Idempotent (create if not exists, seed on conflict do nothing), additive,
-- non-orphaning, order-independent (needs 034). Run in the SQL editor.
-- ============================================================

create table if not exists public.market_events (
  id           bigserial   primary key,
  event_date   date        not null,
  title        text        not null,            -- short, factual: what happened
  description  text        not null,            -- one or two neutral sentences, no characterization
  category     text        not null,            -- 'border' | 'trade' | 'usda_report' | 'policy' | 'weather'
  source_name  text        not null,            -- 'USDA', 'USDA NASS', …
  source_url   text        not null,            -- the citation
  created_at   timestamptz not null default now(),
  constraint market_events_natural_key unique (event_date, title)
);

create index if not exists market_events_date_idx on public.market_events (event_date);

alter table public.market_events enable row level security;
drop policy if exists "market events readable" on public.market_events;
create policy "market events readable"
  on public.market_events for select
  to anon, authenticated
  using (true);

-- Seed — border and import decisions with USDA press releases as the source.
-- Descriptive only: what was announced and when.
insert into public.market_events (event_date, title, description, category, source_name, source_url) values
  ('2025-05-11', 'USDA suspends live cattle, horse, and bison imports through southern border ports',
   'USDA announced an immediate suspension of live cattle, horse, and bison imports through U.S. ports of entry along the southern border, citing the northward spread of New World screwworm in Mexico. The suspension was to be reviewed month by month.',
   'border', 'USDA', 'https://www.usda.gov/about-usda/news/press-releases/2025/05/11/secretary-rollins-suspends-live-animal-imports-through-ports-entry-along-southern-border-effective'),
  ('2025-06-30', 'USDA announces phased reopening of southern ports for livestock trade',
   'USDA announced a phased reopening of southern border ports to livestock trade, beginning with Douglas, Arizona, with later ports to follow depending on conditions in Mexico.',
   'border', 'USDA', 'https://www.usda.gov/about-usda/news/press-releases/2025/06/30/usda-announces-phased-reopening-southern-ports-livestock-trade'),
  ('2025-07-09', 'USDA closes southern border ports to livestock trade again',
   'USDA announced the closure of U.S. southern border ports to livestock trade following a further northward New World screwworm detection in Mexico, reversing the phased reopening announced June 30.',
   'border', 'USDA', 'https://www.usda.gov/about-usda/news/press-releases/2025/07/09/secretary-rollins-takes-decisive-action-and-shuts-down-us-southern-border-ports-livestock-trade-due'),
  ('2026-07-24', 'USDA announces phased reopening of southern ports, beginning with Douglas, Arizona',
   'USDA announced a coordinated, phased reopening of southern cattle ports contingent on Mexico''s adherence to a joint action plan, with the Douglas, Arizona, port to open first and every animal to receive a full USDA inspection.',
   'border', 'USDA', 'https://www.usda.gov/about-usda/news/press-releases/2026/07/24/usda-announces-phased-reopening-southern-ports-livestock-trade')
on conflict (event_date, title) do nothing;

alter table public.ranch_members
  add column if not exists markets_seen_at timestamptz;

-- Verify — (a) expect 4 rows; (b) expect the column, nullable; (c) expect one SELECT policy on market_events.
select event_date, title, source_url from public.market_events order by event_date;
select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'ranch_members' and column_name = 'markets_seen_at';
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'market_events';
