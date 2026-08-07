-- ============================================================
-- 036_jobs.sql
-- The JOB — a derived work session, the unit of the product.
--
-- Aug 5 proved the data model: a swather header running five hours produced
-- 3,642 raw events to say "the header ran." The rancher-facing record is the
-- SESSION, not the impact. This table holds sessions DERIVED from raw events
-- by a server-side, versioned deriver (scripts/derive-jobs.ts). Doctrine:
--   * events stay raw and append-only — the device is dumb and honest;
--   * jobs are a REBUILDABLE ARTIFACT — every row carries deriver_version,
--     and the deriver deletes + rewrites a device's jobs wholesale, so
--     2029's understanding can re-derive 2026's data at any time.
--
-- NEVER hand-edit rows here and never treat them as source data. If a job
-- looks wrong, fix the deriver and re-run it — that is the entire point.
--
-- Writes are SERVICE-ROLE ONLY: RLS grants ranch-scoped SELECT and nothing
-- else (mirrors events' read policy from 034). No user INSERT/UPDATE/DELETE.
-- ============================================================

create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ranch_id        uuid references public.ranches(id),
  device_id       uuid references public.devices(id) on delete set null,
  hardware_id     text not null,          -- durable identity even if the device row goes

  -- Time (device GPS time only — events with ts_source='server' never set these)
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  duration_s      integer not null,

  -- Honesty arithmetic. coverage = event_count / (seq span size). A 66%-loss
  -- day must never look complete — the seq counter tells us exactly how many
  -- events the device generated, so we surface received ÷ generated on every job.
  seq_start       integer not null,
  seq_end         integer not null,
  event_count     integer not null,       -- received rows inside the span (timed + untimed)
  evicted_count   integer not null,       -- generated but never received (queue overwrite)
  coverage        double precision not null,

  -- Space (null when the job has no positioned events — e.g. no-fix bench/garage blobs)
  centroid_lat    double precision,
  centroid_lng    double precision,
  bbox            jsonb,                  -- {minLat,minLng,maxLat,maxLng}

  -- The track: positioned, device-timed events in seq order.
  -- [{seq,t,lat,lng,mg,w,link}] where link ('solid'|'gap') describes the hop
  -- FROM the previous point — 'gap' = seq discontinuity or stale hop; the map
  -- must never draw a solid line through a gap.
  track           jsonb not null default '[]'::jsonb,

  -- Pauses inside the job. kind 'observed' = genuine quiet seen in the data
  -- (zero missing seqs); kind 'inferred' = excess time hidden INSIDE an
  -- eviction block (gap minus missing×cadence) — work was lost AND the
  -- machine also stopped. [{afterSeq,atIso,kind,durationS,missing}]
  pauses          jsonb not null default '[]'::jsonb,

  -- Track spans 2+ work areas joined by a transit line (header left running
  -- between nearby fields). Expected; resolved later by clipping to place
  -- boundaries — but hull acreage over such a track would swallow the road,
  -- so it is flagged rather than silently averaged.
  multi_field     boolean not null default false,

  stats           jsonb not null default '{}'::jsonb,  -- cadence, mg quantiles, counts, config

  deriver_version text not null,
  derived_at      timestamptz not null default now()
);

create index jobs_ranch_started_idx on public.jobs (ranch_id, started_at desc);
create index jobs_user_started_idx  on public.jobs (user_id, started_at desc);
create index jobs_hardware_idx      on public.jobs (hardware_id, started_at desc);

comment on table public.jobs is
  'Derived work sessions (one Scout day ~ a handful of jobs, not thousands of events). Rebuildable artifact — service-role deriver only, see scripts/derive-jobs.ts.';

alter table public.jobs enable row level security;

-- Read = same shape as "ranch events readable" (034): owner leg OR ranch-member leg.
-- The ranch_members self-read policy (034) is load-bearing here exactly as it is
-- for events — remove it and this renders silently empty.
create policy "ranch jobs readable" on public.jobs
  for select using (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies on purpose: only the service-role deriver writes.
