-- ============================================================
-- 037_job_annotations.sql
-- User annotations on derived jobs — the pattern for every derived layer.
--
-- Jobs are a REBUILDABLE ARTIFACT (036): the deriver deletes + rewrites a
-- device's jobs wholesale every cron tick. Two consequences shape this table:
--
--   1. There is deliberately NO foreign key to public.jobs. A cascade would
--      wipe annotations on every re-derivation; a restrict would break the
--      deriver's wholesale delete. Annotations key on the job id VALUE —
--      deterministic uuid5(hardware_id, seq_start), stableJobId() in
--      lib/jobs/run-derivation.ts — which survives every rewrite. An
--      annotation whose job temporarily doesn't exist (mid-rewrite, or after
--      an exclusions change) is harmless: it simply has nothing to join to.
--
--   2. "Delete" is meaningless against a derived row — it reappears on the
--      next cron. The user verb is DISMISS (dismissed_at, reversible), which
--      lives here, out of the deriver's blast radius.
--
-- name is a stopgap: once field boundaries exist, place will supply most of
-- the name. Don't grow this table into a form.
-- ============================================================

create table public.job_annotations (
  job_id       uuid primary key,   -- = jobs.id (stable uuid5); NO FK on purpose, see header
  user_id      uuid not null references auth.users(id) on delete cascade,
  ranch_id     uuid references public.ranches(id),

  name         text,               -- optional label ("Baling"); null = unnamed
  dismissed_at timestamptz,        -- non-null = hidden from the default list; null = visible

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index job_annotations_ranch_idx on public.job_annotations (ranch_id);

comment on table public.job_annotations is
  'User annotations (name, dismiss) on derived jobs. Keyed by stable job id, no FK — survives wholesale re-derivation. The verb is dismiss, never delete.';

alter table public.job_annotations enable row level security;

-- Read = same shape as "ranch jobs readable" (036): owner leg OR ranch-member
-- leg. The ranch_members self-read policy (034) is load-bearing here too.
create policy "ranch job annotations readable" on public.job_annotations
  for select using (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  );

-- Writes are USER writes (unlike jobs): any ranch member may annotate the
-- ranch's jobs, but a row always records who wrote it (user_id = auth.uid()
-- enforced on the way in).
create policy "ranch job annotations insertable" on public.job_annotations
  for insert with check (
    user_id = auth.uid()
    and (
      ranch_id is null
      or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    )
  );

create policy "ranch job annotations updatable" on public.job_annotations
  for update using (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
  );

-- No DELETE policy: clearing a name or un-dismissing is an UPDATE. Rows are
-- tiny and their history (created_at/updated_at) is worth keeping.
