-- ============================================================
-- 040_job_annotation_fields_cut.sql
-- Per-field completion — the operator's word that a field is finished.
--
-- One jsonb column on job_annotations (037): { "<field index>": "cut" |
-- "dismissed" }. Field indexes come from the boundary layer's segmenter
-- (time-ordered work-area clusters of the job's own track) and are
-- deterministic under re-derivation, so they are stable keys the same way
-- the job id is.
--
-- Why this exists: an impact-triggered sensor under-samples smooth fast
-- ground, so the sweep can only ever state a LOWER BOUND there ("at least
-- 65% cut") — the machine's data cannot say "done". The operator can. The
-- system proposes ("Looks like you finished this field — mark it cut?"),
-- the operator confirms with one tap; never auto-marked. A completed field
-- leads with "Cut complete · about N acres" and fills wall-to-wall — the
-- STORY changes, the measurements never do.
--
-- Same doctrine as 037/039: user intent over a derived layer. No FK, keyed
-- by the stable job id, survives every wholesale re-derivation. The sweep
-- and boundary math never read this to tune themselves.
-- ============================================================

alter table public.job_annotations
  add column if not exists fields_cut jsonb;

comment on column public.job_annotations.fields_cut is
  'Operator-confirmed per-field completion: { "<field index>": "cut" | "dismissed" }. Proposed by the system, confirmed by one tap, never auto-marked. Null = nothing marked.';

-- RLS: unchanged — 037 policies already cover the column (same row, same
-- owner-or-ranch-member read, same user-stamped write).
