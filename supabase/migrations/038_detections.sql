-- ============================================================
-- 038_detections.sql
-- The DETECTION layer — derived facts inside a job, one row per detected
-- thing. Bales first; acres cut, cake fed, hours run follow the same shape.
--
-- Same doctrine as jobs (036): a REBUILDABLE ARTIFACT written only by a
-- versioned, service-role detector (lib/detections/). NEVER hand-edit; if a
-- detection looks wrong, fix the detector and re-run. Delete-and-rewrite is
-- wholesale per (hardware_id, detector).
--
-- TWO TABLES, two grains:
--
--   detection_runs — one row per (job × detector): the VERDICT. "No bale
--     signature found" is a first-class, storable result — a rake day is not
--     an error and not an empty count, it is a negative finding with the
--     metrics that justify it. The propose-then-confirm UI reads runs.
--
--   detections — one row per detected thing (a bale), with position, time,
--     confidence, the source events it was built from, and the evidence
--     behind its confidence. The marginal slam records as visibly weaker
--     than the clear ones — provenance on every derived fact.
--
-- IDENTITY: anchored on (hardware_id, detector, anchor seq) — the device's
-- own counter, the one spine that survives job-boundary churn. job_id is
-- carried as a VALUE with NO FK (jobs are rewritten wholesale every cron
-- tick; a cascade would wipe detections mid-rewrite, a restrict would break
-- the deriver). run ids anchor on the job's seq_start the same way.
--
-- COVERAGE CONTEXT: every run and every detection carries the job's coverage
-- at derivation time — "28 bales at 71% coverage" must never read equal to
-- "32 at 100%".
--
-- Writes are SERVICE-ROLE ONLY: RLS grants ranch-scoped SELECT and nothing
-- else (exactly 036's posture).
-- ============================================================

create table public.detection_runs (
  id               uuid primary key,   -- stable uuid5(hardware_id, detector, seq_start)
  user_id          uuid not null references auth.users(id) on delete cascade,
  ranch_id         uuid references public.ranches(id),
  device_id        uuid references public.devices(id) on delete set null,
  hardware_id      text not null,

  job_id           uuid not null,      -- = jobs.id at derivation time; VALUE, no FK
  seq_start        integer not null,
  seq_end          integer not null,

  detector         text not null,      -- 'bale' | … — text, never an enum
  -- 'detected' | 'no_signature' | 'insufficient_evidence' — all three are
  -- real results; only 'detected' has detection rows.
  outcome          text not null,
  detection_count  integer not null default 0,
  coverage         double precision not null,

  -- The numbers behind the verdict: discovered cut + gap edges, effect size,
  -- mode counts, interval dispersion, refractory violations, failed checks.
  metrics          jsonb not null default '{}'::jsonb,
  config           jsonb not null default '{}'::jsonb,  -- detector config snapshot

  detector_version text not null,
  derived_at       timestamptz not null default now()
);

create index detection_runs_job_idx      on public.detection_runs (job_id);
create index detection_runs_hw_idx       on public.detection_runs (hardware_id, detector);
create index detection_runs_ranch_idx    on public.detection_runs (ranch_id, detector, derived_at desc);

comment on table public.detection_runs is
  'One verdict per (job × detector). no_signature and insufficient_evidence are first-class results, not errors. Rebuildable artifact — service-role detector only, see lib/detections/.';

create table public.detections (
  id               uuid primary key,   -- stable uuid5(hardware_id, detector, anchor_seq)
  user_id          uuid not null references auth.users(id) on delete cascade,
  ranch_id         uuid references public.ranches(id),
  device_id        uuid references public.devices(id) on delete set null,
  hardware_id      text not null,

  run_id           uuid not null,      -- = detection_runs.id; VALUE, no FK (rewritten together)
  job_id           uuid not null,      -- VALUE, no FK
  type             text not null,      -- 'bale' | … — text, never an enum

  anchor_seq       integer not null,   -- the anchoring event's device seq
  ts               timestamptz not null,
  lat              double precision,   -- the bale's position (slam fix); null = no fix
  lng              double precision,
  confidence       double precision not null,  -- 0..1; evidence explains it
  coverage         double precision not null,  -- job coverage context, copied

  -- Source event ids + roles: {slam:{id,seq,mg,w}, precursor:{…}|null, echoes:[…]}
  source           jsonb not null default '{}'::jsonb,
  -- Named evidence behind confidence: {ampMargin, width, precursor, rhythm, marginal}
  evidence         jsonb not null default '{}'::jsonb,

  detector_version text not null,
  derived_at       timestamptz not null default now()
);

create index detections_ranch_ts_idx on public.detections (ranch_id, type, ts desc);
create index detections_job_idx      on public.detections (job_id);
create index detections_hw_idx       on public.detections (hardware_id, type);

comment on table public.detections is
  'One row per detected thing (bale, …) with position, time, confidence, source events, and evidence. Keyed on (hardware, detector, anchor seq) — survives job-boundary churn. Service-role writes only.';

-- Row Level Security — read-only for users, exactly 036's shape. The
-- ranch_members self-read policy (034) is load-bearing here as everywhere.
alter table public.detection_runs enable row level security;
alter table public.detections     enable row level security;

create policy "ranch detection runs readable" on public.detection_runs
  for select using (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  );

create policy "ranch detections readable" on public.detections
  for select using (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies on purpose: only the service-role detector writes.
