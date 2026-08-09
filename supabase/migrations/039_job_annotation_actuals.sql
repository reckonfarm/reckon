-- ============================================================
-- 039_job_annotation_actuals.sql
-- Ground truth on the job — what the operator says actually happened.
--
-- Two nullable columns on job_annotations (037): the operator's own count of
-- bales that came off the field, and the field's real acreage. Reported from
-- the cab, once, on the day — so the detected-vs-actual matrix builds itself
-- from real field days instead of from memory.
--
-- Same doctrine as 037: this is USER intent over a derived layer. No FK, keyed
-- by the stable job id, survives every wholesale re-derivation. The detector
-- and the boundary math never read these to tune themselves — actuals are the
-- exam key, not the training set. Comparison happens in display code only.
--
-- Nullable means "not reported", never zero. A swather day has no bale count;
-- a day the operator didn't measure has no acres. Absence is honest.
-- ============================================================

alter table public.job_annotations
  add column if not exists actual_bale_count integer
    check (actual_bale_count is null or actual_bale_count between 0 and 10000),
  add column if not exists actual_acres numeric(6,1)
    check (actual_acres is null or actual_acres between 0 and 10000);

comment on column public.job_annotations.actual_bale_count is
  'Operator-reported bale count for this job (ground truth vs the detector). Null = not reported.';
comment on column public.job_annotations.actual_acres is
  'Operator-reported field acreage for this job (ground truth vs the boundary math). Null = not reported.';

-- RLS: unchanged — 037 policies already cover these columns (same row, same
-- owner-or-ranch-member read, same user-stamped write).
